# RatLab (formerly PlayerStoryteller)

**Turn RimWorld into a massive social experiment.** RatLab allows your viewers to interact directly with your game through a live web dashboard—spawning items, triggering raids, and managing the chaos—all with **zero performance impact** on your game.

![RatLab Interface](https://ratlab.online/assets/preview.png)

## Features

### 🚀 The "Sidecar" Architecture (New in 2.0)
Previous streaming mods slowed RimWorld down by forcing the Unity engine to compress video. RatLab uses a revolutionary **Hybrid Architecture**:
*   **Zero-Overhead Capture:** A separate, lightweight "Sidecar" process (written in Go) captures your window directly. Your game runs at full speed.
*   **Smooth 30 FPS:** Decoupled rendering means viewers get a smooth feed even when your colony is lagging from 500 tribal raiders.
*   **Firewall Bypass:** Uses standard secure web ports (WSS/443). Host from strict networks (dorms, offices) without port forwarding.

### 🎮 For Viewers: God Mode
Viewers access your colony via **[ratlab.online](https://ratlab.online)**. No Twitch account required.
*   **Interactive Pings:** Click anywhere on the video to spawn visual markers in-game for the streamer.
*   **Live Inventory:** Inspect every stockpile and colonist inventory in real-time.
*   **Full Biography:** View traits, health conditions, and mood breakdowns instantly.
*   **Real-Time Dashboard:** Monitor colony wealth, power consumption, and faction relations.

### 🛠️ For Streamers: Total Control
*   **Economy Management:** Set passive income rates and individual action prices.
*   **Granular Cooldowns:** Prevent spam with global or per-action cooldowns.
*   **Karma Balancing:** Force a balance between "Good" (Healing, Drops) and "Bad" (Raids) events.
*   **Full DLC Support:**
    *   **Royalty:** Tribute Collectors, Anima Trees.
    *   **Ideology:** Rituals, Hacker Camps.
    *   **Biotech:** Bossgroups, Wastepacks, Genepacks.
    *   **Anomaly:** Death Palls, Golden Cubes, Pit Gates.

## Installation

1.  **Subscribe:** Get "RatLab" on the Steam Workshop.
2.  **Launch:** Start RimWorld. The mod automatically launches the Sidecar process.
3.  **Connect:** Copy your **Session Link** from the in-game settings window.
4.  **Share:** Send the link to your viewers.

## Repository Structure

This monorepo contains the entire RatLab ecosystem:

*   **`Ratlab Mod/`**: The C# RimWorld mod source code.
*   **`Ratlab Server/`**: The Node.js backend and web dashboard frontend.
*   **`go-sidecar/`**: The Go source code for the video streaming sidecar.

## Development

### Prerequisites
*   Visual Studio 2022 (C#)
*   Go 1.21+
*   Node.js 18+
*   FFmpeg (for Sidecar compilation)

### Build Instructions
See [DEVELOPER.md](Ratlab%20Mod/DEVELOPER.md) for detailed build and debugging instructions.

## Privacy & Security

*   **IP Masking:** Viewers connect to our cloud relay server, never directly to you. Your IP is hidden.
*   **Encryption:** All data is transmitted via encrypted WebSocket (WSS).
*   **Data Persistence:** No video is recorded. Session data is wiped from RAM when the session ends.
*   **Open Source:** The "Sidecar" executable is open source and can be audited in the `go-sidecar/` directory.

## Credits
*   **Concept & Code:** Benjamin
*   **Art:** [Artist Name]
*   **Dependency:** RIMAPI by aenclave

---
**[Dashboard](https://ratlab.online)** | **[Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3593423732)**
