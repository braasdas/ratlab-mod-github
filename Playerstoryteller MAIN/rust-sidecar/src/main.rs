mod encoder_patched;
mod websocket;
mod monitor;
mod mp4;
mod stream;

use clap::Parser;
use log::{info, error, LevelFilter};
use simplelog::{CombinedLogger, TermLogger, WriteLogger, Config, TerminalMode, ColorChoice};
use std::fs::File;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;

use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Com::IStream;

use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use encoder_patched::{VideoEncoder, VideoSettingsBuilder, AudioSettingsBuilder};
use stream::WebSocketStream;
use websocket::WebSocketManager;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(short, long, default_value = "ws://localhost:3000")]
    url: String,

    #[arg(short, long)]
    pid: u32,

    #[arg(short, long)]
    gpu: Option<u32>,

    #[arg(long, default_value = "")]
    stream_key: String,

    #[arg(long, default_value = "current-session")]
    session_id: String,

    #[arg(long, default_value = "medium")]
    quality: String,
}

struct StreamApp {
    encoder: Option<VideoEncoder>,
    start: Instant,
}

impl GraphicsCaptureApiHandler for StreamApp {
    // Flags: Sender, Width, Height, Bitrate
    type Flags = (mpsc::UnboundedSender<Vec<u8>>, u32, u32, u32);
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let (sender, width, height, bitrate) = ctx.flags;
        let ws_stream = WebSocketStream::new(sender);
        let stream: IStream = ws_stream.into();

        let encoder = VideoEncoder::new(
            VideoSettingsBuilder::new(width, height).bitrate(bitrate),
            AudioSettingsBuilder::default().disabled(true), 
            &stream,
        ).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

        Ok(Self {
            encoder: Some(encoder),
            start: Instant::now(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if let Some(encoder) = self.encoder.as_mut() {
            // Ignore FrameDropped errors (normal when encoder can't keep up)
            // But propagate other errors
            if let Err(e) = encoder.send_frame(frame) {
                match e {
                    encoder_patched::VideoEncoderError::FrameDropped => {
                        // Frame dropped is expected, continue
                    }
                    other => return Err(Box::new(other) as Box<dyn std::error::Error + Send + Sync>),
                }
            }
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        info!("Capture session ended");
        if let Some(encoder) = self.encoder.take() {
            encoder.finish().map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let log_file = File::create("sidecar.log").unwrap_or_else(|_| File::create("sidecar_fallback.log").unwrap());
    CombinedLogger::init(
        vec![
            TermLogger::new(LevelFilter::Debug, Config::default(), TerminalMode::Mixed, ColorChoice::Auto),
            WriteLogger::new(LevelFilter::Debug, Config::default(), log_file),
        ]
    ).unwrap();

    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_ok() {
            info!("CoInitializeEx (MTA) succeeded.");
        } else {
            info!("CoInitializeEx (MTA) failed (likely already initialized): {:?}", hr);
        }
    }

    info!("=== Ratlab Rust Sidecar (Windows Capture + SinkWriter) Started ===");

    let args = match Args::try_parse() {
        Ok(a) => a,
        Err(e) => {
            error!("Argument parsing failed: {}", e);
            eprintln!("Argument parsing failed: {}", e);
            return Ok(());
        }
    };
    
    info!("Arguments parsed. PID: {}, URL: {}", args.pid, args.url);

    tokio::spawn(monitor::monitor_parent(args.pid));

    let ws_manager = Arc::new(WebSocketManager::new(
        args.url.clone(),
        args.stream_key.clone(),
        args.session_id.clone(),
    ));
    
    let ws_clone = ws_manager.clone();
    tokio::spawn(async move {
        ws_clone.connect_loop().await;
    });

    info!("Waiting for WebSocket connection...");
    ws_manager.wait_for_connection().await;
    info!("WebSocket connected. Starting capture...");

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let ws_send = ws_manager.clone();
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let _ = ws_send.send_data(data).await;
        }
    });

    let (window, w, h) = if args.pid != 0 {
        info!("Searching for window with PID: {}", args.pid);
        let hwnd = unsafe { find_main_window(args.pid) };
        if hwnd.0 == std::ptr::null_mut() {
            error!("Game window not found (PID {})", args.pid);
            return Ok(());
        }
        
        let mut rect = windows::Win32::Foundation::RECT::default();
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut rect)? };
        let w = (rect.right - rect.left) as u32;
        let h = (rect.bottom - rect.top) as u32;
        
        (Window::from_raw_hwnd(hwnd.0), w, h)
    } else {
        error!("PID required");
        return Ok(());
    };

    if !window.is_valid() {
        error!("Invalid window handle");
        return Ok(());
    }

    let bitrate = match args.quality.to_lowercase().as_str() {
        "low" => 1_000_000,
        "high" => 4_500_000,
        _ => 2_500_000, // Medium default
    };
    info!("Selected Quality: {} (Bitrate: {})", args.quality, bitrate);

    let settings = Settings::new(
        window,
        CursorCaptureSettings::Default,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        (tx, w, h, bitrate), // Pass tuple as flags
    );

    info!("Starting Capture Loop...");
    StreamApp::start(settings).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

    Ok(())
}

use windows::Win32::Foundation::{HWND, LPARAM};
use windows::core::BOOL;
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, GetWindowTextLengthW};

unsafe fn find_main_window(pid: u32) -> HWND {
    let _found_hwnd = HWND(std::ptr::null_mut());
    unsafe extern "system" fn enum_window_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam.0 as *mut FindWindowContext);
        let mut window_pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid == context.target_pid {
            if IsWindowVisible(hwnd).as_bool() {
                let len = GetWindowTextLengthW(hwnd);
                if len > 0 {
                    context.found_hwnd = hwnd;
                    return BOOL(0);
                }
            }
        }
        BOOL(1)
    }
    struct FindWindowContext { target_pid: u32, found_hwnd: HWND }
    let mut context = FindWindowContext { target_pid: pid, found_hwnd: HWND(std::ptr::null_mut()) };
    let _ = EnumWindows(Some(enum_window_callback), LPARAM(&mut context as *mut _ as isize));
    context.found_hwnd
}