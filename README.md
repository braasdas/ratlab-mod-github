# RimWorld Player Storyteller

A multiplayer storytelling mod for RimWorld that allows players to watch and interact with live RimWorld games through a web interface.

## Features

- **Live Screenshot Streaming**: View the game map in real-time (1 update per second)
- **Player Viewer Dashboard**: Select from multiple active game sessions
- **Colonist Information**: See detailed stats about colonists (health, mood, position)
- **Interactive Storytelling**: Send actions and events to the game
- **Real-time Updates**: WebSocket-based communication for instant updates

## Project Structure

```
.
├── PlayerStoryteller/          # RimWorld Mod
│   ├── About/                  # Mod metadata
│   ├── Assemblies/             # Compiled DLLs (generated)
│   ├── Defs/                   # XML definitions
│   └── Source/                 # C# source code
│       ├── PlayerStoryteller.csproj
│       ├── PlayerStorytellerMod.cs
│       ├── ScreenshotManager.cs
│       └── PlayerStorytellerMapComponent.cs
└── server/                     # Web Server
    ├── public/                 # Frontend files
    │   ├── index.html
    │   ├── styles.css
    │   └── app.js
    ├── package.json
    └── server.js
```

## Requirements

### RimWorld Mod
- RimWorld 1.4 or 1.5
- [RIMAPI](https://steamcommunity.com/sharedfiles/filedetails/?id=XXXXX) (dependency)
- .NET Framework 4.7.2

### Server
- Node.js 16+
- npm or yarn

## Installation

### 1. Install the RimWorld Mod

1. Set the `RIMWORLD_DIR` environment variable to your RimWorld installation directory
   ```bash
   # Windows (PowerShell)
   $env:RIMWORLD_DIR = "C:\Program Files (x86)\Steam\steamapps\common\RimWorld"

   # Linux/Mac
   export RIMWORLD_DIR="/path/to/rimworld"
   ```

2. Build the mod:
   ```bash
   cd PlayerStoryteller/Source
   dotnet build
   ```

3. Copy the `PlayerStoryteller` folder to your RimWorld Mods directory:
   - Windows: `C:\Program Files (x86)\Steam\steamapps\common\RimWorld\Mods\`
   - Linux: `~/.steam/steam/steamapps/common/RimWorld/Mods/`
   - Mac: `~/Library/Application Support/Steam/steamapps/common/RimWorld/Mods/`

4. Enable the mod in RimWorld's mod menu (make sure RIMAPI is loaded first)

### 2. Setup the Server

1. Install dependencies:
   ```bash
   cd server
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser to `http://localhost:3000`

## Usage

1. **Start RimWorld** with the Player Storyteller mod enabled
2. **Configure the mod** in Options → Mod Settings → Player Storyteller
   - Set the server URL (default: `http://localhost:3000`)
   - Adjust update interval if needed (default: 1 second)
3. **Load or start a game** - the mod will automatically begin sending updates
4. **Open the web interface** at `http://localhost:3000`
5. **Select your game session** from the list
6. **Watch and interact** with the live game!

## Configuration

### Mod Settings (in-game)
- **Server URL**: The address of your server (change for remote hosting)
- **Update Interval**: How often to send screenshots (in seconds)

### Server Configuration
Edit `server/server.js` to change:
- Port number (default: 3000)
- Session timeout (default: 5 minutes)
- CORS settings

## Development

### Building the Mod
```bash
cd PlayerStoryteller/Source
dotnet build
```

### Running the Server in Development Mode
```bash
cd server
npm run dev
```

## Integration with RIMAPI

This mod depends on RIMAPI for advanced game state access. See the RIMAPI documentation in this repository for available endpoints and data structures.

## Roadmap

- [ ] Implement RIMAPI integration for advanced game data
- [ ] Add more storyteller actions (raids, events, weather)
- [ ] Implement voting system for viewer actions
- [ ] Add authentication for game hosts
- [ ] Create mobile-responsive interface
- [ ] Add chat functionality
- [ ] Implement action cooldowns and limits
- [ ] Add overlay annotations on screenshots

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - See LICENSE file for details

## Acknowledgments

- Built with [RIMAPI](https://github.com/RIMAPI/RIMAPI)
- Inspired by TwitchPlays and similar interactive streaming projects
