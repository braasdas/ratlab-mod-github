use windows::{
    core::*,
    Win32::System::Com::{IStream, IStream_Impl, ISequentialStream_Impl, STGC, STATSTG, STREAM_SEEK, LOCKTYPE, STATFLAG, STGTY_STREAM},
    Win32::Foundation::*,
};
use windows_implement::implement;
use tokio::sync::mpsc::UnboundedSender;
use log::{debug, info, error};
use parking_lot::Mutex;
use crate::mp4::{Mp4Parser, SegmentType};

#[implement(IStream)]
pub struct WebSocketStream {
    sender: UnboundedSender<Vec<u8>>,
    // state contains the virtual file buffer and current SinkWriter position
    state: Mutex<StreamState>,
    // parser processes completed atoms into segments
    parser: Mutex<Mp4Parser>,
}

struct StreamState {
    buffer: Vec<u8>,
    position: u64,
    bytes_flushed: u64, // Total bytes already sent to WebSocket
}

impl WebSocketStream {
    pub fn new(sender: UnboundedSender<Vec<u8>>) -> Self {
        Self { 
            sender, 
            state: Mutex::new(StreamState {
                buffer: Vec::with_capacity(1024 * 1024),
                position: 0,
                bytes_flushed: 0,
            }),
            parser: Mutex::new(Mp4Parser::new()),
        }
    }

    fn try_flush(&self, state: &mut StreamState) {
        let mut parser = self.parser.lock();
        
        while state.buffer.len() >= 8 {
            // Read atom size from the start of our current buffer
            let atom_size = u32::from_be_bytes([state.buffer[0], state.buffer[1], state.buffer[2], state.buffer[3]]) as usize;
            
            if atom_size < 8 {
                // Should not happen in a valid stream, but if it does, we must skip to avoid infinite loop
                state.buffer.remove(0);
                state.bytes_flushed += 1;
                continue;
            }
            
            if state.buffer.len() < atom_size {
                break; // Atom is not yet fully written to buffer
            }
            
            // CRITICAL: We only flush an atom if the SinkWriter's current position is PAST the atom.
            // This ensures the SinkWriter has finished any seeking/patching within this atom.
            if state.position < state.bytes_flushed + atom_size as u64 {
                break;
            }
            
            // Extract the completed atom
            let atom_data: Vec<u8> = state.buffer.drain(0..atom_size).collect();
            state.bytes_flushed += atom_size as u64;
            
            // Parse into MP4 segments (Init or Media) and send via WebSocket
            let segments = parser.parse(&atom_data);
            for segment in segments {
                match segment.kind {
                    SegmentType::Init => {
                        // Log init segment at INFO level - critical for debugging late-join
                        info!("*** SENDING INIT SEGMENT: {} bytes. First 8 bytes: {:02X?}", 
                            segment.data.len(), 
                            &segment.data[0..std::cmp::min(8, segment.data.len())]);
                    },
                    SegmentType::Media => {
                        // Media segments logged at debug level (too frequent)
                    },
                }
                let _ = self.sender.send(segment.data);
            }

        }
    }
}

use windows::Win32::System::Com::{STGM, STGM_READWRITE, STGM_DIRECT, STGM_SHARE_DENY_NONE};

impl ISequentialStream_Impl for WebSocketStream_Impl {
    fn Read(&self, _pv: *mut std::ffi::c_void, _cb: u32, pcbread: *mut u32) -> HRESULT { 
        unsafe { if !pcbread.is_null() { *pcbread = 0; } }
        S_OK 
    }

    fn Write(&self, pv: *const std::ffi::c_void, cb: u32, pcbwritten: *mut u32) -> HRESULT {
        unsafe {
            let data = std::slice::from_raw_parts(pv as *const u8, cb as usize);
            let mut state = self.state.lock();
            
            if state.position < state.bytes_flushed {
                error!("SinkWriter tried to write at {}, but we already flushed up to {}!", state.position, state.bytes_flushed);
                return E_FAIL;
            }

            let pos_in_buffer = (state.position - state.bytes_flushed) as usize;
            let end_pos_in_buffer = pos_in_buffer + cb as usize;
            
            if end_pos_in_buffer > state.buffer.len() {
                state.buffer.resize(end_pos_in_buffer, 0);
            }
            
            state.buffer[pos_in_buffer..end_pos_in_buffer].copy_from_slice(data);
            state.position += cb as u64;
            
            self.try_flush(&mut state);
            
            if !pcbwritten.is_null() {
                *pcbwritten = cb;
            }
        }
        S_OK
    }
}

impl IStream_Impl for WebSocketStream_Impl {
    fn Seek(&self, dlibmove: i64, dworigin: STREAM_SEEK, plibnewposition: *mut u64) -> Result<()> {
        let mut state = self.state.lock();
        let target = match dworigin {
            STREAM_SEEK(0) => dlibmove as u64, // SET
            STREAM_SEEK(1) => (state.position as i64 + dlibmove) as u64, // CUR
            STREAM_SEEK(2) => (state.bytes_flushed as i64 + state.buffer.len() as i64 + dlibmove) as u64, // END
            _ => return Err(Error::from(E_NOTIMPL)),
        };
        
        if target < state.bytes_flushed {
            // SinkWriter should not seek back into already flushed fragments in fMP4 mode
            debug!("SinkWriter requested seek to {} (already flushed up to {}) - Pinning to edge", target, state.bytes_flushed);
            state.position = state.bytes_flushed;
        } else {
            state.position = target;
        }
        
        if !plibnewposition.is_null() {
            unsafe { *plibnewposition = state.position; }
        }
        Ok(())
    }

    fn SetSize(&self, _libnewsize: u64) -> Result<()> { Ok(()) }
    fn CopyTo(&self, _pstm: Ref<'_, IStream>, _cb: u64, _pcbread: *mut u64, _pcbwritten: *mut u64) -> Result<()> { Err(Error::from(E_NOTIMPL)) }
    fn Commit(&self, _grfcommitflags: &STGC) -> Result<()> { Ok(()) }
    fn Revert(&self) -> Result<()> { Err(Error::from(E_NOTIMPL)) }
    fn LockRegion(&self, _liboffset: u64, _cb: u64, _dwlocktype: &LOCKTYPE) -> Result<()> { Err(Error::from(E_NOTIMPL)) }
    fn UnlockRegion(&self, _liboffset: u64, _cb: u64, _dwlocktype: u32) -> Result<()> { Err(Error::from(E_NOTIMPL)) }
    fn Stat(&self, pstatstg: *mut STATSTG, _grfstatflag: &STATFLAG) -> Result<()> { 
        unsafe {
            if !pstatstg.is_null() {
                let state = self.state.lock();
                *pstatstg = std::mem::zeroed();
                (*pstatstg).cbSize = state.bytes_flushed + state.buffer.len() as u64;
                (*pstatstg).r#type = STGTY_STREAM.0 as u32;
                (*pstatstg).grfMode = STGM((STGM_READWRITE.0 | STGM_DIRECT.0 | STGM_SHARE_DENY_NONE.0) as u32);
            }
        }
        Ok(())
    }
    fn Clone(&self) -> Result<IStream> { Err(Error::from(E_NOTIMPL)) }
}