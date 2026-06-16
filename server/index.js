const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'sekai-snake-secret-key';
const db = new Database(path.join(__dirname, '../database/sekai-snake.db'));

// Configure multer for file uploads
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

// Serve main pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/game.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin-panel/index.html'));
});

// Auth endpoints
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || username.length > 12 || password.length < 6 || password.length > 24) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const result = stmt.run(username, hashedPassword);
    const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET);
    res.json({ token, user: { id: result.lastInsertRowid, username, isAdmin: false } });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      res.status(400).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
});

// File upload endpoint
app.post('/api/upload-head', upload.single('headSubmission'), (req, res) => {
  // TODO: Add auth check
  res.json({ success: true, filename: req.file.filename });
});

// Game state
const activeGames = new Map();
const players = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-server', (data) => {
    socket.join(data.serverId);
    players.set(socket.id, {
      id: socket.id,
      username: data.username,
      score: 50,
      position: { x: 0, y: 0, z: 0 },
      color: data.color
    });
    io.to(data.serverId).emit('player-joined', players.get(socket.id));
    io.to(data.serverId).emit('update-leaderboard', Array.from(players.values()).sort((a, b) => b.score - a.score));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const player = players.get(socket.id);
    if (player) {
      io.emit('player-left', socket.id);
      players.delete(socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Assets paths:`);
  console.log(`  Snake heads: ${path.join(__dirname, '../public/assets/snake-heads')}`);
  console.log(`  Notes: ${path.join(__dirname, '../public/assets/notes')}`);
  console.log(`  User submissions: ${path.join(__dirname, '../public/assets/user-submissions')}`);
});
