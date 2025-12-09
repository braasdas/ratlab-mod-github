# RAT LAB PROJECT STRUCTURE & ARCHITECTURE

This document maps the project codebase to assist LLMs in understanding file locations, responsibilities, and data flow without needing to search the entire directory tree.

## 🏗 HIGH-LEVEL ARCHITECTURE

The system consists of three main components acting in a loop:
1.  **Ratlab Mod (C#):** Runs inside RimWorld. Gathers game data via `RimAPI` and executes commands.
2.  **Ratlab Server (Node.js):** The central hub. Receives game state from the Mod, serves the Web UI, and queues user commands.
3.  **Web Client (JS/HTML):** The user interface. Displays game state and sends commands to the Server.

---

## 📂 DIRECTORY TREE & KEY FILES

```text
Playerstoryteller MAIN/
├── Ratlab Mod/                     # [C#] RimWorld Mod Logic
│   └── Source/
│       ├── PlayerStorytellerMod.cs # Entry point. Handles initialization & settings.
│       ├── GameDataPoller.cs       # Gathers data (Colonists, Resources) from RimAPI and pushes to Server.
│       ├── GameActionExecutor.cs   # EXECUTION ENGINE. Handles "spawning", "events", and "commands" sent by viewers.
│       ├── RimApiClient.cs         # Wrapper for local RimAPI (localhost:8765). Used by Poller & Executor.
│       ├── WebSocketClient.cs      # Polls the Server for pending Actions/Commands to execute.
│       ├── ViewerManager.cs        # Manages the "bought" pawns and viewer identities in-game.
│       ├── DLCHelper.cs            # Handlers for specific DLC events (Biotech, Anomaly, etc.).
│       └── ColonistDataPoller.cs   # Specific polling logic for colonist details.
│
├── Ratlab Server/                  # [Node.js] Backend & Frontend Host
│   ├── server.js                   # Entry point. Sets up Express and Socket.IO.
│   ├── src/
│   │   ├── app.js                  # Express app setup & middleware configuration.
│   │   ├── routes/
│   │   │   └── api.js              # MAIN API. Handles /gamestate, /action, /adoptions, /definitions.
│   │   ├── services/
│   │   │   ├── store/              # In-memory state storage.
│   │   │   ├── DefinitionManager.js# Caches huge game Defs (weather, items) pushed by Mod.
│   │   │   └── economyManager.js   # Manages user credits/coins.
│   │   └── middleware/             # Compression & Security logic.
│   │
│   └── public/                     # [Frontend] The Web Interface
│       ├── index.html              # Main DOM structure, Modals, Sidebar.
│       ├── app.js                  # FRONTEND BRAIN. Websockets, UI updates, event listeners, API calls.
│       ├── styles.css              # Tailwind directives & custom CSS.
│       └── components/
│           └── my-pawn.html        # The "My Pawn" / Adoption specific UI template.
│
└── go-sidecar/                     # [Go] High-Performance Utility (WIP)
    ├── main.go                     # Entry point.
    ├── capture.go                  # Logic for screen capture (streaming).
    └── webrtc.go                   # WebRTC signaling and transmission.
```

---

## 🔄 CORRELATION & DATA FLOW

### 1. Game State Loop (Getting data to the web)
*   **Source:** `Ratlab Mod/Source/GameDataPoller.cs` calls local RimAPI.
*   **Transmission:** Mod POSTs JSON data to Server endpoint `/api/gamestate/:sessionId`.
*   **Broadcast:** Server (`api.js`) validates data and emits `gamestate-update` via Socket.IO.
*   **Display:** Frontend (`public/app.js`) listens for socket event and updates DOM (`updateGameState`).

### 2. Command Execution Loop (Viewer interacting with Game)
*   **Input:** User clicks button in Web UI (e.g., "Spawn Raid" or "Draft Pawn").
*   **Request:** `public/app.js` calls `sendAction()` -> POST to Server `/api/action`.
*   **Queueing:** Server (`api.js`) validates cost/auth and pushes action to `session.actions` queue.
*   **Polling:** Mod (`WebSocketClient.cs` / `RimApiClient.cs`) polls Server `/api/actions/:sessionId`.
*   **Execution:** Mod receives action. `GameActionExecutor.cs` switches based on `action` string:
    *   *Events:* Calls `TriggerIncident` or `DLCHelper`.
    *   *Pawn Control:* Calls `ExecuteColonistCommand` -> `RimApiClient.SelectColonist`.

### 3. "Adopt a Colonist" Flow
1.  **Request:** Frontend (`app.js`) -> POST `/api/adoptions/.../request`.
2.  **Logic:** Server checks availability -> Assigns Pawn ID -> Stores in Session.
3.  **UI Update:** Frontend polls `/api/adoptions/.../status`. If active:
    *   Loads `components/my-pawn.html`.
    *   Reveals "MY PAWN" tab (controlled by `checkAdoptionStatus` in `app.js`).
4.  **Control:** Buttons in "My Pawn" send specific `colonist_command` actions to the queue.

---

## 🛠 COMMON GOTCHAS & DEPENDENCIES

*   **RimAPI:** The Mod *requires* RimAPI running locally on port `8765` to function. The Mod talks to RimAPI; the Server does **not**.
*   **Payload Limits:** The definition sync (Mod -> Server) is massive. `Ratlab Server/src/app.js` has a custom `50mb` body limit to handle this.
*   **Direct Access:** The Frontend (`app.js`) should **NEVER** call `localhost:8765` directly. It must always proxy commands through the Server's `/api/action` queue to work for remote users.
