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
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sekai-admin-041111';

// ============================================
// ЧИТ-КОД НА ОЧКИ ДЛЯ СЕБЯ НАХОДИТСЯ ЗДЕСЬ:
// Добавь сюда имена игроков и их бонусы:
const ADMIN_BONUSES = {
  // Пример:
  // 'admin': {
  //   startScore: 500,      // Начальные очки при респавне
  //   speedMultiplier: 1.5, // Множитель скорости
  //   invincible: false     // Неуязвимость (если true)
  // }
};
// ============================================

// ============================================
// НАСТРОЙКИ НОРОК ДЛЯ СЕРВЕРА:
const BURROW_SERVER_CONFIG = {
  count: 60,                    // Удваиваем количество норок
  radius: 5,                    // Уменьшаем размер
  innerRadius: 3,               // Внутренний радиус
  fieldSize: 1600,              // Размер поля
  lifetime: 85000,              // 85 секунд (1 мин 25 сек)
  minDistance: 30               // Минимальное расстояние между норками
};
let serverBurrows = []; // Массив с норками для всего сервера
let burrowTimers = [];  // Таймеры для перепозиционирования норок
// ============================================

const projectRoot = path.join(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const clientRoot = path.join(projectRoot, 'client');
const configuredDataRoot = process.env.DATA_DIR
  || process.env.RENDER_DISK_PATH
  || (process.env.RENDER && fs.existsSync('/var/data') ? '/var/data' : '');
const hasExternalDataRoot = Boolean(configuredDataRoot);
const dataRoot = hasExternalDataRoot ? configuredDataRoot : projectRoot;
const databaseRoot = hasExternalDataRoot ? path.join(dataRoot, 'database') : path.join(projectRoot, 'database');
const runtimeAssetRoot = hasExternalDataRoot ? path.join(dataRoot, 'assets') : path.join(publicRoot, 'assets');
const stateFile = path.join(databaseRoot, 'runtime-state.json');

const assetDirs = {
  adminHeads: path.join(runtimeAssetRoot, 'admin-heads'),
  userSubmissions: path.join(runtimeAssetRoot, 'user-submissions'),
  notes: path.join(publicRoot, 'assets', 'notes')
};

const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
[databaseRoot, assetDirs.adminHeads, assetDirs.userSubmissions, assetDirs.notes].forEach(ensureDir);

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  const foundIPs = [];
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

const createToken = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const createClanId = () => `clan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normalizeUsername = (username) => String(username || '').trim();
const normalizePassword = (password) => String(password || '');
const normalizeClanName = (name) => String(name || '').trim().slice(0, 18);
const distance2d = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));

const publicServerData = (server) => ({
  id: server.id,
  name: server.name,
  type: server.type,
  players: server.playerList.length,
  createdAt: server.createdAt
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

const requireUser = (req, res, next) => {
  const user = getRequestUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  const user = getRequestUser(req);
  if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  req.user = user;
  next();
};

const serializeUser = (user) => ({
  id: user.id,
  username: user.username,
  isAdmin: Boolean(user.isAdmin)
});

const serializePlayer = (player) => ({
  id: player.id,
  userId: player.userId,
  username: player.username,
  color: player.color,
  score: player.score,
  x: player.x,
  z: player.z,
  headUrl: player.headUrl || '',
  clanId: player.clanId || null,
  alive: player.alive !== false
});

const getLeaderboard = (server) => [...server.playerList]
  .filter(player => player.alive !== false)
  .map(player => ({
    id: player.id,
    username: player.username,
    score: player.score,
    clanId: player.clanId || null
  }))
  .sort((a, b) => b.score - a.score);

const serializeClans = (server) => (server.clans || []).map(clan => ({
  id: clan.id,
  name: clan.name,
  owner: clan.owner,
  members: server.playerList.filter(player => player.clanId === clan.id && player.alive !== false).length,
  memberList: server.playerList.filter(player => player.clanId === clan.id && player.alive !== false).map(p => ({
    id: p.id,
    username: p.username
  })),
  pendingRequests: clan.pendingRequests || []
}));

const emitClanState = (server) => {
  io.to(String(server.id)).emit('clans-update', serializeClans(server));
};

const isImageFile = (filename) => allowedImageExtensions.has(path.extname(filename || '').toLowerCase());

const toAssetUrl = (baseUrl, filename) => `${baseUrl}/${encodeURIComponent(filename)}`;

const listAssetFiles = (dir, baseUrl) => {
  ensureDir(dir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isImageFile(entry.name))
    .map(entry => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        filename: entry.name,
        url: toAssetUrl(baseUrl, entry.name),
        size: stat.size,
        createdAt: stat.birthtimeMs || stat.mtimeMs
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};

const safeFilePath = (dir, filename) => {
  const base = path.basename(String(filename || ''));
  if (!base || !isImageFile(base)) return null;
  const resolvedDir = path.resolve(dir);
  const resolvedPath = path.resolve(dir, base);
  if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) return null;
  return resolvedPath;
};

const makeUniqueFilename = (prefix, originalName) => {
  const ext = path.extname(originalName || '').toLowerCase();
  const safeExt = allowedImageExtensions.has(ext) ? ext : '.png';
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
};

const normalizeHeadUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/assets/admin-heads/')) return '';
  const encodedName = raw.split('/').pop();
  let filename = '';
  try {
    filename = decodeURIComponent(encodedName);
  } catch (err) {
    filename = encodedName;
  }
  const filePath = safeFilePath(assetDirs.adminHeads, filename);
  if (!filePath || !fs.existsSync(filePath)) return '';
  return toAssetUrl('/assets/admin-heads', path.basename(filePath));
};

const normalizeSegments = (segments, fallback) => {
  if (!Array.isArray(segments)) return [fallback];
  const clean = segments
    .slice(0, 140)
    .map(segment => ({
      x: Number(segment && segment.x),
      z: Number(segment && segment.z)
    }))
    .filter(segment => Number.isFinite(segment.x) && Number.isFinite(segment.z));
  return clean.length ? clean : [fallback];
};

const loadState = () => {
  if (!fs.existsSync(stateFile)) return;

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    nextUserId = state.nextUserId || nextUserId;
    nextServerId = state.nextServerId || nextServerId;

    (state.users || []).forEach(user => {
      users.set(user.username.toLowerCase(), {
        ...user,
        isAdmin: Boolean(user.isAdmin)
      });
    });

    (state.servers || []).forEach(savedServer => {
      servers.set(savedServer.id, {
        ...savedServer,
        createdAt: savedServer.createdAt || Date.now(),
        playerList: [],
        clans: []
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
        creator: server.creator,
        createdAt: server.createdAt
      }))
    };

    ensureDir(path.dirname(stateFile));
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not save runtime state:', err.message);
  }
};

const ensureAdminUser = () => {
  const adminKey = ADMIN_USERNAME.toLowerCase();
  const existing = users.get(adminKey);
  if (existing) {
    existing.isAdmin = true;
    existing.password = ADMIN_PASSWORD;
    return;
  }

  users.set(adminKey, {
    id: nextUserId++,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    isAdmin: true
  });
};

loadState();
ensureAdminUser();
saveState();

// ============================================
// Генерация норок при старте сервера:
const generateServerBurrows = () => {
  // Очищаем старые таймеры
  burrowTimers.forEach(t => clearTimeout(t));
  burrowTimers = [];
  
  serverBurrows = [];
  for (let i = 0; i < BURROW_SERVER_CONFIG.count; i++) {
    const burrow = createNewBurrow(i);
    serverBurrows.push(burrow);
    startBurrowTimer(i);
  }
  console.log(`Generated ${serverBurrows.length} burrows on server.`);
};

// Создаем новую норку с проверкой расстояния
const createNewBurrow = (index) => {
  let x, z;
  let attempts = 0;
  const maxAttempts = 100;
  
  // Ищем свободное место
  do {
    x = (Math.random() - 0.5) * (BURROW_SERVER_CONFIG.fieldSize - 200);
    z = (Math.random() - 0.5) * (BURROW_SERVER_CONFIG.fieldSize - 200);
    attempts++;
  } while (isPositionOccupied(x, z, index) && attempts < maxAttempts);
  
  return {
    id: index,
    x,
    z,
    radius: BURROW_SERVER_CONFIG.radius,
    innerRadius: BURROW_SERVER_CONFIG.innerRadius,
    createdAt: Date.now()
  };
};

// Проверка - не занята ли позиция другой норкой
const isPositionOccupied = (x, z, excludeIndex = -1) => {
  for (let i = 0; i < serverBurrows.length; i++) {
    if (i === excludeIndex) continue;
    const b = serverBurrows[i];
    const dist = Math.hypot(x - b.x, z - b.z);
    if (dist < BURROW_SERVER_CONFIG.minDistance) {
      return true;
    }
  }
  return false;
};

// Запускаем таймер для перепозиционирования норки
const startBurrowTimer = (index) => {
  const timer = setTimeout(() => {
    // Перемещаем норку
    const newBurrow = createNewBurrow(index);
    serverBurrows[index] = newBurrow;
    
    // Отправляем обновление всем игрокам
    broadcastBurrowUpdate(index, newBurrow);
    
    // Запускаем новый таймер
    startBurrowTimer(index);
  }, BURROW_SERVER_CONFIG.lifetime);
  
  burrowTimers.push(timer);
};

// Рассылаем обновление норки всем игрокам
const broadcastBurrowUpdate = (index, newBurrow) => {
  io.emit('burrow-update', {
    index,
    burrow: newBurrow
  });
};
// ============================================

generateServerBurrows();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'headSubmission') {
      cb(null, assetDirs.userSubmissions);
      return;
    }
    if (file.fieldname === 'adminHead') {
      cb(null, assetDirs.adminHeads);
      return;
    }
    if (file.fieldname === 'noteIcon') {
      cb(null, assetDirs.notes);
      return;
    }
    cb(null, assetDirs.userSubmissions);
  },
  filename: (req, file, cb) => {
    cb(null, makeUniqueFilename(file.fieldname || 'image', file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  }
});

const closeServer = (serverId, reason = 'Server was closed by admin') => {
  const serverToClose = servers.get(Number(serverId));
  if (!serverToClose) return false;

  const room = String(serverToClose.id);
  serverToClose.playerList.forEach(player => playerServerMap.delete(player.id));
  io.to(room).emit('server-closed', reason);
  io.in(room).socketsLeave(room);
  servers.delete(serverToClose.id);
  saveState();
  emitServersUpdate();
  return true;
};

const createDeathDrops = (player) => {
  const body = Array.isArray(player.segments) && player.segments.length
    ? player.segments
    : [{ x: player.x, z: player.z }];
  const score = Math.max(10, Math.floor(Number(player.score) || 0));
  const dropCount = Math.min(28, Math.max(4, Math.ceil(score / 30)));
  const pointsPerDrop = Math.max(10, Math.floor(score / dropCount));
  const step = Math.max(1, Math.floor(body.length / dropCount));
  const drops = [];

  for (let i = 0; i < body.length && drops.length < dropCount; i += step) {
    drops.push({
      x: body[i].x + (Math.random() - 0.5) * 3,
      z: body[i].z + (Math.random() - 0.5) * 3,
      points: pointsPerDrop
    });
  }

  while (drops.length < dropCount) {
    drops.push({
      x: player.x + (Math.random() - 0.5) * 8,
      z: player.z + (Math.random() - 0.5) * 8,
      points: pointsPerDrop
    });
  }

  return drops;
};

const findBodyCollision = (serverState, player) => {
  // ============================================
  // Если игрок неуязвим (invincible), не проверяем столкновения
  if (player.invincible) return null;
  // ============================================
  
  // Проверка, находится ли игрок в норке
  const isPlayerInBurrow = checkIfPlayerInBurrow(player.x, player.z);
  
  const head = { x: player.x, z: player.z };
  const hitRadius = 2.15;
  for (const other of serverState.playerList) {
    if (other.id === player.id || other.alive === false) continue;
    if (player.clanId && other.clanId && player.clanId === other.clanId) continue;
    
    // ============================================
    // Если оба игрока в норке - не проверяем столкновения
    const isOtherInBurrow = checkIfPlayerInBurrow(other.x, other.z);
    if (isPlayerInBurrow && isOtherInBurrow) continue;
    // Если игрок в норке, а другой нет - тоже не проверяем
    if (isPlayerInBurrow || isOtherInBurrow) continue;
    // ============================================

    const body = Array.isArray(other.segments) && other.segments.length
      ? other.segments
      : [{ x: other.x, z: other.z }];

    for (let i = 1; i < body.length; i += 1) {
      if (distance2d(head, body[i]) < hitRadius) {
        return other;
      }
    }
  }
  return null;
};

// ============================================
// Проверка, находится ли игрок в норке (серверная функция)
const checkIfPlayerInBurrow = (x, z) => {
  for (const burrow of serverBurrows) {
    const dist = Math.hypot(x - burrow.x, z - burrow.z);
    if (dist < burrow.radius) {
      return true;
    }
  }
  return false;
};
// ============================================

const killPlayer = (serverState, victim, killer) => {
  if (!victim || victim.alive === false) return;
  victim.alive = false;
  const drops = createDeathDrops(victim);
  const victimSocket = io.sockets.sockets.get(victim.id);
  const room = String(serverState.id);

  if (victimSocket) {
    victimSocket.emit('player-died', {
      killer: killer ? killer.username : '',
      drops
    });
  }

  victim.score = 0;
  io.to(room).emit('death-drops', { drops });
  io.to(room).emit('player-left', victim.id);
  io.to(room).emit('update-leaderboard', getLeaderboard(serverState));
  emitServersUpdate();
};

app.use(cors());
app.use(express.json());
app.use('/assets/admin-heads', express.static(assetDirs.adminHeads));
app.use('/assets/user-submissions', express.static(assetDirs.userSubmissions));
app.use(express.static(publicRoot));
app.use(express.static(clientRoot));

app.get('/', (req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
app.get('/game', (req, res) => res.sendFile(path.join(clientRoot, 'game.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(projectRoot, 'admin-panel', 'index.html')));

app.post('/api/register', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  if (!username || !password || username.length < 3 || username.length > 12 || password.length < 6 || password.length > 24) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const usernameKey = username.toLowerCase();
  if (usernameKey === ADMIN_USERNAME.toLowerCase()) {
    return res.status(400).json({ error: 'This username is reserved' });
  }
  if (users.has(usernameKey)) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  const user = { id: nextUserId++, username, password, isAdmin: false };
  users.set(usernameKey, user);
  const token = createToken();
  sessions.set(token, usernameKey);
  saveState();
  res.json({ token, user: serializeUser(user) });
});

app.post('/api/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  const user = users.get(username.toLowerCase());
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = createToken();
  sessions.set(token, user.username.toLowerCase());
  res.json({ token, user: serializeUser(user) });
});

app.get('/api/servers', (req, res) => {
  res.json(getServersList());
});

app.post('/api/servers', requireUser, (req, res) => {
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
    creator: req.user.username,
    createdAt: Date.now(),
    playerList: [],
    clans: []
  };
  servers.set(newId, newServer);
  saveState();
  emitServersUpdate();
  res.json(publicServerData(newServer));
});

app.get('/api/heads', (req, res) => {
  res.json(listAssetFiles(assetDirs.adminHeads, '/assets/admin-heads'));
});

app.post('/api/upload-head', requireUser, upload.single('headSubmission'), (req, res) => {
  res.json({
    success: true,
    filename: req.file.filename,
    url: toAssetUrl('/assets/user-submissions', req.file.filename)
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ user: serializeUser(req.user), dataRoot, assetRoot: runtimeAssetRoot });
});

app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  res.json(listAssetFiles(assetDirs.userSubmissions, '/assets/user-submissions'));
});

app.post('/api/admin/submissions/:filename/approve', requireAdmin, (req, res) => {
  const source = safeFilePath(assetDirs.userSubmissions, req.params.filename);
  if (!source || !fs.existsSync(source)) return res.status(404).json({ error: 'Submission not found' });

  const approvedName = makeUniqueFilename('approved-head', source);
  const target = path.join(assetDirs.adminHeads, approvedName);
  fs.copyFileSync(source, target);
  fs.unlinkSync(source);
  res.json({
    success: true,
    head: {
      filename: approvedName,
      url: toAssetUrl('/assets/admin-heads', approvedName)
    }
  });
});

app.delete('/api/admin/submissions/:filename', requireAdmin, (req, res) => {
  const target = safeFilePath(assetDirs.userSubmissions, req.params.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'Submission not found' });
  fs.unlinkSync(target);
  res.json({ success: true });
});

app.get('/api/admin/heads', requireAdmin, (req, res) => {
  res.json(listAssetFiles(assetDirs.adminHeads, '/assets/admin-heads'));
});

app.post('/api/admin/heads', requireAdmin, upload.single('adminHead'), (req, res) => {
  res.json({
    success: true,
    head: {
      filename: req.file.filename,
      url: toAssetUrl('/assets/admin-heads', req.file.filename)
    }
  });
});

app.delete('/api/admin/heads/:filename', requireAdmin, (req, res) => {
  const target = safeFilePath(assetDirs.adminHeads, req.params.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'Head not found' });
  fs.unlinkSync(target);
  res.json({ success: true });
});

app.get('/api/admin/servers', requireAdmin, (req, res) => {
  res.json(Array.from(servers.values()).map(serverState => ({
    ...publicServerData(serverState),
    creator: serverState.creator
  })));
});

app.delete('/api/admin/servers', requireAdmin, (req, res) => {
  const ids = Array.from(servers.keys());
  ids.forEach(id => closeServer(id));
  res.json({ success: true, removed: ids.length });
});

app.delete('/api/admin/servers/:id', requireAdmin, (req, res) => {
  const removed = closeServer(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'Server not found' });
  res.json({ success: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(Array.from(users.values()).map(serializeUser));
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  
  // Find user by ID
  let userToDelete = null;
  for (const user of users.values()) {
    if (user.id === userId) {
      userToDelete = user;
      break;
    }
  }
  
  if (!userToDelete) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Don't delete the admin user
  if (userToDelete.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot delete admin user' });
  }
  
  // Remove user
  users.delete(userToDelete.username.toLowerCase());
  
  // Remove all sessions for this user
  for (const [token, username] of sessions.entries()) {
    if (username.toLowerCase() === userToDelete.username.toLowerCase()) {
      sessions.delete(token);
    }
  }
  
  saveState();
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.emit('servers-update', getServersList());

  const leaveCurrentServer = () => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const serverState = servers.get(state.serverId);
    if (serverState) {
      serverState.playerList = serverState.playerList.filter(player => player.id !== socket.id);
      const room = String(state.serverId);
      socket.to(room).emit('player-left', socket.id);
      io.to(room).emit('update-leaderboard', getLeaderboard(serverState));
      emitClanState(serverState);
      emitServersUpdate();
      socket.leave(room);
    }

    playerServerMap.delete(socket.id);
  };

  const sendRoomState = (serverState) => {
    socket.emit('initial-players', serverState.playerList
      .filter(player => player.id !== socket.id && player.alive !== false)
      .map(serializePlayer));
    socket.emit('clans-update', serializeClans(serverState));
    socket.emit('my-clan-update', {
      clanId: playerServerMap.get(socket.id)?.playerData.clanId || null
    });
  };

  socket.on('join-server', (data) => {
    const serverId = Number(data && data.serverId);
    const serverState = servers.get(serverId);
    if (!serverState) { socket.emit('join-error', 'Server not found'); return; }

    const user = getUserByToken(data && data.token);
    if (!user) { socket.emit('join-error', 'Login required'); return; }

    const requestedUsername = normalizeUsername(data.username);
    if (requestedUsername && requestedUsername.toLowerCase() !== user.username.toLowerCase()) {
      socket.emit('join-error', 'Invalid player session');
      return;
    }

    if (serverState.type === 'private' && serverState.password !== normalizePassword(data.password)) {
      socket.emit('join-error', 'Invalid password');
      return;
    }

    leaveCurrentServer();

    const room = String(serverId);
    socket.join(room);

    // ============================================
    // Применяем админ-бонусы, если они есть для игрока
    const usernameLower = user.username.toLowerCase();
    const adminBonus = ADMIN_BONUSES[usernameLower] || {};
    // ============================================

    const playerData = {
      id: socket.id,
      userId: user.id,
      username: user.username,
      color: data.color || '#00ff00',
      headUrl: normalizeHeadUrl(data.headUrl),
      score: adminBonus.startScore || 50,
      x: (Math.random() - 0.5) * 80,
      z: (Math.random() - 0.5) * 80,
      segments: [],
      clanId: null,
      alive: true,
      speedMultiplier: adminBonus.speedMultiplier || 1,
      invincible: adminBonus.invincible || false
    };
    playerServerMap.set(socket.id, { serverId, playerData });
    serverState.playerList.push(playerData);

    socket.emit('join-success', { server: publicServerData(serverState), player: serializePlayer(playerData), burrows: serverBurrows });
  sendRoomState(serverState);
  socket.to(room).emit('player-joined', serializePlayer(playerData));
  io.to(room).emit('update-leaderboard', getLeaderboard(serverState));
  emitServersUpdate();
  });

  socket.on('respawn-player', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;

    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    // ============================================
    // Применяем админ-бонусы при респавне
    const usernameLower = state.playerData.username.toLowerCase();
    const adminBonus = ADMIN_BONUSES[usernameLower] || {};
    // ============================================

    state.playerData.color = data && data.color ? data.color : state.playerData.color;
    state.playerData.headUrl = normalizeHeadUrl(data && data.headUrl) || state.playerData.headUrl;
    state.playerData.score = adminBonus.startScore || 50;
    state.playerData.x = (Math.random() - 0.5) * 80;
    state.playerData.z = (Math.random() - 0.5) * 80;
    state.playerData.segments = [];
    state.playerData.alive = true;
    state.playerData.speedMultiplier = adminBonus.speedMultiplier || 1;
    state.playerData.invincible = adminBonus.invincible || false;

    socket.emit('respawn-success', {
    player: serializePlayer(state.playerData),
    server: publicServerData(serverState),
    burrows: serverBurrows
  });
  sendRoomState(serverState);
    socket.to(String(state.serverId)).emit('player-joined', serializePlayer(state.playerData));
    io.to(String(state.serverId)).emit('update-leaderboard', getLeaderboard(serverState));
    emitServersUpdate();
  });

  socket.on('update-position', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;

    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const x = Number(data && data.x);
    const z = Number(data && data.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    state.playerData.x = x;
    state.playerData.z = z;
    state.playerData.segments = normalizeSegments(data && data.segments, { x, z });

    const score = Number(data && data.score);
    if (Number.isFinite(score)) {
      state.playerData.score = Math.max(0, Math.floor(score));
    }

    const killer = findBodyCollision(serverState, state.playerData);
    if (killer) {
      killPlayer(serverState, state.playerData, killer);
      return;
    }

    socket.to(String(state.serverId)).emit('player-moved', {
      id: socket.id,
      x: state.playerData.x,
      z: state.playerData.z,
      score: state.playerData.score,
      clanId: state.playerData.clanId || null
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
    if (!state || state.playerData.alive === false) return;

    const nextScore = Math.max(0, Math.floor(Number(score)));
    if (!Number.isFinite(nextScore)) return;

    state.playerData.score = nextScore;
    const serverState = servers.get(state.serverId);
    if (serverState) {
      io.to(String(state.serverId)).emit('update-leaderboard', getLeaderboard(serverState));
    }
  });

  socket.on('create-clan', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const name = normalizeClanName(data && data.name);
    if (!name || name.length < 2) {
      socket.emit('clan-error', 'Clan name is too short');
      return;
    }
    if ((serverState.clans || []).some(clan => clan.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('clan-error', 'Clan already exists');
      return;
    }
    // Check if user already owns a clan
    if ((serverState.clans || []).some(clan => clan.owner === state.playerData.username)) {
      socket.emit('clan-error', 'You already own a clan');
      return;
    }

    const clan = { id: createClanId(), name, owner: state.playerData.username, createdAt: Date.now(), pendingRequests: [] };
    serverState.clans.push(clan);
    state.playerData.clanId = clan.id;
    state.playerData.clanName = clan.name;
    socket.emit('my-clan-update', { clanId: clan.id });
    io.to(String(state.serverId)).emit('player-clan-updated', { id: socket.id, clanId: clan.id, clanName: clan.name });
    emitClanState(serverState);
  });

  socket.on('request-join-clan', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }
    
    // Check if already in clan or already requested
    if (state.playerData.clanId) {
      socket.emit('clan-error', 'You are already in a clan');
      return;
    }
    if ((clan.pendingRequests || []).some(req => req.username === state.playerData.username)) {
      socket.emit('clan-error', 'You already requested to join this clan');
      return;
    }
    
    clan.pendingRequests = clan.pendingRequests || [];
    clan.pendingRequests.push({
      id: socket.id,
      username: state.playerData.username
    });
    
    emitClanState(serverState);
  });
  
  socket.on('accept-clan-request', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const playerId = String(data && data.playerId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }
    if (clan.owner !== state.playerData.username) {
      socket.emit('clan-error', 'You are not the clan owner');
      return;
    }
    
    // Find player to accept
    const playerToAccept = serverState.playerList.find(p => p.id === playerId);
    if (!playerToAccept) {
      socket.emit('clan-error', 'Player not found');
      return;
    }
    
    // Remove from pending
    clan.pendingRequests = (clan.pendingRequests || []).filter(req => req.id !== playerId);
    
    // Add to clan
    playerToAccept.clanId = clan.id;
    playerToAccept.clanName = clan.name;
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
      playerSocket.emit('my-clan-update', { clanId: clan.id });
    }
    io.to(String(state.serverId)).emit('player-clan-updated', { id: playerId, clanId: clan.id, clanName: clan.name });
    emitClanState(serverState);
  });
  
  socket.on('reject-clan-request', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const playerId = String(data && data.playerId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }
    if (clan.owner !== state.playerData.username) {
      socket.emit('clan-error', 'You are not the clan owner');
      return;
    }
    
    // Remove from pending
    clan.pendingRequests = (clan.pendingRequests || []).filter(req => req.id !== playerId);
    
    emitClanState(serverState);
  });

  socket.on('join-clan', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }

    state.playerData.clanId = clan.id;
    state.playerData.clanName = clan.name;
    socket.emit('my-clan-update', { clanId: clan.id });
    io.to(String(state.serverId)).emit('player-clan-updated', { id: socket.id, clanId: clan.id, clanName: clan.name });
    emitClanState(serverState);
  });

  socket.on('leave-clan', () => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    state.playerData.clanId = null;
    state.playerData.clanName = null;
    socket.emit('my-clan-update', { clanId: null });
    io.to(String(state.serverId)).emit('player-clan-updated', { id: socket.id, clanId: null });
    emitClanState(serverState);
  });
  
  socket.on('kick-clan-member', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const playerId = String(data && data.playerId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }
    if (clan.owner !== state.playerData.username) {
      socket.emit('clan-error', 'You are not the clan owner');
      return;
    }
    if (playerId === socket.id) {
      socket.emit('clan-error', 'Cannot kick yourself');
      return;
    }
    
    const playerToKick = serverState.playerList.find(p => p.id === playerId);
    if (!playerToKick) {
      socket.emit('clan-error', 'Player not found');
      return;
    }
    
    playerToKick.clanId = null;
    playerToKick.clanName = null;
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
      playerSocket.emit('my-clan-update', { clanId: null });
    }
    io.to(String(state.serverId)).emit('player-clan-updated', { id: playerId, clanId: null });
    emitClanState(serverState);
  });
  
  socket.on('dissolve-clan', (data) => {
    const state = playerServerMap.get(socket.id);
    if (!state || state.playerData.alive === false) return;
    const serverState = servers.get(state.serverId);
    if (!serverState) return;

    const clanId = String(data && data.clanId || '');
    const clan = (serverState.clans || []).find(item => item.id === clanId);
    if (!clan) {
      socket.emit('clan-error', 'Clan not found');
      return;
    }
    if (clan.owner !== state.playerData.username) {
      socket.emit('clan-error', 'You are not the clan owner');
      return;
    }
    
    // Remove all members from clan
    serverState.playerList.forEach(player => {
      if (player.clanId === clanId) {
        player.clanId = null;
        player.clanName = null;
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
          playerSocket.emit('my-clan-update', { clanId: null });
        }
        io.to(String(state.serverId)).emit('player-clan-updated', { id: player.id, clanId: null });
      }
    });
    
    // Remove clan
    serverState.clans = serverState.clans.filter(c => c.id !== clanId);
    emitClanState(serverState);
  });

  socket.on('request-clans', () => {
    const state = playerServerMap.get(socket.id);
    if (!state) return;
    const serverState = servers.get(state.serverId);
    if (serverState) {
      socket.emit('clans-update', serializeClans(serverState));
      socket.emit('my-clan-update', { clanId: state.playerData.clanId || null });
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
  console.log(`Running locally:  http://localhost:${PORT}`);
  console.log(`On your network:  http://${localIP}:${PORT}`);
  console.log(`Data root:        ${dataRoot}`);
  console.log(`Admin login:      ${ADMIN_USERNAME}`);
  console.log('\x1b[32m%s\x1b[0m', '=========================================');
  console.log('Assets:');
  console.log(`   Admin heads:   ${assetDirs.adminHeads}`);
  console.log(`   Submissions:   ${assetDirs.userSubmissions}`);
  console.log(`   Notes:         ${assetDirs.notes}`);
  console.log('\x1b[32m%s\x1b[0m', '=========================================\n');
});
