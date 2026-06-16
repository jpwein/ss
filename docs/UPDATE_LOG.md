# sekai-snake - Update Log

## v1.1.0 - Full Game Implementation (2026-06-11)

### Server Enhancements
- Added complete authentication system:
  - `/api/register` - User registration with validation (3-12 username, 6-24 password)
  - `/api/login` - User login with bcrypt password hashing
  - JWT token-based authentication
- Added file upload system via Multer:
  - `/api/upload-head` - User head submission endpoint
- Socket.io game state management:
  - Player join/leave events
  - Leaderboard updates
  - Server room system

### Client Lobby Features
- Complete login/registration UI
- User panel after authentication
- Server list with public/private indicators
- Color picker (24 colors)
- Head submission upload button
- Language switcher available on all lobby screens
- Admin button visible only to admin users

### Gameplay Mechanics
- **3D Snake**:
  - Multi-segment snake that grows when eating notes
  - WASD/Arrow keys controls
  - Camera follows the snake head
  - World boundary wrapping
- **Notes System**:
  - Spawn every 5-14 seconds randomly on the map
  - Collecting notes gives +10 score and adds a snake segment
- **Leaderboard**:
  - Real-time score display
  - Shows top players
  - Default start score: 50 points
- **Game Scene**:
  - Green 100x100 grid
  - Ambient + directional lighting
  - Smooth 60 FPS gameplay

### Project Structure Verified
```
SS/
├── public/
│   └── assets/
│       ├── snake-heads/          # Admin uploads here
│       ├── notes/                # Note icons here
│       └── user-submissions/     # User ideas here
├── server/
│   └── index.js                  # Express + Socket.io server
├── client/
│   ├── index.html                # Lobby
│   ├── game.html                 # Game
│   ├── app.js                    # Lobby logic
│   ├── game.js                   # Game logic
│   ├── styles.css                # Styles
│   └── locales/
│       ├── ru.js                 # Russian
│       └── en.js                 # English
├── database/
│   └── init.js                   # DB init
├── admin-panel/
│   └── index.html                # Admin UI
├── docs/
│   └── UPDATE_LOG.md             # This file
├── package.json
└── .gitignore
```

### How to Run
1. Install dependencies: `npm install`
2. Initialize DB: `node database/init.js`
3. Start server: `npm start`
4. Open browser: `http://localhost:3000`

### Demo Features
- Register/login with any username/password
- Use "admin" as username to see admin button
- Select color, choose server and play!
- Use WASD or Arrow keys to control snake

## v1.0.0 - Initial Project Foundation (2026-06-11)

### Created Project Structure
- `/public/assets/snake-heads` - Directory for admin-uploaded snake head images
- `/public/assets/notes` - Directory for note icons
- `/public/assets/user-submissions` - Directory for user-submitted head ideas
- `/server` - Server-side logic
- `/client` - Frontend application
- `/database` - Database structure
- `/admin-panel` - Admin panel interface
- `/docs` - Documentation

### Server Setup
- Created `package.json` with dependencies: Express, Socket.io, CORS, Multer, bcryptjs, jsonwebtoken, better-sqlite3
- Implemented basic server in `server/index.js` with Express and Socket.io
- Created database initialization script `database/init.js` with tables:
  - `users` - User accounts with admin flag, selected head/color
  - `servers` - Game servers (public/private)
  - `head_submissions` - User-submitted head ideas
  - `chat_messages` - All chat messages across servers

### Client Frontend
- **UI Framework**:
  - Green geometric background as specified
  - Central "sekai-snake" logo
  - Two-panel lobby layout
  - Language switcher (RU/EN)
  
- **Localization System**:
  - `client/locales/ru.js` - Russian translations
  - `client/locales/en.js` - English translations
  
- **Game Scene**:
  - `client/game.html` - Game page with leaderboard
  - `client/game.js` - Three.js scene setup:
    - Green background matching lobby
    - Grid helper (100x100 units)
    - Note spawning system (every 5-14 seconds)
    - Basic lighting (ambient + directional)

- **Customization**:
  - 24 predefined colors for snake body
  - Color picker grid interface

### Admin Panel
- Basic structure created in `admin-panel/index.html`
- Sections for:
  - Head submissions review
  - All chat messages monitoring
  - Server management
  - User management

### Important Paths
- **Snake heads (admin)**: `/public/assets/snake-heads`
- **Note icons**: `/public/assets/notes`
- **User submissions**: `/public/assets/user-submissions`
