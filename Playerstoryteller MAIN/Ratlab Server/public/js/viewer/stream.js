import { STATE } from './state.js';
import { CONFIG } from './config.js';
import { showFeedback, hideLoading } from './ui.js';

// Local state for stream logic
let stuckCounter = 0;
let lastVideoTime = 0;
let streamMonitorInterval = null;

export function initializeStream(sessionId) {
    if (STATE.useHLS) {
        initializeHLS(sessionId);
    } else {
        initializeWebSocket(sessionId);
    }
}

export function stopStream() {
    if (STATE.streamWebSocket) {
        STATE.streamWebSocket.close();
        STATE.streamWebSocket = null;
    }

    if (STATE.hls) {
        STATE.hls.destroy();
        STATE.hls = null;
    }

    if (streamMonitorInterval) {
        clearInterval(streamMonitorInterval);
        streamMonitorInterval = null;
    }

    cleanupMediaSource(true);
    STATE.streamConnected = false;
    updateStreamStatus(false);
}

// ============================================================================
// WEBSOCKET & MSE LOGIC
// ============================================================================

function initializeWebSocket(sessionId) {
    if (STATE.streamWebSocket) {
        STATE.streamWebSocket.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    STATE.streamWebSocket = new WebSocket(`${protocol}//${window.location.host}/stream?session=${sessionId}`);
    STATE.streamWebSocket.binaryType = 'arraybuffer';

    STATE.streamWebSocket.onopen = () => {
        console.log('[Stream] WebSocket Connected');
        STATE.streamConnected = true;
        STATE.useWebSocket = true;
        updateStreamStatus(true);
        hideLoading();
        showFeedback('success', 'Live Stream Connected');

        initializeMediaSource();
        startStreamMonitor();
    };

    STATE.streamWebSocket.onmessage = (event) => {
        handleSegment(event.data);
    };

    STATE.streamWebSocket.onclose = (event) => {
        console.log(`[Stream] WebSocket Closed (Code: ${event.code})`);
        STATE.streamConnected = false;
        updateStreamStatus(false);
        cleanupMediaSource(true);

        if (streamMonitorInterval) {
            clearInterval(streamMonitorInterval);
            streamMonitorInterval = null;
        }

        if (STATE.currentSession && !STATE.useHLS) {
            setTimeout(() => {
                console.log('[Stream] Attempting to reconnect...');
                initializeWebSocket(sessionId);
            }, 2000);
        }
    };

    STATE.streamWebSocket.onerror = (error) => {
        console.error('[Stream] WebSocket Error:', error);
        showFeedback('error', 'Stream Connection Error');
    };
}

// ============================================================================
// MEDIA SOURCE EXTENSIONS (MSE)
// ============================================================================

function initializeMediaSource() {
    if (STATE.mediaSource) {
        try {
            if (STATE.mediaSource.readyState === 'open') STATE.mediaSource.endOfStream();
        } catch (e) { }
        STATE.mediaSource = null;
    }

    STATE.mediaSource = new MediaSource();
    const video = document.getElementById('game-screenshot');

    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
    }
    video.src = URL.createObjectURL(STATE.mediaSource);
    video.style.display = 'block';

    video.controls = false;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    // Dynamically update container size when video dimensions are known
    const updateViewportSize = () => {
        const viewport = document.getElementById('visual-viewport');
        if (viewport && video.videoWidth && video.videoHeight) {
            // Calculate height based on viewport width and video aspect ratio
            const aspectRatio = video.videoHeight / video.videoWidth;
            const viewportWidth = viewport.offsetWidth;
            const newHeight = Math.round(viewportWidth * aspectRatio);

            // Set explicit height and mark as having video
            viewport.style.height = `${newHeight}px`;
            viewport.classList.add('has-video');

            console.log(`[MSE] Updated viewport: ${viewportWidth}x${newHeight} (video: ${video.videoWidth}x${video.videoHeight})`);
        }
    };

    // Update on various events
    video.addEventListener('loadedmetadata', updateViewportSize);
    video.addEventListener('resize', updateViewportSize);
    video.addEventListener('playing', updateViewportSize);

    // Also update on window resize
    window.addEventListener('resize', updateViewportSize);

    // Poll for dimensions since MSE doesn't always fire events reliably
    const dimensionPoll = setInterval(() => {
        if (video.videoWidth && video.videoHeight) {
            updateViewportSize();
            clearInterval(dimensionPoll);
        }
    }, 100);

    const streamDisabledOverlay = document.getElementById('stream-disabled');
    if (streamDisabledOverlay) {
        streamDisabledOverlay.classList.remove('flex');
        streamDisabledOverlay.classList.add('hidden');
    }

    STATE.mediaSource.addEventListener('sourceopen', () => {
        console.log(`[MSE] MediaSource opened`);

        // Attempt to create SourceBuffer if we have the init segment in sticky buffer
        if (STATE.stickyBuffer && STATE.stickyBuffer.length > 0) {
            const type = identifySegmentType(STATE.stickyBuffer);
            if (type === 'init') {
                const codec = getCodecFromBuffer(STATE.stickyBuffer);
                createSourceBuffer(codec);
            }
        }

        // Re-append cached init segment on reconnect/late join if SourceBuffer not created yet
        if (STATE.cachedInitSegment && !STATE.sourceBuffer) {
            console.log(`[MSE] Restoring cached init segment`);
            const codec = getCodecFromBuffer(STATE.cachedInitSegment);
            createSourceBuffer(codec);
            STATE.h264Queue.unshift(STATE.cachedInitSegment);
        }

        // Process any buffered segments
        if (STATE.stickyBuffer.length > 0) {
            STATE.h264Queue.push(STATE.stickyBuffer);
            STATE.stickyBuffer = new Uint8Array(0);
        }

        if (STATE.h264Queue.length > 0) {
            processQueue();
        }
    });
}

function createSourceBuffer(codec) {
    if (STATE.sourceBuffer) return;
    if (!STATE.mediaSource || STATE.mediaSource.readyState !== 'open') return;

    try {
        console.log(`[MSE] Creating SourceBuffer with codec: ${codec}`);
        if (!MediaSource.isTypeSupported(codec)) {
            console.warn(`[MSE] Codec ${codec} may not be supported.`);
        }

        STATE.sourceBuffer = STATE.mediaSource.addSourceBuffer(codec);
        STATE.sourceBuffer.mode = 'sequence';

        STATE.sourceBuffer.addEventListener('updateend', () => {
            try {
                if (STATE.sourceBuffer && !STATE.sourceBuffer.updating && STATE.mediaSource.readyState === 'open') {
                    const video = document.getElementById('game-screenshot');
                    if (STATE.sourceBuffer.buffered.length > 0 && video.paused && video.readyState >= 2) {
                        video.play().catch(e => console.log('[MSE] Play prevented:', e));
                    }
                }
            } catch (e) {
                console.warn('[MSE] Error in updateend:', e);
            }
            processQueue();
        });

        STATE.sourceBuffer.addEventListener('error', (e) => {
            console.error('[MSE] SourceBuffer error:', e);
            if (STATE._lastAppendedSegment) {
                const seg = STATE._lastAppendedSegment;
                console.error(`[MSE] Error occurred while appending: ${seg.type} segment (${seg.size} bytes)`);
                console.error(`[MSE] First 32 bytes: ${Array.from(seg.data.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
            }
            if (STATE.sourceBuffer && STATE.sourceBuffer.error) {
                console.error('[MSE] SourceBuffer inner error:', STATE.sourceBuffer.error);
            }
        });
    } catch (error) {
        console.error('[MSE] Failed to create SourceBuffer:', error);
    }
}

/**
 * Handle incoming segment from WebSocket.
 */
function handleSegment(arrayBuffer) {
    try {
        const segment = new Uint8Array(arrayBuffer);
        const segmentType = identifySegmentType(segment);

        // Always cache init segment immediately, even if MediaSource isn't ready
        if (segmentType === 'init') {
            console.log(`[MSE] Caching init segment (${segment.byteLength} bytes)`);
            STATE.cachedInitSegment = segment;
            STATE.initSegmentReceived = true;
        }

        // Recovery: Restart MediaSource if closed
        if (!STATE.mediaSource || STATE.mediaSource.readyState === 'closed') {
            console.warn('[MSE] MediaSource is closed. Attempting restart...');
            cleanupMediaSource();
            initializeMediaSource();
            STATE.stickyBuffer = new Uint8Array(0);
            STATE.initSegmentReceived = !!STATE.cachedInitSegment;
            // Don't return - continue to queue the segment below
        }


        // (segment and segmentType already declared above)


        // If MediaSource not ready yet, buffer the segment
        if (STATE.mediaSource.readyState !== 'open') {
            const newBuffer = new Uint8Array(STATE.stickyBuffer.length + segment.length);
            newBuffer.set(STATE.stickyBuffer, 0);
            newBuffer.set(segment, STATE.stickyBuffer.length);
            STATE.stickyBuffer = newBuffer;
            return;
        }

        if (segmentType === 'init') {
            console.log(`[MSE] Received Init Segment (${segment.byteLength} bytes)`);

            // DEBUG: Dump full atom structure
            dumpInitSegment(segment);
        }
        else if (segmentType === 'media') {
            // DEBUG: Dump first media segment structure
            if (!STATE._firstMediaSegmentLogged) {
                STATE._firstMediaSegmentLogged = true;
                dumpMediaSegment(segment);
            }
        }

        if (segmentType === 'init') {
            // Validate init segment has mvex (required for fMP4)
            if (!validateInitSegment(segment)) {
                console.error('[MSE] Init segment validation failed - missing mvex box');
            }

            // Cache for late joiners and reconnects
            STATE.cachedInitSegment = segment;
            STATE.initSegmentReceived = true;

            // DYNAMIC CODEC DETECTION
            if (!STATE.sourceBuffer) {
                const codec = getCodecFromBuffer(segment);
                createSourceBuffer(codec);
            }
        }
        else if (segmentType === 'media') {
            // Drop media segments if we haven't received init yet
            if (!STATE.initSegmentReceived && !STATE.cachedInitSegment) {
                console.warn('[MSE] Dropping media segment - no init segment received yet');
                return;
            }
        }
        else {
            console.warn(`[MSE] Unknown segment type, first bytes: ${segment.slice(0, 8).join(',')}`);
        }

        // Queue the complete segment for appending
        STATE.h264Queue.push(segment);
        processQueue();

    } catch (error) {
        console.error('[MSE] handleSegment error:', error);
    }
}

/**
 * Identify segment type by checking the first atom's type field.
 */
function identifySegmentType(segment) {
    if (segment.length < 8) return 'unknown';

    // Read atom type at bytes 4-7
    const atomType = String.fromCharCode(segment[4], segment[5], segment[6], segment[7]);

    if (atomType === 'ftyp') {
        return 'init';
    } else if (atomType === 'moof') {
        return 'media';
    }

    return 'unknown';
}

function getCodecFromBuffer(segment) {
    let videoCodec = null;
    let hasAudioTrack = false;

    // Search for 'avcC' (0x61766343) - H.264 config
    for (let i = 0; i < segment.length - 7; i++) {
        if (segment[i] === 0x61 && segment[i + 1] === 0x76 &&
            segment[i + 2] === 0x63 && segment[i + 3] === 0x43) {

            const profile = segment[i + 5];
            const compat = segment[i + 6];
            const level = segment[i + 7];
            const toHex = n => n.toString(16).toUpperCase().padStart(2, '0');
            videoCodec = `avc1.${toHex(profile)}${toHex(compat)}${toHex(level)}`;
            break;
        }
    }

    // Search for 'smhd' (sound media header) - indicates audio track exists
    for (let i = 0; i < segment.length - 4; i++) {
        if (segment[i] === 0x73 && segment[i + 1] === 0x6D &&
            segment[i + 2] === 0x68 && segment[i + 3] === 0x64) {
            hasAudioTrack = true;
            break;
        }
    }

    if (!videoCodec) {
        console.warn('[MSE] avcC box not found. Using fallback video codec.');
        videoCodec = 'avc1.42C02A';
    }

    // CRITICAL: Only declare audio codec if audio track actually exists
    let codecString;
    if (hasAudioTrack) {
        codecString = `video/mp4; codecs="${videoCodec}, mp4a.40.2"`;
        console.log(`[MSE] Detected codecs: ${videoCodec} (video) + AAC (audio)`);
    } else {
        codecString = `video/mp4; codecs="${videoCodec}"`;
        console.log(`[MSE] Detected codec: ${videoCodec} (video only - no audio track in init segment)`);
    }

    // Verify codec is supported
    const isSupported = MediaSource.isTypeSupported(codecString);
    console.log(`[MSE] MediaSource.isTypeSupported("${codecString}"): ${isSupported}`);
    if (!isSupported) {
        console.error(`[MSE] CODEC NOT SUPPORTED! This will cause SourceBuffer errors.`);
    }

    return codecString;
}

/**
 * Validate that init segment contains required mvex box for fMP4.
 */
function validateInitSegment(segment) {
    // Search for 'mvex' (0x6D766578)
    for (let i = 0; i < segment.length - 4; i++) {
        if (segment[i] === 0x6D && segment[i + 1] === 0x76 &&
            segment[i + 2] === 0x65 && segment[i + 3] === 0x78) {
            return true;
        }
    }
    return false;
}

/**
 * Debug: Parse and dump the atom structure of an init segment
 */
function dumpInitSegment(segment) {
    console.log(`[MSE DEBUG] === Init Segment Analysis (${segment.length} bytes) ===`);

    const readU32 = (arr, offset) => (arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3];
    const readType = (arr, offset) => String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2], arr[offset + 3]);

    function parseAtoms(data, offset, end, indent = '') {
        while (offset < end) {
            if (offset + 8 > end) break;

            let size = readU32(data, offset);
            const type = readType(data, offset + 4);

            // Handle size=1 (64-bit size) - rare but possible
            if (size === 1 && offset + 16 <= end) {
                // 64-bit size at offset+8
                size = readU32(data, offset + 12); // Just use lower 32 bits
                console.log(`${indent}[${type}] size=${size} (64-bit) @ offset ${offset}`);
                offset += 16;
            } else if (size === 0) {
                // size=0 means "rest of file"
                size = end - offset;
                console.log(`${indent}[${type}] size=${size} (extends to end) @ offset ${offset}`);
            } else if (size < 8) {
                console.error(`${indent}[ERROR] Invalid atom size ${size} at offset ${offset}`);
                break;
            } else {
                console.log(`${indent}[${type}] size=${size} @ offset ${offset}`);
            }

            // Container atoms - recurse into them
            const containers = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'dinf', 'edts'];
            if (containers.includes(type)) {
                parseAtoms(data, offset + 8, offset + size, indent + '  ');
            }

            // Special handling for important atoms
            if (type === 'stsd' && offset + 16 <= end) {
                const entryCount = readU32(data, offset + 12);
                console.log(`${indent}  -> entry_count=${entryCount}`);
                if (entryCount > 0 && offset + 24 <= end) {
                    const sampleSize = readU32(data, offset + 16);
                    const sampleType = readType(data, offset + 20);
                    console.log(`${indent}  -> sample: [${sampleType}] size=${sampleSize}`);

                    // Parse avc1 box contents
                    if (sampleType === 'avc1' && sampleSize >= 86) {
                        const avc1Start = offset + 16; // Start of avc1 box
                        const width = (data[avc1Start + 32] << 8) | data[avc1Start + 33];
                        const height = (data[avc1Start + 34] << 8) | data[avc1Start + 35];
                        const frameCount = (data[avc1Start + 48] << 8) | data[avc1Start + 49];
                        const depth = (data[avc1Start + 82] << 8) | data[avc1Start + 83];
                        console.log(`${indent}  -> avc1: width=${width}, height=${height}, frameCount=${frameCount}, depth=${depth}`);

                        // Look for avcC inside avc1 (starts after 86 bytes of avc1 base)
                        const avc1DataStart = avc1Start + 8; // Skip avc1 size+type
                        const avc1DataEnd = avc1Start + sampleSize;
                        for (let j = avc1DataStart + 78; j < avc1DataEnd - 8; j++) {
                            if (data[j] === 0x61 && data[j + 1] === 0x76 && data[j + 2] === 0x63 && data[j + 3] === 0x43) {
                                const avcCSize = readU32(data, j - 4);
                                const configVersion = data[j + 4];
                                const profile = data[j + 5];
                                const compat = data[j + 6];
                                const level = data[j + 7];
                                const lengthSize = (data[j + 8] & 0x03) + 1;
                                const numSPS = data[j + 9] & 0x1F;

                                console.log(`${indent}  -> avcC: size=${avcCSize}, configVersion=${configVersion}, profile=0x${profile.toString(16)}, compat=0x${compat.toString(16)}, level=0x${level.toString(16)}`);
                                console.log(`${indent}  -> avcC: lengthSize=${lengthSize}, numSPS=${numSPS}`);

                                if (numSPS > 0 && j + 11 < avc1DataEnd) {
                                    const spsLen = (data[j + 10] << 8) | data[j + 11];
                                    console.log(`${indent}  -> avcC: SPS[0] length=${spsLen}`);
                                    if (spsLen > 0 && j + 12 + spsLen <= avc1DataEnd) {
                                        // Parse SPS NAL header
                                        const spsNalHeader = data[j + 12];
                                        const nalType = spsNalHeader & 0x1F;
                                        console.log(`${indent}  -> avcC: SPS NAL type=${nalType} (should be 7)`);
                                    }

                                    // Find PPS after SPS
                                    const ppsCountOffset = j + 12 + spsLen;
                                    if (ppsCountOffset < avc1DataEnd) {
                                        const numPPS = data[ppsCountOffset];
                                        console.log(`${indent}  -> avcC: numPPS=${numPPS}`);
                                        if (numPPS > 0 && ppsCountOffset + 3 <= avc1DataEnd) {
                                            const ppsLen = (data[ppsCountOffset + 1] << 8) | data[ppsCountOffset + 2];
                                            console.log(`${indent}  -> avcC: PPS[0] length=${ppsLen}`);
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }

            if (type === 'avcC' && offset + 12 <= end) {
                const configVersion = data[offset + 8];
                const profile = data[offset + 9];
                const compat = data[offset + 10];
                const level = data[offset + 11];
                const toHex = n => n.toString(16).toUpperCase().padStart(2, '0');
                console.log(`${indent}  -> configVersion=${configVersion}, profile=${toHex(profile)}, compat=${toHex(compat)}, level=${toHex(level)}`);
                if (offset + 13 <= end) {
                    const numSPS = data[offset + 13] & 0x1F;
                    console.log(`${indent}  -> numSPS=${numSPS}`);
                }
            }

            if (type === 'mvhd' && offset + 20 <= end) {
                const version = data[offset + 8];
                let timescale, duration;
                if (version === 0) {
                    timescale = readU32(data, offset + 20);
                    duration = readU32(data, offset + 24);
                } else {
                    timescale = readU32(data, offset + 28);
                    duration = readU32(data, offset + 36); // Lower 32 bits
                }
                console.log(`${indent}  -> version=${version}, timescale=${timescale}, duration=${duration}`);
            }

            if (type === 'mdhd' && offset + 20 <= end) {
                const version = data[offset + 8];
                let timescale, duration;
                if (version === 0) {
                    timescale = readU32(data, offset + 20);
                    duration = readU32(data, offset + 24);
                } else {
                    timescale = readU32(data, offset + 28);
                    duration = readU32(data, offset + 36);
                }
                console.log(`${indent}  -> version=${version}, timescale=${timescale}, duration=${duration}`);
            }

            if (type === 'tkhd' && offset + 20 <= end) {
                const version = data[offset + 8];
                let trackWidth, trackHeight;
                // tkhd v0: width at +84, height at +88 (after 8-byte header + 76 bytes of fields)
                // tkhd v1: width at +96, height at +100 (12 extra bytes for 64-bit times)
                if (version === 0) {
                    trackWidth = readU32(data, offset + 84) / 65536; // Fixed 16.16
                    trackHeight = readU32(data, offset + 88) / 65536;
                } else {
                    trackWidth = readU32(data, offset + 96) / 65536;
                    trackHeight = readU32(data, offset + 100) / 65536;
                }
                console.log(`${indent}  -> version=${version}, trackWidth=${trackWidth}, trackHeight=${trackHeight}`);

                // Dump raw bytes for verification
                const tkhdHex = Array.from(data.slice(offset, offset + Math.min(size, 104)))
                    .map(b => b.toString(16).padStart(2, '0')).join(' ');
                console.log(`${indent}  -> tkhd raw hex: ${tkhdHex}`);
            }

            if (type === 'trex' && offset + 24 <= end) {
                const trackId = readU32(data, offset + 12);
                const defaultSampleDescIdx = readU32(data, offset + 16);
                const defaultSampleDuration = readU32(data, offset + 20);
                const defaultSampleSize = readU32(data, offset + 24);
                console.log(`${indent}  -> trackId=${trackId}, defaultDescIdx=${defaultSampleDescIdx}, defaultDuration=${defaultSampleDuration}, defaultSize=${defaultSampleSize}`);
            }

            if (type === 'ftyp') {
                const majorBrand = readType(data, offset + 8);
                const minorVersion = readU32(data, offset + 12);
                console.log(`${indent}  -> majorBrand="${majorBrand}", minorVersion=${minorVersion}`);
                // Compatible brands
                const brands = [];
                for (let b = offset + 16; b < offset + size; b += 4) {
                    brands.push(readType(data, b));
                }
                console.log(`${indent}  -> compatibleBrands: [${brands.join(', ')}]`);
            }

            offset += size;
        }
    }

    parseAtoms(segment, 0, segment.length);

    // Hex dump of first 128 bytes
    const hexDump = Array.from(segment.slice(0, Math.min(128, segment.length)))
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    console.log(`[MSE DEBUG] First 128 bytes hex: ${hexDump}`);

    // Make init segment downloadable for external analysis (mp4dump, ffprobe)
    window._lastInitSegment = segment;
    console.log(`[MSE DEBUG] Init segment saved to window._lastInitSegment. To download: saveInitSegment()`);

    console.log(`[MSE DEBUG] === End Init Segment Analysis ===`);
}

/**
 * Debug: Parse and dump the structure of a media segment (moof + mdat)
 */
function dumpMediaSegment(segment) {
    console.log(`[MSE DEBUG] === Media Segment Analysis (${segment.length} bytes) ===`);

    const readU32 = (arr, offset) => (arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3];
    const readU64 = (arr, offset) => {
        // For simplicity, just read lower 32 bits (sufficient for our purposes)
        return readU32(arr, offset + 4);
    };
    const readType = (arr, offset) => String.fromCharCode(arr[offset], arr[offset + 1], arr[offset + 2], arr[offset + 3]);

    let offset = 0;
    while (offset < segment.length) {
        if (offset + 8 > segment.length) break;

        const size = readU32(segment, offset);
        const type = readType(segment, offset + 4);

        if (size < 8) {
            console.error(`[MSE DEBUG] Invalid atom size ${size} at offset ${offset}`);
            break;
        }

        console.log(`[${type}] size=${size} @ offset ${offset}`);

        if (type === 'moof') {
            // Parse moof children
            let moofOffset = offset + 8;
            const moofEnd = offset + size;

            while (moofOffset < moofEnd) {
                if (moofOffset + 8 > moofEnd) break;
                const childSize = readU32(segment, moofOffset);
                const childType = readType(segment, moofOffset + 4);

                if (childSize < 8) break;
                console.log(`  [${childType}] size=${childSize} @ offset ${moofOffset}`);

                if (childType === 'mfhd' && moofOffset + 16 <= moofEnd) {
                    const sequenceNumber = readU32(segment, moofOffset + 12);
                    console.log(`    -> sequenceNumber=${sequenceNumber}`);
                }

                if (childType === 'traf') {
                    // Parse traf children
                    let trafOffset = moofOffset + 8;
                    const trafEnd = moofOffset + childSize;

                    while (trafOffset < trafEnd) {
                        if (trafOffset + 8 > trafEnd) break;
                        const trafChildSize = readU32(segment, trafOffset);
                        const trafChildType = readType(segment, trafOffset + 4);

                        if (trafChildSize < 8) break;
                        console.log(`    [${trafChildType}] size=${trafChildSize} @ offset ${trafOffset}`);

                        if (trafChildType === 'tfhd' && trafOffset + 16 <= trafEnd) {
                            const version = segment[trafOffset + 8];
                            const flags = (segment[trafOffset + 9] << 16) | (segment[trafOffset + 10] << 8) | segment[trafOffset + 11];
                            const trackId = readU32(segment, trafOffset + 12);
                            console.log(`      -> version=${version}, flags=0x${flags.toString(16)}, trackId=${trackId}`);

                            // Parse optional fields based on flags
                            let tfhdOffset = trafOffset + 16;
                            if (flags & 0x000001) { // base-data-offset-present
                                const baseDataOffset = readU64(segment, tfhdOffset);
                                console.log(`      -> baseDataOffset=${baseDataOffset}`);
                                tfhdOffset += 8;
                            }
                            if (flags & 0x000002) { // sample-description-index-present
                                const sampleDescIdx = readU32(segment, tfhdOffset);
                                console.log(`      -> sampleDescriptionIndex=${sampleDescIdx}`);
                                tfhdOffset += 4;
                            }
                            if (flags & 0x000008) { // default-sample-duration-present
                                const defaultDuration = readU32(segment, tfhdOffset);
                                console.log(`      -> defaultSampleDuration=${defaultDuration}`);
                                tfhdOffset += 4;
                            }
                            if (flags & 0x000010) { // default-sample-size-present
                                const defaultSize = readU32(segment, tfhdOffset);
                                console.log(`      -> defaultSampleSize=${defaultSize}`);
                                tfhdOffset += 4;
                            }
                            if (flags & 0x000020) { // default-sample-flags-present
                                const defaultFlags = readU32(segment, tfhdOffset);
                                console.log(`      -> defaultSampleFlags=0x${defaultFlags.toString(16)}`);
                            }
                            if (flags & 0x010000) { // default-base-is-moof
                                console.log(`      -> default-base-is-moof=true`);
                            }
                        }

                        if (trafChildType === 'tfdt' && trafOffset + 16 <= trafEnd) {
                            const version = segment[trafOffset + 8];
                            let baseMediaDecodeTime;
                            if (version === 0) {
                                baseMediaDecodeTime = readU32(segment, trafOffset + 12);
                            } else {
                                baseMediaDecodeTime = readU64(segment, trafOffset + 12);
                            }
                            console.log(`      -> version=${version}, baseMediaDecodeTime=${baseMediaDecodeTime}`);
                        }

                        if (trafChildType === 'trun' && trafOffset + 16 <= trafEnd) {
                            const version = segment[trafOffset + 8];
                            const flags = (segment[trafOffset + 9] << 16) | (segment[trafOffset + 10] << 8) | segment[trafOffset + 11];
                            const sampleCount = readU32(segment, trafOffset + 12);
                            console.log(`      -> version=${version}, flags=0x${flags.toString(16)}, sampleCount=${sampleCount}`);

                            let trunOffset = trafOffset + 16;
                            if (flags & 0x000001) { // data-offset-present
                                const dataOffset = readU32(segment, trunOffset);
                                console.log(`      -> dataOffset=${dataOffset} (should point into mdat)`);
                                trunOffset += 4;
                            }
                            if (flags & 0x000004) { // first-sample-flags-present
                                const firstSampleFlags = readU32(segment, trunOffset);
                                console.log(`      -> firstSampleFlags=0x${firstSampleFlags.toString(16)}`);
                            }
                        }

                        trafOffset += trafChildSize;
                    }
                }

                moofOffset += childSize;
            }
        }

        if (type === 'mdat') {
            console.log(`  -> mdat payload size: ${size - 8} bytes`);
        }

        offset += size;
    }

    // Hex dump of first 64 bytes
    const hexDump = Array.from(segment.slice(0, Math.min(64, segment.length)))
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    console.log(`[MSE DEBUG] First 64 bytes hex: ${hexDump}`);

    console.log(`[MSE DEBUG] === End Media Segment Analysis ===`);
}

// Helper to download init segment for external analysis
window.saveInitSegment = function () {
    if (!window._lastInitSegment) {
        console.error('No init segment captured yet');
        return;
    }
    const blob = new Blob([window._lastInitSegment], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'init_segment.mp4';
    a.click();
    URL.revokeObjectURL(url);
    console.log('Init segment downloaded as init_segment.mp4');
};

/**
 * Process queued segments by appending to SourceBuffer.
 */
function processQueue() {
    if (!STATE.sourceBuffer || STATE.sourceBuffer.updating || STATE.h264Queue.length === 0) {
        return;
    }

    if (!STATE.mediaSource || STATE.mediaSource.readyState !== 'open') {
        return;
    }

    const segment = STATE.h264Queue.shift();
    const segType = identifySegmentType(segment);
    console.log(`[MSE] Appending ${segType} segment (${segment.length} bytes)`);

    try {
        // Track what we're appending so error handler knows
        STATE._lastAppendedSegment = { type: segType, size: segment.length, data: segment };
        STATE.sourceBuffer.appendBuffer(segment);

        const video = document.getElementById('game-screenshot');
        video.style.display = 'block';

        const lastUpdate = document.getElementById('last-update');
        if (lastUpdate) {
            lastUpdate.textContent = `LAST UPDATE: ${new Date().toLocaleTimeString()} [LIVE FEED]`;
        }

        const streamDisabledOverlay = document.getElementById('stream-disabled');
        if (streamDisabledOverlay) {
            streamDisabledOverlay.classList.remove('flex');
            streamDisabledOverlay.classList.add('hidden');
        }

    } catch (err) {
        console.error('[MSE] Error appending buffer:', err);
        console.error('[MSE] Error details - name:', err.name, 'message:', err.message);
        console.error('[MSE] MediaSource state:', STATE.mediaSource?.readyState);
        console.error('[MSE] SourceBuffer updating:', STATE.sourceBuffer?.updating);
        console.error('[MSE] Segment size:', segment.length, 'First 16 bytes:',
            Array.from(segment.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));

        if (err.name === 'QuotaExceededError') {
            console.warn('[MSE] Buffer full. Cleaning up...');
            removeOldBuffer();
            STATE.h264Queue.unshift(segment); // Retry after cleanup
        } else if (err.name === 'InvalidStateError') {
            console.error('[MSE] Invalid State. Resetting MediaSource.');
            cleanupMediaSource();
            initializeMediaSource();
        }
    }
}

function removeOldBuffer() {
    if (!STATE.sourceBuffer || STATE.sourceBuffer.updating) return;

    const video = document.getElementById('game-screenshot');
    if (!video) return;

    try {
        const buffered = STATE.sourceBuffer.buffered;
        if (buffered.length > 0) {
            const start = buffered.start(0);
            const currentTime = video.currentTime;

            // Keep last 30 seconds
            const removeUntil = Math.max(start, currentTime - 30);

            if (removeUntil > start) {
                console.log(`[MSE] Removing buffer from ${start.toFixed(2)} to ${removeUntil.toFixed(2)}`);
                STATE.sourceBuffer.remove(start, removeUntil);
            }
        }
    } catch (e) {
        console.error('[MSE] Error removing buffer:', e);
    }
}

function cleanupMediaSource(full = false) {
    console.log(`[MSE] Cleaning up (full: ${full})`);
    if (STATE.sourceBuffer) {
        try {
            if (STATE.mediaSource && STATE.mediaSource.readyState === 'open') {
                STATE.mediaSource.removeSourceBuffer(STATE.sourceBuffer);
            }
        } catch (e) { }
        STATE.sourceBuffer = null;
    }
    STATE.h264Queue = [];
    if (full) {
        STATE.cachedInitSegment = null;
        STATE.initSegmentReceived = false;
        STATE.stickyBuffer = new Uint8Array(0);
    }
}

function startStreamMonitor() {
    if (streamMonitorInterval) clearInterval(streamMonitorInterval);

    stuckCounter = 0;
    lastVideoTime = 0;

    streamMonitorInterval = setInterval(() => {
        const video = document.getElementById('game-screenshot');
        if (!video || !STATE.sourceBuffer || !STATE.useWebSocket) return;

        try {
            const buffered = STATE.sourceBuffer.buffered;
            if (buffered.length > 0) {
                const bufferEnd = buffered.end(buffered.length - 1);
                const currentTime = video.currentTime;
                const latency = bufferEnd - currentTime;

                // Detect stuck playback
                if (!video.paused) {
                    if (Math.abs(currentTime - lastVideoTime) < 0.01) {
                        stuckCounter++;
                        if (stuckCounter > 2) {
                            console.warn('[MSE] Playback stuck! Seeking to live edge...');
                            video.currentTime = bufferEnd - 0.1;
                            stuckCounter = 0;
                        }
                    } else {
                        stuckCounter = 0;
                    }
                } else {
                    // Auto-resume if paused with buffer available
                    video.play().catch(() => {
                        if (!video.muted) {
                            video.muted = true;
                            video.play().catch(() => { });
                        }
                    });

                    if (latency > 1.0) {
                        video.currentTime = bufferEnd - 0.1;
                    }
                }
                lastVideoTime = currentTime;

                // Aggressive latency control - keep under 600ms
                if (latency > 0.6 && !video.paused) {
                    video.currentTime = bufferEnd - 0.1;
                }
            }
        } catch (e) {
            // Silently handle monitor errors
        }
    }, 1000);
}

function updateStreamStatus(active) {
    const indicator = document.getElementById('stream-status');
    if (indicator) {
        indicator.classList.toggle('active', active);
    }
}

// ============================================================================
// HLS FALLBACK (CDN)
// ============================================================================

function initializeHLS(sessionId) {
    const video = document.getElementById('game-screenshot');
    const hlsUrl = `${CONFIG.BUNNY_PULL_ZONE}/${sessionId}/playlist.m3u8`;

    if (Hls.isSupported()) {
        if (STATE.hls) STATE.hls.destroy();

        STATE.hls = new Hls({
            lowLatencyMode: false,
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            manifestLoadingTimeOut: 10000
        });

        STATE.hls.loadSource(hlsUrl);
        STATE.hls.attachMedia(video);

        STATE.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            video.muted = true;
            video.play().catch(() => { });
        });

        STATE.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hideLoading();
            showFeedback('success', 'CDN Stream Connected');
            STATE.streamConnected = true;
        });

        STATE.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('[HLS] Network error, trying to recover...');
                        STATE.hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('[HLS] Media error, trying to recover...');
                        STATE.hls.recoverMediaError();
                        break;
                    default:
                        STATE.hls.destroy();
                        break;
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
            video.play();
            hideLoading();
        });
    }
}