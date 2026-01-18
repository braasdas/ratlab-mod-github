# RatLab Setup Guide

## Installation

1.  **Subscribe:** Subscribe to "RatLab (PlayerStoryteller)" on the Steam Workshop.
2.  **Dependencies:** Ensure you have "Harmony" installed and loaded before RatLab.
3.  **Load Order:**
    *   Harmony
    *   Core
    *   ...
    *   RatLab

## Configuration

1.  Launch RimWorld and load your save game.
2.  Go to **Options -> Mod Settings -> Rat Lab**.
3.  **First Run:** Click "Accept" on the Privacy Notice.

### Dashboard Setup
*   **Session Link:** Click "Copy Dashboard Link" to get your unique URL (e.g., `ratlab.online?session=...`). Share this with your chat.
*   **Stream Key:** This is auto-generated. Do not share it! It authenticates your game to the server.

### Performance Tuning
*   **Optical View:** Enable "Live Optical View" to allow viewers to inspect the map.
    *   *Note:* This uses negligible CPU but requires ~500kbps upload bandwidth.
*   **Video Quality:**
    *   **Low (1000kbps):** For slow connections.
    *   **Medium (2500kbps):** Recommended.
    *   **High (4500kbps):** Crisp visuals, requires decent internet.
*   **Data Rates:** The mod automatically manages polling rates (10Hz/1Hz). You generally do not need to adjust the manual sliders unless you have a very slow PC.

## Usage

1.  **Start Playing:** The mod activates when you load a map.
2.  **Check Connection:** Open your Dashboard link. You should see "Live" status.
3.  **Adoptions:** Viewers can click "Adopt" on a colonist card to take control.

## Troubleshooting

### "Stream Offline"
*   Ensure your firewall allows `ratlab-sidecar.exe` (found in the mod's `rust-sidecar` folder) to access the internet.
*   Restart the game to force a clean session handshake.

### "Optical View Laggy"
*   The Optical View is prioritized for *smoothness* over latency. It typically trails the game by 1-2 seconds.
*   If pawns are "rubber-banding", ensure your upload speed supports the chosen Video Quality setting.

### "Driver Warning"
*   The Rust sidecar attempts to use hardware encoding (NVIDIA NVENC, AMD AMF, or Intel QSV) for zero-impact video capture.
*   If hardware encoding is unavailable, it falls back to CPU encoding. This works but may reduce game FPS.
*   Update your GPU drivers to enable hardware acceleration.
