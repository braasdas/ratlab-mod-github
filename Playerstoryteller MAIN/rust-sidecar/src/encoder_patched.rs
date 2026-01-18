use std::sync::atomic::{self, AtomicBool};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use log::{info, error, debug, warn};

use parking_lot::Mutex;
use windows::Foundation::TimeSpan;
use windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    ID3D11Device, ID3D11RenderTargetView, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGISurface;
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11SurfaceFromDXGISurface;
use windows::core::Interface;

use windows::Win32::Media::MediaFoundation::{
    MFCreateMFByteStreamOnStream, MFTranscodeContainerType_FMPEG4, MF_TRANSCODE_CONTAINERTYPE,
    MFStartup, MF_VERSION, IMFSinkWriter, MFCreateAttributes, IMFAttributes,
    MFMediaType_Video, MFMediaType_Audio, MFVideoFormat_H264, MFAudioFormat_AAC, MFCreateMediaType,
    MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_MT_FRAME_SIZE, MF_MT_FRAME_RATE, MF_MT_AVG_BITRATE, MF_MT_INTERLACE_MODE,
    MFVideoInterlace_Progressive, MF_MT_PIXEL_ASPECT_RATIO, MFAudioFormat_PCM, MF_MT_AUDIO_NUM_CHANNELS,
    MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
    MFCreateSinkWriterFromURL, MFCreateMemoryBuffer, MFCreateSample, IMFMediaBuffer, IMFSample,
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SINK_WRITER_DISABLE_THROTTLING, MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main, eAVEncH264VProfile_Base,
    MF_MT_DEFAULT_STRIDE,
};
use windows::Win32::System::Com::IStream;

use windows_capture::d3d11::SendDirectX;
use windows_capture::frame::Frame;
use windows_capture::settings::ColorFormat;

type VideoFrameReceiver = Arc<Mutex<mpsc::Receiver<Option<(VideoEncoderSource, TimeSpan)>>>>;
type AudioFrameReceiver = Arc<Mutex<mpsc::Receiver<Option<(AudioEncoderSource, TimeSpan)>>>>;


#[derive(thiserror::Error, Debug)]
pub enum VideoEncoderError {
    #[error("Windows API error: {0}")]
    WindowsError(#[from] windows::core::Error),
    #[error("Failed to send frame: {0}")]
    FrameSendError(#[from] mpsc::SendError<Option<(VideoEncoderSource, TimeSpan)>>),
    #[error("Frame dropped (buffer full)")]
    FrameDropped,
    #[error("Failed to send audio: {0}")]
    AudioSendError(#[from] mpsc::SendError<Option<(AudioEncoderSource, TimeSpan)>>),
    #[error("Video encoding is disabled")]
    VideoDisabled,
    #[error("Audio encoding is disabled")]
    AudioDisabled,
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Unsupported frame color format: {0:?}")]
    UnsupportedFrameFormat(ColorFormat),
}

unsafe impl Send for VideoEncoderError {}
unsafe impl Sync for VideoEncoderError {}

pub enum VideoEncoderSource {
    DirectX(SendDirectX<IDirect3DSurface>),
    Buffer(Vec<u8>),
}

pub enum AudioEncoderSource {
    Buffer(Vec<u8>),
}

struct CachedSurface {
    width: u32,
    height: u32,
    format: ColorFormat,
    texture: SendDirectX<ID3D11Texture2D>,
    surface: SendDirectX<IDirect3DSurface>,
    render_target_view: Option<SendDirectX<ID3D11RenderTargetView>>,
}

pub struct VideoSettingsBuilder {
    bitrate: u32,
    width: u32,
    height: u32,
    frame_rate: u32,
    pixel_aspect_ratio: (u32, u32),
    disabled: bool,
}

impl VideoSettingsBuilder {
    pub const fn new(width: u32, height: u32) -> Self {
        Self {
            bitrate: 15_000_000,
            frame_rate: 60,
            pixel_aspect_ratio: (1, 1),
            width,
            height,
            disabled: false,
        }
    }
    pub const fn bitrate(mut self, bitrate: u32) -> Self {
        self.bitrate = bitrate;
        self
    }
    pub const fn width(mut self, width: u32) -> Self {
        self.width = width;
        self
    }
    pub const fn height(mut self, height: u32) -> Self {
        self.height = height;
        self
    }
    pub const fn frame_rate(mut self, frame_rate: u32) -> Self {
        self.frame_rate = frame_rate;
        self
    }
    pub const fn pixel_aspect_ratio(mut self, par: (u32, u32)) -> Self {
        self.pixel_aspect_ratio = par;
        self
    }
    pub const fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

pub struct AudioSettingsBuilder {
    bitrate: u32,
    channel_count: u32,
    sample_rate: u32,
    bit_per_sample: u32,
    disabled: bool,
}

impl AudioSettingsBuilder {
    pub const fn new() -> Self {
        Self {
            bitrate: 192_000,
            channel_count: 2,
            sample_rate: 48_000,
            bit_per_sample: 16,
            disabled: false,
        }
    }
    pub const fn bitrate(mut self, bitrate: u32) -> Self {
        self.bitrate = bitrate;
        self
    }
    pub const fn channel_count(mut self, channel_count: u32) -> Self {
        self.channel_count = channel_count;
        self
    }
    pub const fn sample_rate(mut self, sample_rate: u32) -> Self {
        self.sample_rate = sample_rate;
        self
    }
    pub const fn bit_per_sample(mut self, bit_per_sample: u32) -> Self {
        self.bit_per_sample = bit_per_sample;
        self
    }
    pub const fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl Default for AudioSettingsBuilder {
    fn default() -> Self { Self::new() }
}

pub struct VideoEncoder {
    first_timestamp: Option<TimeSpan>,
    frame_sender: mpsc::SyncSender<Option<(VideoEncoderSource, TimeSpan)>>,
    audio_sender: mpsc::Sender<Option<(AudioEncoderSource, TimeSpan)>>,
    transcode_thread: Option<JoinHandle<Result<(), VideoEncoderError>>>,
    error_notify: Arc<AtomicBool>,
    is_video_disabled: bool,
    is_audio_disabled: bool,
    audio_sample_rate: u32,
    audio_block_align: u32,
    audio_samples_sent: u64,
    target_width: u32,
    target_height: u32,
    target_color_format: ColorFormat,
    cached_surface: Option<CachedSurface>,
}

// Wrapper to allow sending SinkWriter to thread
struct SendSinkWriter(IMFSinkWriter);
unsafe impl Send for SendSinkWriter {}
unsafe impl Sync for SendSinkWriter {}

impl SendSinkWriter {
    fn into_inner(self) -> IMFSinkWriter {
        self.0
    }
}

// Wrapper to allow sending IStream to thread
struct SendIStream(IStream);
unsafe impl Send for SendIStream {}
unsafe impl Sync for SendIStream {}

impl SendIStream {
    fn into_inner(self) -> IStream {
        self.0
    }
}

impl VideoEncoder {
    fn create_cached_surface(
        device: &ID3D11Device,
        width: u32,
        height: u32,
        format: ColorFormat,
    ) -> Result<CachedSurface, VideoEncoderError> {
        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT(format as i32),
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };

        let mut texture = None;
        unsafe { device.CreateTexture2D(&texture_desc, None, Some(&mut texture))? };
        let texture = texture.expect("CreateTexture2D returned None");

        let mut render_target = None;
        unsafe { device.CreateRenderTargetView(&texture, None, Some(&mut render_target))? };
        let render_target_view = render_target.map(SendDirectX::new);

        let dxgi_surface: IDXGISurface = texture.cast()?;
        let inspectable = unsafe { CreateDirect3D11SurfaceFromDXGISurface(&dxgi_surface)? };
        let surface: IDirect3DSurface = inspectable.cast()?;

        Ok(CachedSurface {
            width,
            height,
            format,
            texture: SendDirectX::new(texture),
            surface: SendDirectX::new(surface),
            render_target_view,
        })
    }

    pub fn new(
        video_settings: VideoSettingsBuilder,
        audio_settings: AudioSettingsBuilder,
        stream: &IStream,
    ) -> Result<Self, VideoEncoderError> {
        info!("Initializing VideoEncoder...");
        
        let (frame_sender, frame_receiver_raw) = mpsc::sync_channel::<Option<(VideoEncoderSource, TimeSpan)>>(2);
        let (audio_sender, audio_receiver_raw) = mpsc::channel::<Option<(AudioEncoderSource, TimeSpan)>>();

        let frame_receiver = Arc::new(Mutex::new(frame_receiver_raw));
        let audio_receiver = Arc::new(Mutex::new(audio_receiver_raw));
        let error_notify = Arc::new(AtomicBool::new(false));

        let stream_wrapper = SendIStream(stream.clone());

        // Align width and height to 16 (macroblock size) to avoid MSE/Decoder issues
        // Mod 2 (e.g. 1046 height) often fails in hardware decoders/SourceBuffer
        let mut width = (video_settings.width / 16) * 16;
        let mut height = (video_settings.height / 16) * 16;

        let transcode_thread = thread::spawn({
            let error_notify = error_notify.clone();
            let video_settings = VideoSettingsBuilder { width, height, ..video_settings };
            move || -> Result<(), VideoEncoderError> {
                unsafe {
                     use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
                     CoInitializeEx(None, COINIT_MULTITHREADED).ok();
                }

                info!("Encoder Thread: Initializing MF...");
                unsafe { MFStartup(MF_VERSION, 0)? };
                info!("Encoder Thread: MFStartup complete.");

                let stream = stream_wrapper.into_inner();
                let byte_stream = unsafe { MFCreateMFByteStreamOnStream(&stream)? };
                info!("Encoder Thread: MFByteStream created.");

                let mut attributes: Option<IMFAttributes> = None;
                unsafe { MFCreateAttributes(&mut attributes, 3)? };
                let attributes = attributes.unwrap();
                unsafe { attributes.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_FMPEG4)? };
                unsafe { attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)? }; // Enable GPU encoding
                unsafe { attributes.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)? };

                info!("Encoder Thread: Creating SinkWriter...");
                let writer = unsafe {
                    MFCreateSinkWriterFromURL(
                        None,
                        &byte_stream,
                        &attributes,
                    )?
                };
                info!("Encoder Thread: SinkWriter created.");

                let mut video_stream_index = 0;
                let is_video_disabled = video_settings.disabled;
                if !is_video_disabled {
                    info!("Encoder Thread: Configuring Video {}x{} @ {}fps", video_settings.width, video_settings.height, video_settings.frame_rate);
                    let media_type_out = unsafe { MFCreateMediaType()? };

                    unsafe {
                        media_type_out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
                        media_type_out.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
                        media_type_out.SetUINT32(&MF_MT_AVG_BITRATE, video_settings.bitrate)?;
                        media_type_out.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
                        media_type_out.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32)?;
                        
                        let size = (video_settings.width as u64) << 32 | (video_settings.height as u64);
                        media_type_out.SetUINT64(&MF_MT_FRAME_SIZE, size)?;

                        let num = video_settings.frame_rate;
                        let den = 1;
                        let rate = (num as u64) << 32 | (den as u64);
                        media_type_out.SetUINT64(&MF_MT_FRAME_RATE, rate)?;
                        
                        let par_num = video_settings.pixel_aspect_ratio.0;
                        let par_den = video_settings.pixel_aspect_ratio.1;
                        let par = (par_num as u64) << 32 | (par_den as u64);
                        media_type_out.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, par)?;
                    }

                    video_stream_index = unsafe { writer.AddStream(&media_type_out)? };
                    info!("Encoder Thread: Video stream added. Index: {}", video_stream_index);

                    let media_type_in = unsafe { MFCreateMediaType()? };

                    // Use negative stride - we flip rows ourselves so the buffer is now bottom-up
                    let stride = -((video_settings.width * 4) as i32);

                    unsafe {
                        media_type_in.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
                        media_type_in.SetGUID(&MF_MT_SUBTYPE, &windows::Win32::Media::MediaFoundation::MFVideoFormat_RGB32)?;

                        media_type_in.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
                        media_type_in.SetUINT64(&MF_MT_FRAME_SIZE, (video_settings.width as u64) << 32 | (video_settings.height as u64))?;
                        media_type_in.SetUINT64(&MF_MT_FRAME_RATE, (video_settings.frame_rate as u64) << 32 | 1)?;
                        media_type_in.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (video_settings.pixel_aspect_ratio.0 as u64) << 32 | (video_settings.pixel_aspect_ratio.1 as u64))?;
                        // Set stride to indicate image orientation (negative = needs vertical flip)
                        media_type_in.SetUINT32(&MF_MT_DEFAULT_STRIDE, stride as u32)?;
                    }

                    info!("Encoder Thread: Setting Video Input Media Type (stride: {})...", stride);
                    unsafe { writer.SetInputMediaType(video_stream_index, &media_type_in, None)? };
                    info!("Encoder Thread: Video input media type set.");
                }

                let mut audio_stream_index = 0;
                let is_audio_disabled = audio_settings.disabled;
                if !is_audio_disabled {
                    let media_type_out = unsafe { MFCreateMediaType()? };

                    unsafe {
                        media_type_out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
                        media_type_out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
                        media_type_out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, audio_settings.channel_count)?;
                        media_type_out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, audio_settings.sample_rate)?;
                        media_type_out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?; 
                        media_type_out.SetUINT32(&MF_MT_AVG_BITRATE, audio_settings.bitrate)?;
                    }
                     audio_stream_index = unsafe { writer.AddStream(&media_type_out)? };

                    let media_type_in = unsafe { MFCreateMediaType()? };

                    unsafe {
                         media_type_in.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
                         media_type_in.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
                         media_type_in.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, audio_settings.channel_count)?;
                         media_type_in.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, audio_settings.sample_rate)?;
                         media_type_in.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, audio_settings.bit_per_sample)?;
                         let block_align = (audio_settings.bit_per_sample / 8) * audio_settings.channel_count;
                         media_type_in.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block_align)?;
                         media_type_in.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, block_align * audio_settings.sample_rate)?;
                    }
                    unsafe { writer.SetInputMediaType(audio_stream_index, &media_type_in, None)? };
                }

                info!("Encoder Thread: Calling SinkWriter BeginWriting...");
                unsafe { writer.BeginWriting()? };
                info!("Encoder Thread: SinkWriter BeginWriting successful.");

                info!("Encoder Thread: Starting Frame Loop.");
                loop {
                    // Use blocking recv instead of polling - much more efficient
                    let msg = match frame_receiver.lock().recv() {
                        Ok(m) => m,
                        Err(_) => break, // Channel closed
                    };
                    
                    match msg {
                        Some((VideoEncoderSource::Buffer(data), timestamp)) => {
                            let len = data.len() as u32;
                            let buffer = unsafe { MFCreateMemoryBuffer(len)? };
                            
                            let mut ptr: *mut u8 = std::ptr::null_mut();
                            let mut max_len = 0u32;
                            let mut current_len = 0u32;
                            unsafe { buffer.Lock(&mut ptr, Some(&mut max_len), Some(&mut current_len))? };
                            unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, len as usize) };
                            unsafe { buffer.SetCurrentLength(len)? };
                            unsafe { buffer.Unlock()? };

                            let sample = unsafe { MFCreateSample()? };
                            unsafe { sample.AddBuffer(&buffer)? };
                            unsafe { sample.SetSampleTime(timestamp.Duration)? };
                            unsafe { sample.SetSampleDuration(10_000_000 / 60)? };
                            
                            unsafe { writer.WriteSample(video_stream_index, &sample)? };
                        }
                        Some(_) => {} // Ignore DirectX for now
                        None => break,
                    }
                }

                unsafe { writer.Finalize()? };
                Ok(())
            }
        });

        let audio_block_align = (audio_settings.bit_per_sample / 8) * audio_settings.channel_count;

        Ok(Self {
            first_timestamp: None,
            frame_sender,
            audio_sender,
            transcode_thread: Some(transcode_thread),
            error_notify,
            is_video_disabled: video_settings.disabled,
            is_audio_disabled: audio_settings.disabled,
            audio_sample_rate: audio_settings.sample_rate,
            audio_block_align,
            audio_samples_sent: 0,
            target_width: width,
            target_height: height,
            target_color_format: ColorFormat::Bgra8,
            cached_surface: None,
        })
    }
    
    fn build_padded_surface(&mut self, frame: &Frame) -> Result<SendDirectX<IDirect3DSurface>, VideoEncoderError> {
        let frame_format = frame.color_format();
        let needs_recreate = self.cached_surface.as_ref().is_none_or(|cache| {
            cache.format != frame_format || cache.width != self.target_width || cache.height != self.target_height
        });

        if needs_recreate {
            let surface =
                Self::create_cached_surface(frame.device(), self.target_width, self.target_height, frame_format)?;
            self.cached_surface = Some(surface);
            self.target_color_format = frame_format;
        }

        let cache = self.cached_surface.as_mut().expect("cached_surface must be populated before use");
        let context = frame.device_context();

        if let Some(rtv) = &cache.render_target_view {
            let clear_color = [0.0f32, 0.0, 0.0, 1.0];
            unsafe {
                context.ClearRenderTargetView(&rtv.0, &clear_color);
            }
        }

        let copy_width = self.target_width.min(frame.width());
        let copy_height = self.target_height.min(frame.height());

        if copy_width > 0 && copy_height > 0 {
            let source_box = D3D11_BOX { left: 0, top: 0, front: 0, right: copy_width, bottom: copy_height, back: 1 };
            unsafe {
                context.CopySubresourceRegion(
                    &cache.texture.0,
                    0,
                    0,
                    0,
                    0,
                    frame.as_raw_texture(),
                    0,
                    Some(&source_box),
                );
            }
        }

        unsafe {
            context.Flush();
        }

        Ok(SendDirectX::new(cache.surface.0.clone()))
    }

    pub fn send_frame(&mut self, frame: &mut Frame) -> Result<(), VideoEncoderError> {
         if self.is_video_disabled { return Err(VideoEncoderError::VideoDisabled); }
         
         let timestamp = match self.first_timestamp {
            Some(t0) => TimeSpan { Duration: frame.timestamp()?.Duration - t0.Duration },
            None => {
                let ts = frame.timestamp()?;
                self.first_timestamp = Some(ts);
                TimeSpan { Duration: 0 }
            }
        };

        let width = frame.width();
        let height = frame.height();
        let mut buffer = frame.buffer().map_err(|e| VideoEncoderError::IoError(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        let raw_data = buffer.as_raw_buffer();

        // Calculate strides
        let input_stride = (width * 4) as usize;
        let output_stride = (self.target_width * 4) as usize;
        let copy_width = (std::cmp::min(width, self.target_width) * 4) as usize;
        let copy_rows = std::cmp::min(height, self.target_height) as usize;
        
        // Allocate output buffer
        let mut new_buffer = vec![0u8; output_stride * self.target_height as usize];
        
        // Copy rows in REVERSE order to flip the image vertically
        // This fixes the upside-down issue caused by Windows Capture providing top-down data
        // while the H.264 encoder expects bottom-up
        for i in 0..copy_rows {
            let src_row = i;
            let dst_row = copy_rows - 1 - i; // Flip: top row goes to bottom
            
            let src_start = src_row * input_stride;
            let src_end = src_start + copy_width;
            let dst_start = dst_row * output_stride;
            
            if src_end <= raw_data.len() && dst_start + copy_width <= new_buffer.len() {
                new_buffer[dst_start..dst_start + copy_width]
                    .copy_from_slice(&raw_data[src_start..src_end]);
            }
        }
        
        match self.frame_sender.try_send(Some((VideoEncoderSource::Buffer(new_buffer), timestamp))) {
            Ok(_) => {
                // Frame sent successfully - log occasionally
                static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if count % 60 == 0 {
                    info!("Frames sent to encoder: {}", count);
                }
            },
            Err(mpsc::TrySendError::Full(_)) => {
                // Log drops
                static DROP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let drops = DROP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if drops % 60 == 0 {
                    info!("Frames DROPPED (encoder lag): {}", drops);
                }
                return Err(VideoEncoderError::FrameDropped);
            },
            Err(mpsc::TrySendError::Disconnected(_)) => return Err(VideoEncoderError::VideoDisabled),
        }
        Ok(())
    }

    
    pub fn send_frame_with_audio(&mut self, _frame: &mut Frame, _audio_buffer: &[u8]) -> Result<(), VideoEncoderError> {
        Ok(())
    }

    pub fn send_frame_buffer(&mut self, _buffer: &[u8], _timestamp: i64) -> Result<(), VideoEncoderError> {
        Ok(())
    }

    pub fn send_audio_buffer(&mut self, _buffer: &[u8], _timestamp: i64) -> Result<(), VideoEncoderError> {
        Ok(())
    }

    pub fn finish(mut self) -> Result<(), VideoEncoderError> {
         let _ = self.frame_sender.send(None);
         let _ = self.audio_sender.send(None);
         if let Some(t) = self.transcode_thread.take() {
             t.join().expect("Thread panicked")?;
         }
         Ok(())
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
         let _ = self.frame_sender.send(None);
         if let Some(t) = self.transcode_thread.take() {
             let _ = t.join();
         }
    }
}