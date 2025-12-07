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
3.  **First Run:** You will see a Privacy Notice. Click "Accept" to continue. The mod streams data to an external server (`ratlab.online`).

### Settings Overview

*   **Dashboard Link:** Click "Copy Dashboard Link" to get your unique URL. Share this with your viewers.
*   **Admin Password (Stream Key):** This is your secret key. Do not show this on stream! It allows you to control the dashboard as an admin.
*   **Streaming Quality:**
    *   **Low (1000kbps):** Best for slow upload speeds.
    *   **Medium (2500kbps):** Good balance.
    *   **High (4500kbps):** Best visual quality (requires good internet).
    *   *Note: Changing quality requires a game restart or mod reload.*
*   **Dev Mode:** Only use this if you are running a local server instance. Keep unchecked for normal use.

## Usage

1.  **Start Playing:** Once you unpause the game, the mod automatically starts the "Sidecar" process.
2.  **Check Connection:** You should see a green connection status on your Dashboard link.
3.  **Viewer Interaction:** Viewers can now see your live stats, map, and trigger events using coins.

## Troubleshooting

### "Stream Offline" / Black Screen
*   Ensure your firewall allows `sidecar.exe` to access the internet.
*   Check if you have a strict NAT or VPN interfering with WebSocket connections.
*   Restart the game to reboot the sidecar process.

### "Driver Warning"
*   The mod attempts to use your GPU (NVIDIA/AMD) for video encoding.
*   If you see a warning, it means GPU encoding failed and it fell back to CPU encoding. This uses more system resources but should still work. Update your graphics drivers.

### Laggy Stream
*   Lower the **Streaming Quality** in Mod Settings.
*   Reduce the **Telemetry Intervals** sliders (move them to the right to update *less* frequently).