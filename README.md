# RatLab (formerly PlayerStoryteller)

**Turn RimWorld into a massive social experiment.** RatLab allows your viewers to interact directly with your game through a live web dashboard—spawning items, triggering raids, and managing the chaos—all with **minimal performance impact** on your game.

![RatLab Interface](https://ratlab.online/assets/preview.png)

## Features

### 👁️ The "Optical View" (New in 3.0)
RatLab introduces a groundbreaking **Live Optical View** that reconstructs the game world in the browser:
*   **Zero-Lag "My Pawn" Feed:** Adopters get a private, 60fps tactical view of their pawn that moves smoothly independently of the video stream.
*   **Sub-Pixel Rendering:** Custom canvas engine with smooth camera tracking that locks to pawn movement.
*   **Direct Memory Access:** Optimized data polling (10Hz) bypasses standard API calls for ultra-low latency updates.

### 🚀 Hybrid Architecture
Previous streaming mods slowed RimWorld down by forcing the Unity engine to compress video. RatLab uses a **Triple-Tier Strategy**:
*   **Ultrafast Tier (10Hz):** Direct memory access sends lightweight pawn positions and health data instantly.
*   **Fast Tier (1Hz):** Scans visible terrain, items, and buildings for the Optical View.
*   **Slow Tier (5s+):** Updates heavy data like inventories, skills, and world stats.
*   **Sidecar Process:** A separate, lightweight Go process handles video capture (if enabled), keeping the game thread free.

### 🎮 For Viewers: God Mode
Viewers access your colony via **[ratlab.online](https://ratlab.online)**. No Twitch account required.
*   **Adoption System:** Viewers can "Adopt" a colonist to get a private control panel and live feed.
*   **Real-Time Dashboard:** Monitor colony wealth, power consumption, and faction relations.
*   **Interactive Pings:** Click anywhere on the video to spawn visual markers in-game for the streamer.
*   **Live Inventory:** Inspect every stockpile and colonist inventory in real-time.

### 🛠️ For Streamers: Total Control
*   **Economy Management:** Set passive income rates and individual action prices.
*   **Voting Queue:** Viewers vote on events before they happen.
*   **Full DLC Support:**
    *   **Royalty:** Tribute Collectors, Anima Trees.
    *   **Ideology:** Rituals, Hacker Camps.
    *   **Biotech:** Bossgroups, Wastepacks, Genepacks.
    *   **Anomaly:** Death Palls, Golden Cubes, Pit Gates.
    *   **Odyssey:** (Custom Mod Support)

## Installation

1.  **Subscribe:** Get "RatLab" on the Steam Workshop.
2.  **Launch:** Start RimWorld. The mod automatically launches the Sidecar process.
3.  **Connect:** Copy your **Session Link** from the in-game settings window.
4.  **Share:** Send the link to your viewers.

## Repository Structure

This monorepo contains the entire RatLab ecosystem:

*   **`Ratlab Mod/`**: The C# RimWorld mod source code.
    *   *Core:* `PlayerStorytellerMapComponent.cs` (Orchestrator)
    *   *Polling:* `GameDataPoller.cs` (Optimized memory access)
    *   *Logic:* `GameActionExecutor.cs` (Event triggers)
*   **`Ratlab Server/`**: The Node.js backend and web dashboard frontend.
    *   *Viewer:* `public/js/viewer/` (MapRenderer, Colonists, Optical Engine)
    *   *Server:* `src/` (Socket.io, Session Store, API Routes)
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
