const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  let foundIPs = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        foundIPs.push(iface.address);
      }
    }
  }
  const homeIP = foundIPs.find(ip => ip.startsWith('192.168.'));
  if (homeIP) return homeIP;
  return foundIPs[0] || 'localhost';
};

const localIP = getLocalIP();

const users = new Map();
const sessions = new Map();
const servers = new Map();
const playerServerMap = new Map();
let nextUserId = 1;
let nextServerId = 1;
const stateFile = path.join(__dirname, '../database/runtime-state.json');

const createToken = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const normalizeUsername = (username) => String(username || '').trim();
const normalizePassword = (password) => String(password || '');
const publicServerData = (server) => ({
  id: server.id,
  name: server.name,
  type: server.type,
  players: server.playerList.length
});
const getServersList = () => Array.from(servers.values()).map(publicServerData);
const emitServersUpdate = () => io.emit('servers-update', getServersList());
const getUserByToken = (token) => {
  const username = sessions.get(String(token || ''));
  return username ? users.get(username.toLowerCase()) : null;
};
const getRequestUser = (req) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return getUserByToken(token);
};
const getLeaderboard = (server) => [...server.playerList]
  .map(player => ({ id: player.id, username: player.username, score: player.score }))
  .sort((a, b) => b.score - a.score);

const loadState = () => {
  if (!fs.existsSync(stateFile)) return;

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    nextUserId = state.nextUserId || nextUserId;
    nextServerId = state.nextServerId || nextServerId;

    (state.users || []).forEach(user => {
      users.set(user.username.toLowerCase(), user);
    });

    (state.servers || []).forEach(server => {
      servers.set(server.id, {
        ...server,
        playerList: []
      });
    });
  } catch (err) {
    console.warn('Could not load runtime state:', err.message);
  }
};

const saveState = () => {
  try {
    const state = {
      nextUserId,
      nextServerId,
      users: Array.from(users.values()),
      servers: Array.from(servers.values()).map(server => ({
        id: server.id,
        name: server.name,
        type: server.type,
        password: server.password,
        creator: server.creator
      }))
    };

    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not save runtime state:', err.message);
  }
};

loadState();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'headSubmission') {
      cb(null, path.join(__dirname, '../public/assets/user-submissions'));
    } else if (file.fieldname === 'adminHead') {
      cb(null, path.join(__dirname, '../public/assets/snake-heads'));
    } else if (file.fieldname === 'noteIcon') {
      cb(null, path.join(__dirname, '../public/assets/notes'));
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, '../client/game.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../admin-panel/index.html')));

app.post('/api/register', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  if (!username || !password || username.length < 3 || username.length > 12 || password.length < 6 || password.length > 24) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const usernameKey = username.toLowerCase();
  if (users.has(usernameKey)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const user = { id: nextUserId++, username, password, isAdmin: usernameKey === 'admin' };
  users.set(usernameKey, user);
  const token = createToken();
  sessions.set(token, usernameKey);
  saveState();
  res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
});

app.post('/api/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  const user = users.get(username.toLowerCase());
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = createToken();
  sessions.set(token, user.username.toLowerCase());
  res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
});

app.get('/api/servers', (req, res) => {
  res.json(getServersList());
});

app.post('/api/servers', (req, res) => {
  const user = getRequestUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const name = String(req.body.name || '').trim();
  const type = req.body.type === 'private' ? 'private' : 'public';
  const password = normalizePassword(req.body.password);
  if (!name || name.length < 2) return res.status(400).json({ error: 'Invalid server name' });
  if (type === 'private' && (!password || password.length !== 4 || !/^\d+$/.test(password))) {
    return res.status(400).json({ error: 'Password must be 4 digits' });
  }
  const newId = nextServerId++;
  const newServer = {
    id: newId,
    name,
    type,
    password: type === 'private' ? password : null,
    creator: user.username,
    playerList: []
  };
  servers.set(newId, newServer);
  saveState();
  emitServersUpdate();
  res.json(publicServerData(newServer));
});

app.post('/api/upload-head', upload.single('headSubmission'), (req, res) => res.json({ success: true, filename: req.file.filename }));

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.emit('servers-update', getServersList());

  const leaveCurrentServer = () => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const server = servers.get(state.serverId);
    if (server) {
      server.playerList = server.playerList.filter(player => player.id !== socket.id);
      const room = String(state.serverId);
      socket.to(room).emit('player-left', socket.id);
      io.to(room).emit('update-leaderboard', getLeaderboard(server));
      emitServersUpdate();
      socket.leave(room);
    }

    playerServerMap.delete(socket.id);
  };

  socket.on('join-server', (data) => {
    const serverId = Number(data && data.serverId);
    const server = servers.get(serverId);
    if (!server) { socket.emit('join-error', 'Server not found'); return; }

    const user = getUserByToken(data && data.token);
    if (!user) { socket.emit('join-error', 'Login required'); return; }

    const requestedUsername = normalizeUsername(data.username);
    if (requestedUsername && requestedUsername.toLowerCase() !== user.username.toLowerCase()) {
      socket.emit('join-error', 'Invalid player session');
      return;
    }

    if (server.type === 'private' && server.password !== normalizePassword(data.password)) {
      socket.emit('join-error', 'Invalid password');
      return;
    }

    leaveCurrentServer();

    const room = String(serverId);
    socket.join(room);

    const playerData = {
      id: socket.id,
      userId: user.id,
      username: user.username,
      color: data.color || '#00ff00',
      score: 50,
      x: (Math.random() - 0.5) * 20,
      z: (Math.random() - 0.5) * 20
    };
    playerServerMap.set(socket.id, { serverId, playerData });
    server.playerList.push(playerData);

    socket.emit('join-success', { server: publicServerData(server), player: playerData });
    socket.emit('initial-players', server.playerList);
    socket.to(room).emit('player-joined', playerData);
    io.to(room).emit('update-leaderboard', getLeaderboard(server));
    emitServersUpdate();
  });

  socket.on('update-position', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const x = Number(data && data.x);
    const z = Number(data && data.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    state.playerData.x = x;
    state.playerData.z = z;

    const score = Number(data && data.score);
    if (Number.isFinite(score)) {
      state.playerData.score = Math.max(0, Math.floor(score));
    }

    socket.to(String(state.serverId)).emit('player-moved', {
      id: socket.id,
      x: state.playerData.x,
      z: state.playerData.z,
      score: state.playerData.score
    });
  });

  socket.on('chat-message', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const message = String(data && data.message || '').trim().slice(0, 200);
    if (!message) return;

    io.to(String(state.serverId)).emit('chat-message', {
      username: state.playerData.username,
      message
    });
  });

  socket.on('update-score', (score) => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const nextScore = Math.max(0, Math.floor(Number(score)));
    if (!Number.isFinite(nextScore)) return;

    state.playerData.score = nextScore;
    const server = servers.get(state.serverId);
    if (server) {
      io.to(String(state.serverId)).emit('update-leaderboard', getLeaderboard(server));
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    leaveCurrentServer();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\x1b[32m%s\x1b[0m', '=========================================');
  console.log('\x1b[32m%s\x1b[0m', '   SEKAI-SNAKE GAME SERVER');
  console.log('\x1b[32m%s\x1b[0m', '=========================================');
  console.log(`✅ Running locally:  http://localhost:${PORT}`);
  console.log(`✅ On your network:  http://${localIP}:${PORT}`);
  console.log('\x1b[32m%s\x1b[0m', '=========================================');
  console.log('📁 Assets:');
  console.log(`   Snake heads: ${path.join(__dirname, '../public/assets/snake-heads')}`);
  console.log(`   Notes:       ${path.join(__dirname, '../public/assets/notes')}`);
  console.log(`   Submissions: ${path.join(__dirname, '../public/assets/user-submissions')}`);
  console.log('\x1b[32m%s\x1b[0m', '=========================================');
  console.log('🎮 How to play:');
  console.log('   1. Open the URL in your browser');
  console.log('   2. Register or login');
  console.log('   3. Choose a color and server');
  console.log('   4. Have fun!');
  console.log('\x1b[32m%s\x1b[0m', '=========================================\n');
});
