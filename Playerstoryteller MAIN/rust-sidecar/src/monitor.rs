use log::{info, warn};
use std::process;
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, INFINITE};

pub async fn monitor_parent(pid_u32: u32) {
    if pid_u32 == 0 {
        info!("No parent PID provided. Monitoring disabled.");
        return;
    }

    info!("Monitoring parent process PID: {} (Native Wait)", pid_u32);

    tokio::task::spawn_blocking(move || {
        unsafe {
            // OpenProcess expects PROCESS_ACCESS_RIGHTS
            let handle = OpenProcess(PROCESS_SYNCHRONIZE, false, pid_u32);
            
            if let Ok(h) = handle {
                let reason = WaitForSingleObject(h, INFINITE);
                
                if reason == WAIT_OBJECT_0 {
                    warn!("Parent process {} exited. Shutting down.", pid_u32);
                } else {
                    warn!("Parent process wait failed. Shutting down for safety.");
                }
                
                let _ = CloseHandle(h);
            } else {
                warn!("Could not open parent process {}. Assuming it is already dead.", pid_u32);
            }
            
            process::exit(0);
        }
    });
}
