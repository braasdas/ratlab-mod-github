# RatLab Developer Guide

## Prerequisites

*   **C# Mod:** Visual Studio 2022 or JetBrains Rider (.NET Framework 4.7.2).
*   **Sidecar:** Go 1.21+ and GCC (MinGW-w64) for FFI.
*   **Server:** Node.js 18+ and npm.
*   **RimWorld:** Installed locally (for DLL references).

## Repository Structure

```
Playerstoryteller MAIN/
├── Ratlab Mod/             # C# Source Code
│   ├── Source/             # .cs files
│   ├── About/              # Mod metadata
│   └── Assemblies/         # Compiled DLLs
├── Ratlab Server/          # Node.js Backend & Frontend
│   ├── src/                # Server logic
│   └── public/             # Web Dashboard (HTML/JS)
├── go-sidecar/             # Go Streaming Service
│   ├── main.go
│   └── encoder.go
└── build.bat               # All-in-one build script
```

## Building

### 1. The Mod
1.  Open `Ratlab Mod/Source/PlayerStoryteller.csproj` in Visual Studio.
2.  Update Reference Paths: Ensure `Assembly-CSharp.dll` and `UnityEngine.dll` point to your RimWorld installation (`RimWorld/RimWorldWin64_Data/Managed/`).
3.  Build Solution (Release mode).
4.  Output `PlayerStoryteller.dll` will be placed in `Ratlab Mod/Assemblies/`.

### 2. The Sidecar
1.  Navigate to `go-sidecar/`.
2.  Run `go build -o sidecar.exe .`
3.  **Important:** Copy `ffmpeg.exe` (available from ffmpeg.org) next to `sidecar.exe`.
4.  Copy `sidecar.exe` and `ffmpeg.exe` to `Ratlab Mod/go-sidecar/` (the mod expects them there).

### 3. The Server
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
*   **Sidecar Logs:** `Ratlab Mod/go-sidecar/sidecar.log`.
*   **Server Logs:** Console output of the Node.js process.

## Architecture Guidelines

*   **Main Thread:** All RimWorld actions (spawning items, healing) MUST be executed on the main thread. Use `CoroutineHandler` or `LongEventHandler` if coming from an async context.
*   **Bandwidth:** The Sidecar manages bandwidth automatically. Do not change encoder settings in `main.go` unless you understand FFmpeg flags.
*   **Security:** Never expose the `secretKey` in the client-side dashboard code. It is for the Mod <-> Server trust only.