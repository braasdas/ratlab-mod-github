# RatLab Developer Guide

## Prerequisites

*   **C# Mod:** Visual Studio 2022 or JetBrains Rider (.NET Framework 4.7.2).
*   **Sidecar:** Rust 1.70+ with `cargo` (install via [rustup](https://rustup.rs/)).
*   **Server:** Node.js 18+ and npm.
*   **RimWorld:** Installed locally (for DLL references).

## Repository Structure

```
Playerstoryteller MAIN/
├── Ratlab Mod/             # C# Source Code (RimWorld Mod)
│   ├── Source/
│   │   ├── PlayerStorytellerMod.cs          # Main Entry & Settings UI
│   │   ├── PlayerStorytellerMapComponent.cs # Core Logic & Coroutines
│   │   ├── GameDataPoller.cs                # 10Hz/1Hz Data Fetching (Optimized)
│   │   ├── GameActionExecutor.cs            # 36+ Viewer Actions
│   │   ├── SidecarManager.cs                # Rust Sidecar Process Control
│   │   └── ViewerManager.cs                 # Adoption/Pawn Tracking
│   ├── About/              # Mod metadata
│   └── Assemblies/         # Compiled DLLs
├── Ratlab Server/          # Node.js Backend & Frontend
│   ├── src/                # Server logic (Socket.io, Routes)
│   ├── public/js/viewer/   # Frontend Engine
│   │   ├── mapRenderer.js  # Optical View Engine (Canvas 2D)
│   │   ├── terrainGrid.js  # RLE Decompression
│   │   └── gameData.js     # State Synchronization
│   └── public/             # Web Assets
├── rust-sidecar/           # Rust Streaming Service
│   ├── src/
│   │   ├── main.rs         # Entry & Window Capture
│   │   ├── websocket.rs    # WebSocket Connection
│   │   ├── encoder_patched.rs # H.264 Encoding
│   │   └── monitor.rs      # Parent Process Monitoring
│   └── Cargo.toml          # Rust Dependencies
└── build.bat               # All-in-one build script
```

## Building

### 1. The Mod (C#)
1.  Open `Ratlab Mod/Source/PlayerStoryteller.csproj` in Visual Studio.
2.  Update Reference Paths: Ensure `Assembly-CSharp.dll` and `UnityEngine.dll` point to your RimWorld installation (`RimWorld/RimWorldWin64_Data/Managed/`).
3.  **Optimization Note:** The mod uses `Newtonsoft.Json`. Ensure the DLL is in the `Assemblies` folder or referenced correctly.
4.  Build Solution (Release mode).
5.  Output `PlayerStoryteller.dll` will be placed in `Ratlab Mod/Assemblies/`.

### 2. The Sidecar (Rust)
1.  Navigate to `rust-sidecar/`.
2.  Run `cargo build --release`
3.  Output: `target/release/ratlab-sidecar.exe`
4.  The mod expects `ratlab-sidecar.exe` in `Ratlab Mod/rust-sidecar/` for distribution.
5.  **Note:** Hardware encoding (NVENC/AMF/QSV) requires appropriate GPU drivers.

### 3. The Server (Node.js)
1.  Navigate to `Ratlab Server/`.
2.  Run `npm install`.
3.  Run `node server.js` (defaults to port 3000).

## Debugging

### Local Development Loop
The mod allows switching between Production (`ratlab.online`) and Development (`localhost`) modes.

1.  **Start Server:** Run `node server.js` in `Ratlab Server/`.
2.  **Launch RimWorld:** Enable "RatLab" mod.
3.  **Configure:** Go to Options -> Mod Settings -> Rat Lab.
4.  **Enable Dev Mode:** Check **"Dev Mode (Use localhost:3000)"**.
5.  **Play:** Load a save. The mod will connect to your local server.
6.  **View:** Open `http://localhost:3000` in your browser.

### Logs
*   **Mod Logs:** RimWorld's `Player.log` (`%AppData%/../LocalLow/Ludeon Studios/RimWorld...`). Look for `[Player Storyteller]`.
    *   *Tip:* Use the in-game Debug Console (Development Mode) to see logs in real-time.
*   **Sidecar Logs:** Standard output (captured by SidecarManager). Check RimWorld logs for `[Sidecar]` prefixed messages.
*   **Server Logs:** Console output of the Node.js process. Note that high-frequency logs (Terrain/Things) are commented out by default to prevent spam.

## Architecture & Performance

### Data Streams
The mod uses a **Triple-Tier Strategy** to maintain 60FPS performance in-game:

1.  **Ultrafast Tier (10Hz):** `UpdatePawnPositionsAsync`
    *   **Method:** Direct Memory Access -> JSON -> WSS.
    *   **Content:** Pawn ID, X/Z position.
    *   **Goal:** Smooth interpolation in the Optical View.
2.  **Fast Tier (1Hz):** `UpdateLiveViewAsync`
    *   **Method:** `GenRadial` Scan -> Delta Check -> JSON.
    *   **Content:** Buildings, Items, Plants (Things).
    *   **Note:** Pawns are EXCLUDED from this stream to prevent "fighting" and duplication.
3.  **Slow Tier (5s+):** `UpdateColonistDetailsAsync`
    *   **Method:** API Call -> Heavy JSON.
    *   **Content:** Skills, Gear, Health, Needs.

### Optical View (Frontend)
The `MapRenderer.js` engine reconstructs the game world:
*   **Sub-Pixel Scrolling:** Camera coordinates are floats; rendering is offset by sub-pixel amounts for smooth movement.
*   **Camera Locking:** When following a pawn, the camera updates position **every animation frame** to match the interpolated dot position exactly.
*   **Texture Caching:** Textures are cached in IndexedDB. The backend flushes its "sent cache" every 30s to recover clients that refresh.

### Coding Standards
*   **Main Thread:** All RimWorld actions (spawning items, healing) MUST be executed on the main thread. Use `CoroutineHandler` or `LongEventHandler`.
*   **No Allocations in Updates:** Avoid `new List<>` inside the 10Hz loop. Use pooled builders or static buffers where possible.
*   **Safety:** `try/catch` blocks are mandatory in all Coroutines to prevent the loop from dying on a single error.
