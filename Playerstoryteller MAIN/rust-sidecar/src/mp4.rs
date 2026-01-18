use std::io::{Cursor, Write, Read};
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use log::{debug, error};

#[derive(Debug, PartialEq)]
pub enum SegmentType {
    Init,
    Media,
}

pub struct Mp4Segment {
    pub kind: SegmentType,
    pub data: Vec<u8>,
}

pub struct Mp4Parser {
    buffer: Vec<u8>,
    init_complete: bool,
    init_segment: Vec<u8>,
    pending_moof: Vec<u8>,
    cumulative_decode_time: u64, // Tracks baseMediaDecodeTime for tfdt
}

impl Mp4Parser {
    pub fn new() -> Self {
        Self {
            buffer: Vec::with_capacity(1024 * 1024), 
            init_complete: false,
            init_segment: Vec::new(),
            pending_moof: Vec::new(),
            cumulative_decode_time: 0,
        }
    }

    /// Find avc1 box and extract video dimensions (width, height)
    fn find_avc1_dimensions(data: &[u8]) -> Option<(u16, u16)> {
        // Search for "avc1" pattern
        for i in 0..data.len().saturating_sub(40) {
            if &data[i..i+4] == b"avc1" {
                // avc1 sample entry structure:
                // +0-3: size (already passed)
                // +4-7: "avc1"
                // +8-13: reserved (6 bytes)
                // +14-15: data_reference_index (2 bytes)
                // +16-31: pre_defined/reserved (16 bytes)
                // +32-33: width (2 bytes)
                // +34-35: height (2 bytes)
                let width_offset = i + 28; // +4 (type already at i) + 24 = 28 from 'a' of avc1
                let height_offset = i + 30;

                if height_offset + 2 <= data.len() {
                    let width = u16::from_be_bytes([data[width_offset], data[width_offset + 1]]);
                    let height = u16::from_be_bytes([data[height_offset], data[height_offset + 1]]);
                    if width > 0 && height > 0 {
                        debug!("Found avc1 dimensions: {}x{}", width, height);
                        return Some((width, height));
                    }
                }
            }
        }
        None
    }

    /// Patch tkhd box to set correct track dimensions
    fn patch_tkhd(data: &mut [u8], width: u16, height: u16) -> bool {
        // Search for "tkhd" pattern
        for i in 0..data.len().saturating_sub(92) {
            if &data[i..i+4] == b"tkhd" {
                let version = data[i + 4];

                // Calculate offset for width/height based on version
                // Version 0: width at +80, height at +84 from 'tkhd' start
                // Version 1: width at +92, height at +96 from 'tkhd' start
                let (width_offset, height_offset) = if version == 0 {
                    (i + 80, i + 84)  // Relative to 'tkhd' type field
                } else {
                    (i + 92, i + 96)
                };

                if height_offset + 4 <= data.len() {
                    // Width and height are stored as 16.16 fixed-point
                    let width_fixed = (width as u32) << 16;
                    let height_fixed = (height as u32) << 16;

                    data[width_offset..width_offset+4].copy_from_slice(&width_fixed.to_be_bytes());
                    data[height_offset..height_offset+4].copy_from_slice(&height_fixed.to_be_bytes());

                    debug!("Patched tkhd dimensions to {}x{} (fixed: 0x{:08X}, 0x{:08X})",
                           width, height, width_fixed, height_fixed);
                    return true;
                }
            }
        }
        false
    }

    /// Patch moof for MSE streaming compatibility.
    /// Windows SinkWriter uses absolute file offsets in tfhd/trun which breaks MSE.
    /// Also injects tfdt if missing (required by Chrome MSE).
    fn patch_moof(&mut self, mut data: Vec<u8>) -> Vec<u8> {
        if data.len() < 8 { return data; }

        let moof_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if moof_size > data.len() { return data; }

        // Find tfhd, tfdt, trun, and traf within moof
        let mut i = 8; // Skip moof header
        let mut tfhd_offset = None;
        let mut tfdt_offset = None;
        let mut trun_offset = None;
        let mut traf_offset = None;

        while i + 8 <= moof_size {
            let box_size = u32::from_be_bytes([data[i], data[i+1], data[i+2], data[i+3]]) as usize;
            if box_size < 8 || i + box_size > moof_size { break; }

            let box_type = &data[i+4..i+8];

            match box_type {
                b"mfhd" => {
                    // Movie fragment header - skip
                }
                b"traf" => {
                    traf_offset = Some(i);

                    // Parse traf children
                    let mut j = i + 8;
                    let traf_end = i + box_size;

                    while j + 8 <= traf_end {
                        let child_size = u32::from_be_bytes([data[j], data[j+1], data[j+2], data[j+3]]) as usize;
                        if child_size < 8 || j + child_size > traf_end { break; }

                        let child_type = &data[j+4..j+8];
                        match child_type {
                            b"tfhd" => tfhd_offset = Some(j),
                            b"tfdt" => tfdt_offset = Some(j),
                            b"trun" => trun_offset = Some(j),
                            _ => {}
                        }
                        j += child_size;
                    }
                }
                _ => {}
            }
            i += box_size;
        }

        // Patch tfhd: remove base-data-offset and set default-base-is-moof flag
        // This is required for MSE streaming where each segment is self-contained
        let mut size_reduction = 0i32;
        if let Some(off) = tfhd_offset {
            if off + 16 <= data.len() {
                let flags = u32::from_be_bytes([0, data[off+9], data[off+10], data[off+11]]);

                if flags & 0x000001 != 0 {
                    // base-data-offset-present is set - we need to remove it
                    // and set default-base-is-moof (0x020000) instead

                    // New flags: remove 0x000001, add 0x020000
                    let new_flags = (flags & !0x000001) | 0x020000;
                    data[off+9] = ((new_flags >> 16) & 0xFF) as u8;
                    data[off+10] = ((new_flags >> 8) & 0xFF) as u8;
                    data[off+11] = (new_flags & 0xFF) as u8;

                    // Remove the 8-byte base_data_offset field at offset +16
                    let remove_start = off + 16;
                    let remove_end = off + 24;
                    if remove_end <= data.len() {
                        data.drain(remove_start..remove_end);
                        size_reduction = 8;

                        // Update tfhd size (subtract 8)
                        let old_tfhd_size = u32::from_be_bytes([data[off], data[off+1], data[off+2], data[off+3]]);
                        let new_tfhd_size = old_tfhd_size - 8;
                        data[off..off+4].copy_from_slice(&new_tfhd_size.to_be_bytes());

                        debug!("Patched tfhd: removed base_data_offset, set default-base-is-moof flag");
                    }
                }
            }
        }

        // Update traf size if we removed bytes
        if size_reduction > 0 {
            if let Some(off) = traf_offset {
                let old_size = u32::from_be_bytes([data[off], data[off+1], data[off+2], data[off+3]]);
                let new_size = (old_size as i32 - size_reduction) as u32;
                data[off..off+4].copy_from_slice(&new_size.to_be_bytes());
            }

            // Update moof size
            let old_moof_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
            let new_moof_size = (old_moof_size as i32 - size_reduction) as u32;
            data[0..4].copy_from_slice(&new_moof_size.to_be_bytes());

            // Adjust trun_offset since we removed bytes before it
            if let Some(old_off) = trun_offset {
                trun_offset = Some((old_off as i32 - size_reduction) as usize);
            }
        }

        // If tfdt is missing, we need to inject it (required by Chrome MSE)
        // tfdt v0: 16 bytes (size=4, type=4, version+flags=4, baseMediaDecodeTime=4)
        let tfdt_box_size = 16u32;
        let needs_tfdt = tfdt_offset.is_none();

        if needs_tfdt {
            if let (Some(tfhd_off), Some(traf_off)) = (tfhd_offset, traf_offset) {
                // Read CURRENT tfhd size from data (after any drain modifications)
                let current_tfhd_size = u32::from_be_bytes([data[tfhd_off], data[tfhd_off+1], data[tfhd_off+2], data[tfhd_off+3]]) as usize;
                let insert_point = tfhd_off + current_tfhd_size;

                // Create tfdt box: version 0, baseMediaDecodeTime = cumulative time so far
                let mut tfdt_box = Vec::with_capacity(16);
                tfdt_box.extend_from_slice(&tfdt_box_size.to_be_bytes()); // size
                tfdt_box.extend_from_slice(b"tfdt"); // type
                tfdt_box.extend_from_slice(&0u32.to_be_bytes()); // version 0 + flags 0
                tfdt_box.extend_from_slice(&(self.cumulative_decode_time as u32).to_be_bytes()); // baseMediaDecodeTime

                // Insert tfdt into data
                data.splice(insert_point..insert_point, tfdt_box.iter().cloned());

                // Update traf size: read CURRENT size from data and add 16
                let current_traf_size = u32::from_be_bytes([data[traf_off], data[traf_off+1], data[traf_off+2], data[traf_off+3]]);
                let new_traf_size = current_traf_size + tfdt_box_size;
                data[traf_off..traf_off+4].copy_from_slice(&new_traf_size.to_be_bytes());

                // Update moof size: read CURRENT size from data and add 16
                let current_moof_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                let new_moof_size = current_moof_size + tfdt_box_size;
                data[0..4].copy_from_slice(&new_moof_size.to_be_bytes());

                debug!("Injected tfdt box (16 bytes) at offset {} (tfhd_size={})", insert_point, current_tfhd_size);

                // Recalculate trun_offset since we inserted bytes
                if let Some(old_trun_off) = trun_offset {
                    trun_offset = Some(old_trun_off + tfdt_box_size as usize);
                }
            }
        }

        // Patch trun: set data_offset to point to start of mdat payload
        // Must be done AFTER tfdt injection since moof size changed
        if let Some(off) = trun_offset {
            if off + 16 <= data.len() {
                let flags = u32::from_be_bytes([0, data[off+9], data[off+10], data[off+11]]);

                if flags & 0x000001 != 0 {
                    // data-offset-present - update it
                    if off + 20 <= data.len() {
                        // data_offset = new_moof_size + 8 (mdat header)
                        let current_moof_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                        let data_offset = current_moof_size + 8;
                        data[off+16..off+20].copy_from_slice(&data_offset.to_be_bytes());
                        debug!("Patched trun: set data_offset to {}", data_offset);
                    }
                }
            }
        }
        // Extract sample_count from trun and advance cumulative_decode_time
        // At 60fps with timescale 60000, each sample is 1000 ticks
        if let Some(off) = trun_offset {
            if off + 16 <= data.len() {
                let sample_count = u32::from_be_bytes([data[off+12], data[off+13], data[off+14], data[off+15]]);
                self.cumulative_decode_time += (sample_count as u64) * 1000; // 1000 ticks per frame at 60fps/60000 timescale
            }
        }

        data
    }

    fn patch_moov(data: Vec<u8>) -> Vec<u8> {
        if data.len() < 8 { return data; }

        let mut cursor = Cursor::new(&data);
        let total_size = match cursor.read_u32::<BigEndian>() {
            Ok(s) => s as usize,
            Err(_) => return data,
        };

        if total_size != data.len() { return data; }

        cursor.set_position(8); // Skip type (moov)

        let mut new_payload = Vec::new();
        let mut found_iods = false;

        loop {
            let start_pos = cursor.position() as usize;
            if start_pos >= data.len() { break; }

            let child_size = match cursor.read_u32::<BigEndian>() {
                Ok(s) => s as usize,
                Err(_) => break,
            };

            if child_size < 8 || start_pos + child_size > data.len() { break; }

            let mut type_buf = [0u8; 4];
            if cursor.read_exact(&mut type_buf).is_err() { break; }

            let type_str = String::from_utf8_lossy(&type_buf);

            if type_str == "iods" {
                found_iods = true;
                cursor.set_position((start_pos + child_size) as u64);
            } else {
                new_payload.extend_from_slice(&data[start_pos..start_pos + child_size]);
                cursor.set_position((start_pos + child_size) as u64);
            }
        }

        let mut result = if found_iods {
            let new_size = 8 + new_payload.len();
            let mut new_moov = Vec::with_capacity(new_size);
            let _ = new_moov.write_u32::<BigEndian>(new_size as u32);
            let _ = new_moov.write(&b"moov"[..]);
            let _ = new_moov.write(&new_payload);
            new_moov
        } else {
            data
        };

        // CRITICAL: Patch tkhd dimensions using avc1 dimensions
        // Windows Media Foundation SinkWriter often leaves tkhd width/height as 0
        if let Some((width, height)) = Self::find_avc1_dimensions(&result) {
            if !Self::patch_tkhd(&mut result, width, height) {
                error!("Failed to patch tkhd dimensions!");
            }
        } else {
            error!("Could not find avc1 dimensions to patch tkhd!");
        }

        result
    }

    pub fn parse(&mut self, chunk: &[u8]) -> Vec<Mp4Segment> {
        self.buffer.extend_from_slice(chunk);
        let mut segments = Vec::new();

        loop {
            if self.buffer.len() < 8 { break; }

            let mut cursor = Cursor::new(&self.buffer);
            let atom_size = match cursor.read_u32::<BigEndian>() {
                Ok(s) => s as usize,
                Err(_) => break,
            };

            if atom_size < 8 { 
                // Recovery: skip 1 byte if invalid
                self.buffer.remove(0);
                continue;
            }
            if self.buffer.len() < atom_size { break; }

            let atom_type_str = String::from_utf8_lossy(&self.buffer[4..8]).to_string();
            let atom_data: Vec<u8> = self.buffer.drain(0..atom_size).collect();

            match atom_type_str.as_str() {
                "ftyp" => {
                    // Pass through original ftyp
                    self.init_segment.extend_from_slice(&atom_data);
                },
                "moov" | "free" | "meta" | "skip" if !self.init_complete => {
                    let data_to_add = if atom_type_str == "moov" {
                        Self::patch_moov(atom_data)
                    } else {
                        atom_data
                    };
                    
                    self.init_segment.extend_from_slice(&data_to_add);
                    
                    if atom_type_str == "moov" {
                        let has_mvex = self.init_segment.windows(4).any(|w| w == b"mvex");
                        if !has_mvex {
                            error!("MP4Parser: 'moov' atom missing 'mvex' box! MSE playback will likely fail.");
                        }

                        self.init_complete = true;
                        segments.push(Mp4Segment {
                            kind: SegmentType::Init,
                            data: std::mem::take(&mut self.init_segment),
                        });
                    }
                },
                "moof" => {
                    if self.init_complete {
                        // Patch moof for MSE compatibility
                        self.pending_moof = self.patch_moof(atom_data);
                    }
                },
                "mdat" => {
                    if self.init_complete {
                        if !self.pending_moof.is_empty() {
                            let mut combined = Vec::new();
                            combined.extend_from_slice(&self.pending_moof);
                            combined.extend_from_slice(&atom_data);
                            segments.push(Mp4Segment {
                                kind: SegmentType::Media,
                                data: combined,
                            });
                            self.pending_moof.clear();
                        } else {
                            segments.push(Mp4Segment {
                                kind: SegmentType::Media,
                                data: atom_data,
                            });
                        }
                    }
                },
                _ => {
                    if self.init_complete {
                        segments.push(Mp4Segment {
                            kind: SegmentType::Media,
                            data: atom_data,
                        });
                    }
                }
            }
        }
        segments
    }
}