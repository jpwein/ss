const urlParams = new URLSearchParams(window.location.search);
let storedUser = null;
try {
  storedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch (e) {
  storedUser = null;
}

let pendingJoin = {};
try {
  pendingJoin = JSON.parse(sessionStorage.getItem('sekaiJoin') || '{}');
} catch (e) {
  pendingJoin = {};
}

const username = (storedUser && storedUser.username) || urlParams.get('username') || '';
const colorParam = pendingJoin.color || urlParams.get('color') || '#00ff00';
const selectedHeadUrl = pendingJoin.headUrl || urlParams.get('head') || '';
const serverId = Number(urlParams.get('server'));
const authToken = localStorage.getItem('token') || '';
const serverPassword = Number(pendingJoin.serverId) === serverId ? pendingJoin.password : null;

// Change these two values whenever you want a different field color.
const FIELD_DAY_COLOR = 0x7CC481;  // Цвет поля для дня (можно изменить)
const FIELD_NIGHT_COLOR = 0x2A3F2B;  // Цвет поля для ночи (можно изменить)
const DAY_DURATION_MS = 10 * 60 * 1000;
const NIGHT_DURATION_MS = 10 * 60 * 1000;
const DAY_NIGHT_TRANSITION_MS = 60 * 1000;

const GROUND_SIZE = 1600;
const CAMERA_SCALE = 28;
const SNAKE_SEGMENT_DISTANCE = 1.35;
const TRAIL_STEP = 5;
const MINIMAP_RANGE = 150;
const MAX_NOTES = 220;

// ============================================
// НАСТРОЙКИ ТРАВЫ - МОЖНО ИЗМЕНИТЬ ЗДЕСЬ:
const GRASS_CONFIG = {
  enabled: true,                // Включить/выключить траву
  count: 300,                   // Количество травинок на поле
  minSize: 2.5,                 // Минимальный размер травинки
  maxSize: 5.0,                 // Максимальный размер травинки
  folder: '/assets/grass/',     // Папка с текстурами травы (твои картинки сюда!)
  defaultTexture: null          // Если нет текстур, будет использоваться цвет
};
// ============================================

// ============================================
// НАСТРОЙКИ НОРОК - МОЖНО ИЗМЕНИТЬ ЗДЕСЬ:
const BURROW_CONFIG = {
  enabled: true,              // Включить/выключить норки
  count: 60,                  // Удваиваем количество норок
  radius: 5,                  // Уменьшаем размер
  innerRadius: 3,             // Радиус внутренней зоны
  color: 0x000000,            // Цвет норки
  opacity: 0.3,               // Прозрачность норки
  pulseSpeed: 0.002           // Скорость пульсации норки
};
// ============================================

// ============================================
// ЧТОБЫ ИЗМЕНИТЬ РАЗМЕР НОТОК, ИЗМЕНИТЕ ЭТУ СТРОКУ:
const NOTE_SCALE_FACTOR = 1.0;  // Увеличьте значение, чтобы сделать нотки больше (например, 1.5 = 50% больше)
// ============================================

// ============================================
// НАСТРОЙКИ РОСТА И КАМЕРЫ:
const GROWTH_CONFIG = {
  scoreStep: 50,                    // Каждые сколько очков растем
  sizeIncreasePercent: 2,           // На сколько процентов увеличиваем размер (2%)
  cameraIncreasePercent: 3          // На сколько процентов отдаляем камеру (3%)
};
// ============================================



// Change note size, points, texture and boosts here.
const NOTE_TYPES = [
  {
    id: 'note-10',
    points: 10,
    texture: '/assets/notes/note-10.png',
    size: 4.1 * NOTE_SCALE_FACTOR,
    weight: 70,
    boost: null
  },
  {
    id: 'note-25',
    points: 25,
    texture: '/assets/notes/note-25.png',
    size: 4.8 * NOTE_SCALE_FACTOR,
    weight: 30,
    boost: { type: 'speed', multiplier: 1.25, durationMs: 3500 }
  }
];

// ============================================
// ЧТОБЫ ДОБАВИТЬ СОБСТВЕННЫЕ ОЧКИ И БУСТЫ ДЛЯ СЕБЯ (АДМИНИСТРАТОРА),
// ИЗМЕНИТЕ ЭТОТ ОБЪЕКТ:
const PLAYER_BONUSES = {
  admin: { startScore: 50, speedMultiplier: 1 }  // Админ по умолчанию
  // Пример: добавь другому игроку:
  // , 'ваше_имя': { startScore: 100, speedMultiplier: 1.2 }
};
// ============================================

const getPersonalBonus = () => PLAYER_BONUSES[String(username || '').toLowerCase()] || {};
const getStartScore = () => Math.max(0, Number(getPersonalBonus().startScore) || 50);
const getBaseMoveSpeed = () => 54 * (Number(getPersonalBonus().speedMultiplier) || 1);

const socket = io();
const scene = new THREE.Scene();
const dayColor = new THREE.Color(FIELD_DAY_COLOR);
const nightColor = new THREE.Color(FIELD_NIGHT_COLOR);
scene.background = dayColor.clone();

const camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 1200);
camera.position.set(0, 82, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game-container').appendChild(renderer.domElement);

// CSS2DRenderer для никнеймов
const labelRenderer = new THREE.CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
document.getElementById('css2d-container').appendChild(labelRenderer.domElement);

const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: FIELD_DAY_COLOR,
  roughness: 0.88,
  metalness: 0.02,
  side: THREE.DoubleSide
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(GROUND_SIZE, 160, 0xffffff, 0x48624a);
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.22;
scene.add(gridHelper);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.78);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.72);
directionalLight.position.set(80, 120, 40);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const snakeColor = new THREE.Color(colorParam);

let playerScore = getStartScore();
let serverCreatedAt = Date.now();
let snake = [];
let snakeTrail = [];
let localHeadBadge = null;
let localUsernameLabel = null; // Никнейм над нашей головой
let localClanNameLabel = null; // Название клана над нашей головой
let isGameStarted = false;
let hasJoinedServer = false;
let isDead = false;
let currentVelocity = new THREE.Vector2(0, 0);
let lastMoveDirection = new THREE.Vector2(1, 0);
let speedBoostUntil = 0;
let speedBoostMultiplier = 1;
const keys = {};
const notes = [];
const otherPlayers = new Map();
let leaderboard = [];
let clans = [];
let myClanId = null;

// ============================================
// Переменные для травы и норок:
let grassObjects = [];
let burrows = [];
let isInBurrow = false;
let burrowOpacity = 0;  // Прозрачность игрока (для плавного эффекта)
// ============================================

// ============================================
// Переменные для роста и камеры:
let lastGrowthScore = 50; // Начальное количество очков
let currentScale = 1.0;   // Текущий масштаб
let targetScale = 1.0;    // Целевой масштаб
let cameraBaseScale = CAMERA_SCALE; // Базовый масштаб камеры
let cameraTargetScale = CAMERA_SCALE; // Целевой масштаб камеры
// ============================================

const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const toggleChatBtn = document.getElementById('toggle-chat');
const chatDiv = document.getElementById('chat');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatMessages = document.getElementById('chat-messages');
const toggleClansBtn = document.getElementById('toggle-clans');
const clanPanel = document.getElementById('clan-panel');
const clanNameInput = document.getElementById('clan-name');
const createClanBtn = document.getElementById('create-clan');
const leaveClanBtn = document.getElementById('leave-clan');
const clanListEl = document.getElementById('clan-list');
const clanStatusEl = document.getElementById('clan-status');
const deathOverlay = document.getElementById('death-overlay');
const deathReason = document.getElementById('death-reason');
const restartGameBtn = document.getElementById('restart-game');
const returnLobbyBtn = document.getElementById('return-lobby');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

const loadTexture = (url) => {
  if (!url) return Promise.resolve(null);
  if (textureCache.has(url)) return textureCache.get(url);

  const texturePromise = new Promise(resolve => {
    textureLoader.load(
      url,
      texture => {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        resolve(texture);
      },
      undefined,
      () => resolve(null)
    );
  });
  textureCache.set(url, texturePromise);
  return texturePromise;
};

const resizeCamera = () => {
  camera.left = window.innerWidth / -CAMERA_SCALE;
  camera.right = window.innerWidth / CAMERA_SCALE;
  camera.top = window.innerHeight / CAMERA_SCALE;
  camera.bottom = window.innerHeight / -CAMERA_SCALE;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

const resizeMinimap = () => {
  const size = minimapCanvas.clientWidth || 170;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  minimapCanvas.width = Math.floor(size * dpr);
  minimapCanvas.height = Math.floor(size * dpr);
};

// ============================================
// Функции для травы и норок:
const createGrass = async () => {
  if (!GRASS_CONFIG.enabled) return;
  
  // Создадим простую текстуру травы, если нет твоих картинок
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x4CAF50,
    roughness: 0.9,
    metalness: 0.0
  });
  
  for (let i = 0; i < GRASS_CONFIG.count; i++) {
    const size = GRASS_CONFIG.minSize + Math.random() * (GRASS_CONFIG.maxSize - GRASS_CONFIG.minSize);
    const geometry = new THREE.ConeGeometry(size * 0.3, size, 4);
    const grass = new THREE.Mesh(geometry, grassMaterial);
    
    // Разбрасываем траву по полю
    grass.position.x = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    grass.position.y = size * 0.4;
    grass.position.z = (Math.random() - 0.5) * (GROUND_SIZE - 100);
    
    // Случайный поворот
    grass.rotation.y = Math.random() * Math.PI * 2;
    
    scene.add(grass);
    grassObjects.push(grass);
  }
};

const createBurrows = (serverBurrows = null) => {
  if (!BURROW_CONFIG.enabled) return;
  
  // Очищаем старые норки
  burrows.forEach(b => scene.remove(b.mesh));
  burrows = [];
  
  // Используем норки от сервера или генерируем свои
  const burrowsToCreate = serverBurrows || [];
  const countToCreate = serverBurrows ? serverBurrows.length : BURROW_CONFIG.count;
  
  for (let i = 0; i < countToCreate; i++) {
    const burrowData = serverBurrows ? serverBurrows[i] : null;
    const burrow = new THREE.Group();
    
    // Создаем два полупрозрачных круга (внешний и внутренний)
    const outerRing = new THREE.Mesh(
      new THREE.CircleGeometry(BURROW_CONFIG.radius, 32),
      new THREE.MeshBasicMaterial({
        color: BURROW_CONFIG.color,
        transparent: true,
        opacity: BURROW_CONFIG.opacity,
        side: THREE.DoubleSide
      })
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.01;
    burrow.add(outerRing);
    
    const innerRing = new THREE.Mesh(
      new THREE.CircleGeometry(BURROW_CONFIG.innerRadius, 32),
      new THREE.MeshBasicMaterial({
        color: BURROW_CONFIG.color,
        transparent: true,
        opacity: BURROW_CONFIG.opacity * 1.5,
        side: THREE.DoubleSide
      })
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.02;
    burrow.add(innerRing);
    
    // Используем позицию от сервера или генерируем свою
    let x, z;
    if (burrowData) {
      x = burrowData.x;
      z = burrowData.z;
    } else {
      x = (Math.random() - 0.5) * (GROUND_SIZE - 200);
      z = (Math.random() - 0.5) * (GROUND_SIZE - 200);
    }
    burrow.position.set(x, 0, z);
    
    scene.add(burrow);
    
    // Сохраняем данные о норке
    burrows.push({
      mesh: burrow,
      x: x,
      z: z,
      radius: BURROW_CONFIG.radius,
      innerRadius: BURROW_CONFIG.innerRadius,
      outerRing: outerRing,
      innerRing: innerRing,
      index: i
    });
  }
};

// Обновляем одну норку
const updateSingleBurrow = (index, newBurrowData) => {
  if (index >= 0 && index < burrows.length) {
    const b = burrows[index];
    // Плавно перемещаем норку
    const moveDuration = 1000; // 1 секунда
    const startX = b.x;
    const startZ = b.z;
    const targetX = newBurrowData.x;
    const targetZ = newBurrowData.z;
    const startTime = Date.now();
    
    const animateMove = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / moveDuration, 1);
      const t = smoothStep(progress);
      
      b.x = startX + (targetX - startX) * t;
      b.z = startZ + (targetZ - startZ) * t;
      b.mesh.position.x = b.x;
      b.mesh.position.z = b.z;
      
      if (progress < 1) {
        requestAnimationFrame(animateMove);
      }
    };
    animateMove();
  }
};

// Проверка, находится ли игрок в норке
const checkIfInBurrow = (playerX, playerZ) => {
  if (!BURROW_CONFIG.enabled) return { inBurrow: false, opacity: 0 };
  
  for (const burrow of burrows) {
    const dist = Math.hypot(playerX - burrow.x, playerZ - burrow.z);
    
    if (dist < burrow.innerRadius) {
      // Полная невидимость внутри норки
      return { inBurrow: true, opacity: 0 };
    } else if (dist < burrow.radius) {
      // Плавный переход между видимым и невидимым
      const t = (dist - burrow.innerRadius) / (burrow.radius - burrow.innerRadius);
      return { inBurrow: true, opacity: t };
    }
  }
  
  return { inBurrow: false, opacity: 1 };
};

// Обновление пульсации норок
const updateBurrows = (time) => {
  for (const burrow of burrows) {
    const pulse = Math.sin(time * BURROW_CONFIG.pulseSpeed) * 0.05 + 1;
    burrow.outerRing.scale.setScalar(pulse);
    burrow.innerRing.scale.setScalar(pulse + 0.05);
  }
};
// ============================================

const scoreToLength = (score) => Math.min(140, 5 + Math.floor(Math.max(0, score - 50) / 10));

const createSnakeSegment = (color, isHead = false) => {
  const radius = isHead ? 1.22 : 1.02;
  const geometry = new THREE.SphereGeometry(radius, 24, 18);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05
  });
  const segment = new THREE.Mesh(geometry, material);
  segment.scale.y = isHead ? 0.82 : 0.72;
  segment.castShadow = true;
  segment.receiveShadow = true;
  return segment;
};

const removeObject = (object) => {
  if (!object) return;
  scene.remove(object);
  object.traverse?.(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
};

const createHeadBadge = (texture) => {
  if (!texture) return null;
  const geometry = new THREE.PlaneGeometry(2.8, 2.8);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const badge = new THREE.Mesh(geometry, material);
  badge.rotation.x = -Math.PI / 2;
  scene.add(badge);
  return badge;
};


const createUsernameLabel = (name) => {
  const div = document.createElement('div');
  div.className = 'username-label';
  div.textContent = name;
  
  const label = new THREE.CSS2DObject(div);
  scene.add(label);
  return label;
};

const createClanLabel = (name) => {
  const div = document.createElement('div');
  div.className = 'clan-label';
  div.textContent = `[${name}]`;
  
  const label = new THREE.CSS2DObject(div);
  scene.add(label);
  return label;
};

const setLocalHeadBadge = async () => {
  removeObject(localHeadBadge);
  localHeadBadge = null;
  if (!selectedHeadUrl) return;

  const texture = await loadTexture(selectedHeadUrl);
  if (!texture) return;
  localHeadBadge = createHeadBadge(texture);
};

const placeBadge = (badge, head, direction) => {
  if (!badge || !head) return;
  badge.position.set(head.position.x, 2.05, head.position.z);
  badge.rotation.z = -Math.atan2(direction.y, direction.x) + Math.PI / 2;
};

const createSnake = (startX = 0, startZ = 0) => {
  snake.forEach(removeObject);
  snake = [];
  snakeTrail = [];
  
  // Удаляем старые лейблы
  if (localClanNameLabel) {
    scene.remove(localClanNameLabel);
    localClanNameLabel = null;
  }
  
  const length = scoreToLength(playerScore);
  for (let i = 0; i < length; i++) {
    const segment = createSnakeSegment(snakeColor, i === 0);
    segment.position.set(startX - i * SNAKE_SEGMENT_DISTANCE, 0.95, startZ);
    scene.add(segment);
    snake.push(segment);
  }
  for (let i = 0; i < length * TRAIL_STEP + 40; i++) {
    snakeTrail.push({ x: startX - i * (SNAKE_SEGMENT_DISTANCE / TRAIL_STEP), z: startZ });
  }
  
  setLocalHeadBadge();
};

const syncSnakeLength = () => {
  const targetLength = scoreToLength(playerScore);
  while (snake.length < targetLength) {
    const tail = snake[snake.length - 1];
    const segment = createSnakeSegment(snakeColor, false);
    segment.position.copy(tail.position);
    scene.add(segment);
    snake.push(segment);
  }
  while (snake.length > targetLength) {
    removeObject(snake.pop());
  }
};

const createOtherPlayer = (playerData) => {
  if (!playerData || playerData.id === socket.id) return;
  if (otherPlayers.has(playerData.id)) removeOtherPlayer(playerData.id);

  const color = new THREE.Color(playerData.color || '#ff0000');
  const length = scoreToLength(playerData.score || 50);
  const baseX = Number.isFinite(playerData.x) ? playerData.x : 0;
  const baseZ = Number.isFinite(playerData.z) ? playerData.z : 0;
  const segments = [];
  for (let i = 0; i < length; i++) {
    const segment = createSnakeSegment(color, i === 0);
    segment.position.set(baseX - i * SNAKE_SEGMENT_DISTANCE, 0.95, baseZ);
    scene.add(segment);
    segments.push(segment);
  }

  const player = {
    segments,
    color,
    username: playerData.username,
    score: playerData.score || 50,
    targetPos: { x: baseX, z: baseZ },
    history: Array.from({ length: length * TRAIL_STEP + 20 }, (_, i) => ({
      x: baseX - i * (SNAKE_SEGMENT_DISTANCE / TRAIL_STEP),
      z: baseZ
    })),
    headUrl: playerData.headUrl || '',
    headBadge: null,
    clanNameLabel: null,
    clanId: playerData.clanId || null,
    clanName: playerData.clanName || null
  };
  otherPlayers.set(playerData.id, player);

  if (player.headUrl) {
    loadTexture(player.headUrl).then(texture => {
      const current = otherPlayers.get(playerData.id);
      if (!current || !texture) return;
      current.headBadge = createHeadBadge(texture);
    });
  }
  
  // Создаем лейбл клана для другого игрока
  if (player.clanName) {
    player.clanNameLabel = createClanLabel(player.clanName);
  }
};

const updateOtherPlayerLength = (player, newScore) => {
  const targetLength = scoreToLength(newScore);
  while (player.segments.length < targetLength) {
    const tail = player.segments[player.segments.length - 1];
    const segment = createSnakeSegment(player.color, false);
    segment.position.copy(tail.position);
    scene.add(segment);
    player.segments.push(segment);
  }
  while (player.segments.length > targetLength) {
    removeObject(player.segments.pop());
  }
  player.score = newScore;
};

const removeOtherPlayer = (socketId) => {
  const player = otherPlayers.get(socketId);
  if (!player) return;
  player.segments.forEach(removeObject);
  removeObject(player.headBadge);
  if (player.clanNameLabel) {
    scene.remove(player.clanNameLabel);
    player.clanNameLabel = null;
  }
  otherPlayers.delete(socketId);
};

const chooseNoteType = (points) => {
  if (Number.isFinite(points)) {
    return NOTE_TYPES.reduce((best, type) => {
      return Math.abs(type.points - points) < Math.abs(best.points - points) ? type : best;
    }, NOTE_TYPES[0]);
  }

  const totalWeight = NOTE_TYPES.reduce((sum, type) => sum + type.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const type of NOTE_TYPES) {
    roll -= type.weight;
    if (roll <= 0) return type;
  }
  return NOTE_TYPES[0];
};

const createNoteMesh = async (type, x, z, pointsOverride) => {
  const texture = await loadTexture(type.texture);
  const geometry = new THREE.PlaneGeometry(type.size, type.size);
  const material = texture
    ? new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ color: type.points >= 25 ? 0xf6a63a : 0xffe07a, side: THREE.DoubleSide });
  const note = new THREE.Mesh(geometry, material);
  note.position.set(x, 0.7, z);
  note.rotation.x = -Math.PI / 2;
  note.userData.type = type;
  note.userData.points = Number.isFinite(pointsOverride) ? pointsOverride : type.points;
  note.userData.spawnedAt = performance.now();
  scene.add(note);
  notes.push(note);
};

const spawnNote = () => {
  if (notes.length >= MAX_NOTES) return;
  const type = chooseNoteType();
  const x = (Math.random() - 0.5) * (GROUND_SIZE - 80);
  const z = (Math.random() - 0.5) * (GROUND_SIZE - 80);
  createNoteMesh(type, x, z);
};

const scheduleNoteSpawn = () => {
  setTimeout(() => {
    spawnNote();
    scheduleNoteSpawn();
  }, Math.random() * 5500 + 2500);
};

const applyNoteBoost = (type) => {
  if (!type.boost) return;
  if (type.boost.type === 'speed') {
    speedBoostMultiplier = Number(type.boost.multiplier) || 1;
    speedBoostUntil = performance.now() + (Number(type.boost.durationMs) || 0);
  }
};

const getCurrentMoveSpeed = () => {
  if (performance.now() > speedBoostUntil) {
    speedBoostMultiplier = 1;
  }
  return getBaseMoveSpeed() * speedBoostMultiplier;
};

const updateLeaderboard = () => {
  const leaderboardEl = document.getElementById('leaderboard-list');
  if (!leaderboard.length) {
    leaderboardEl.innerHTML = '<div class="leaderboard-item"><span>...</span><span>0</span></div>';
    return;
  }

  leaderboard.sort((a, b) => b.score - a.score);
  leaderboardEl.innerHTML = leaderboard.map((player, index) => `
    <div class="leaderboard-item">
      <span>${index + 1}. ${escapeHtml(player.username)}</span>
      <span><strong>${Number(player.score) || 0}</strong></span>
    </div>
  `).join('');
};

const updateLocalLeaderboardEntry = () => {
  const entry = leaderboard.find(player => player.id === socket.id || player.username === username);
  if (entry) {
    entry.score = playerScore;
  } else {
    leaderboard.push({ id: socket.id, username, score: playerScore, clanId: myClanId });
  }
  updateLeaderboard();
};

const checkNoteCollisions = () => {
  if (!snake.length || isDead) return;
  const headPos = snake[0].position;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const dist = Math.hypot(headPos.x - note.position.x, headPos.z - note.position.z);
    const pickupRadius = 2.1 + (note.userData.type.size * 0.18);
    if (dist < pickupRadius) {
      scene.remove(note);
      notes.splice(i, 1);
      playerScore += note.userData.points || 10;
      applyNoteBoost(note.userData.type);
      syncSnakeLength();
      updateLocalLeaderboardEntry();
      socket.emit('update-score', playerScore);
    }
  }
};

const isTextInputFocused = () => {
  const tagName = document.activeElement && document.activeElement.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA';
};

const isMoveKey = (key) => ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);

const updateDirectionFromKeys = () => {
  if (joystickActive) return;

  let x = 0;
  let z = 0;
  if (keys.w || keys.arrowup) z -= 1;
  if (keys.s || keys.arrowdown) z += 1;
  if (keys.a || keys.arrowleft) x -= 1;
  if (keys.d || keys.arrowright) x += 1;

  if (x !== 0 && z !== 0) {
    const diagonal = 1 / Math.sqrt(2);
    x *= diagonal;
    z *= diagonal;
  }
  nextDirection = { x, z };
};

let nextDirection = { x: 0, z: 0 };

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (isMoveKey(key) && !isTextInputFocused() && !isDead) {
    e.preventDefault();
    keys[key] = true;
    if (!isGameStarted) isGameStarted = true;
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (isMoveKey(key)) {
    keys[key] = false;
    updateDirectionFromKeys();
  }
});

window.addEventListener('blur', () => {
  Object.keys(keys).forEach(key => { keys[key] = false; });
  nextDirection = { x: 0, z: 0 };
});

const joystickContainer = document.getElementById('joystick-container');
const joystickHandle = document.getElementById('joystick-handle');
let joystickActive = false;
let joystickId = null;

const updateJoystick = (touch) => {
  const rect = joystickContainer.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let dx = touch.clientX - centerX;
  let dy = touch.clientY - centerY;
  const maxDist = rect.width / 2 - 30;
  const dist = Math.hypot(dx, dy);
  if (dist > maxDist) {
    dx = (dx / dist) * maxDist;
    dy = (dy / dist) * maxDist;
  }
  joystickHandle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  const deadzone = 10;
  if (Math.abs(dx) > deadzone || Math.abs(dy) > deadzone) {
    const length = Math.hypot(dx, dy) || 1;
    nextDirection = { x: dx / length, z: dy / length };
  } else {
    nextDirection = { x: 0, z: 0 };
  }
};

const handleJoystickStart = (e) => {
  e.preventDefault();
  if (isDead) return;
  joystickActive = true;
  if (!isGameStarted) isGameStarted = true;
  const touch = e.touches ? e.touches[0] : e;
  joystickId = e.touches ? touch.identifier : null;
  updateJoystick(touch);
};

const handleJoystickMove = (e) => {
  e.preventDefault();
  if (!joystickActive || isDead) return;
  const touch = e.touches ? Array.from(e.touches).find(t => t.identifier === joystickId) : e;
  if (touch) updateJoystick(touch);
};

const handleJoystickEnd = (e) => {
  e.preventDefault();
  joystickActive = false;
  joystickId = null;
  nextDirection = { x: 0, z: 0 };
  joystickHandle.style.transform = 'translate(-50%, -50%)';
};

joystickContainer.addEventListener('touchstart', handleJoystickStart, { passive: false });
joystickContainer.addEventListener('touchmove', handleJoystickMove, { passive: false });
joystickContainer.addEventListener('touchend', handleJoystickEnd, { passive: false });
joystickContainer.addEventListener('touchcancel', handleJoystickEnd, { passive: false });
joystickContainer.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', handleJoystickMove);
document.addEventListener('mouseup', handleJoystickEnd);

toggleChatBtn.addEventListener('click', () => chatDiv.classList.toggle('hidden'));

const addChatMessage = (sender, message) => {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message';
  msgEl.innerHTML = `<strong>${escapeHtml(sender)}</strong>: ${escapeHtml(message)}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

chatSend.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (message && hasJoinedServer) {
    socket.emit('chat-message', { message });
    chatInput.value = '';
  }
});
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') chatSend.click();
});

const renderClans = () => {
  if (!clans.length) {
    clanListEl.innerHTML = '<div class="clan-row"><span>Кланов нет</span></div>';
  } else {
    const myCurrentClan = clans.find(c => c.id === myClanId);
    clanListEl.innerHTML = clans.map(clan => {
      const isOwner = clan.owner === username;
      let buttonHtml = '';
      if (myClanId) {
        if (clan.id === myClanId) {
          buttonHtml = '<button disabled>Вы в этом клане</button>';
        }
      } else {
        buttonHtml = `<button data-clan-id="${escapeHtml(clan.id)}" data-action="request">Запрос на вступление</button>`;
      }
      
      let requestsHtml = '';
      if (isOwner && clan.pendingRequests && clan.pendingRequests.length > 0) {
        requestsHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
          <div style="font-size:11px;color:#9ee0a3;margin-bottom:4px;">Запросы на вступление:</div>
          ${clan.pendingRequests.map(req => `
            <div style="display:flex;gap:4px;margin-bottom:4px;">
              <span style="font-size:11px;">${escapeHtml(req.username)}</span>
              <button data-clan-id="${escapeHtml(clan.id)}" data-player-id="${escapeHtml(req.id)}" data-action="accept" style="padding:2px 6px;font-size:11px;background:#6fbf73;border:0;border-radius:4px;cursor:pointer;">Принять</button>
              <button data-clan-id="${escapeHtml(clan.id)}" data-player-id="${escapeHtml(req.id)}" data-action="reject" style="padding:2px 6px;font-size:11px;background:rgba(255,255,255,0.2);border:0;border-radius:4px;cursor:pointer;">Отклонить</button>
            </div>
          `).join('')}
        </div>`;
      }
      
      let membersHtml = '';
      if (isOwner && clan.memberList && clan.memberList.length > 0) {
        membersHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
          <div style="font-size:11px;color:#9ee0a3;margin-bottom:4px;">Участники:</div>
          ${clan.memberList.map(member => `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:11px;">${escapeHtml(member.username)}${member.username === clan.owner ? ' (владелец)' : ''}</span>
              ${member.username !== clan.owner ? `
                <button data-clan-id="${escapeHtml(clan.id)}" data-player-id="${escapeHtml(member.id)}" data-action="kick" style="padding:2px 6px;font-size:11px;background:#c74444;color:#fff;border:0;border-radius:4px;cursor:pointer;">Кик</button>
              ` : ''}
            </div>
          `).join('')}
          <button data-clan-id="${escapeHtml(clan.id)}" data-action="dissolve" style="margin-top:8px;padding:4px 8px;font-size:11px;background:#c74444;color:#fff;border:0;border-radius:4px;cursor:pointer;width:100%;">Распустить клан</button>
        </div>`;
      }

      return `
        <div class="clan-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
            <span>${escapeHtml(clan.name)} (${Number(clan.members) || 0})</span>
            ${buttonHtml}
          </div>
          ${requestsHtml}
          ${membersHtml}
        </div>
      `;
    }).join('');
  }
  const currentClan = clans.find(clan => clan.id === myClanId);
  clanStatusEl.textContent = currentClan ? `Твой клан: ${currentClan.name}` : '';
};

toggleClansBtn.addEventListener('click', () => {
  clanPanel.classList.toggle('hidden');
  socket.emit('request-clans');
});

createClanBtn.addEventListener('click', () => {
  const name = clanNameInput.value.trim();
  if (!name) return;
  socket.emit('create-clan', { name });
  clanNameInput.value = '';
});

leaveClanBtn.addEventListener('click', () => {
  socket.emit('leave-clan');
});

clanListEl.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-clan-id]');
  if (!button) return;
  const clanId = button.dataset.clanId;
  const action = button.dataset.action;
  
  if (action === 'request') {
    socket.emit('request-join-clan', { clanId });
  } else if (action === 'accept') {
    const playerId = button.dataset.playerId;
    socket.emit('accept-clan-request', { clanId, playerId });
  } else if (action === 'reject') {
    const playerId = button.dataset.playerId;
    socket.emit('reject-clan-request', { clanId, playerId });
  } else if (action === 'kick') {
    if (!confirm('Кикнуть этого игрока?')) return;
    const playerId = button.dataset.playerId;
    socket.emit('kick-clan-member', { clanId, playerId });
  } else if (action === 'dissolve') {
    if (!confirm('Распустить клан? Это действие нельзя отменить!')) return;
    socket.emit('dissolve-clan', { clanId });
  }
});

const showDeath = (killer) => {
  isDead = true;
  isGameStarted = false;
  currentVelocity.set(0, 0);
  document.body.classList.add('dead');
  deathReason.textContent = killer
    ? `Тебя остановил игрок ${killer}.`
    : 'Ты врезался в тело другого игрока.';
  deathOverlay.classList.remove('hidden');
};

const hideDeath = () => {
  isDead = false;
  document.body.classList.remove('dead');
  deathOverlay.classList.add('hidden');
};

restartGameBtn.addEventListener('click', () => {
  if (!hasJoinedServer) {
    window.location.reload();
    return;
  }
  socket.emit('respawn-player', { color: colorParam, headUrl: selectedHeadUrl });
});

returnLobbyBtn.addEventListener('click', () => {
  window.location.href = '/';
});

socket.on('connect', () => {
  if (!Number.isInteger(serverId) || serverId <= 0 || !authToken || !username) {
    alert('Login and choose a server first');
    window.location.href = '/';
    return;
  }

  socket.emit('join-server', {
    username,
    color: colorParam,
    headUrl: selectedHeadUrl,
    serverId,
    password: serverPassword,
    token: authToken
  });
});

socket.on('join-success', ({ server, player, burrows: serverBurrows }) => {
  hasJoinedServer = true;
  serverCreatedAt = server && server.createdAt ? server.createdAt : Date.now();
  playerScore = getStartScore();
  createSnake(player.x, player.z);
  if (serverBurrows) createBurrows(serverBurrows);
  hideDeath();
  sessionStorage.removeItem('sekaiJoin');
  updateLocalLeaderboardEntry();
  socket.emit('update-score', playerScore);
});

socket.on('respawn-success', ({ server, player, burrows: serverBurrows }) => {
  hasJoinedServer = true;
  serverCreatedAt = server && server.createdAt ? server.createdAt : serverCreatedAt;
  playerScore = getStartScore();
  createSnake(player.x, player.z);
  if (serverBurrows) createBurrows(serverBurrows);
  hideDeath();
  updateLocalLeaderboardEntry();
  socket.emit('update-score', playerScore);
});

socket.on('join-error', (message) => {
  alert(message || 'Could not join server');
  window.location.href = '/';
});

socket.on('server-closed', (message) => {
  alert(message || 'Сервер закрыт администратором');
  window.location.href = '/';
});

socket.on('disconnect', () => {
  hasJoinedServer = false;
});

socket.on('update-leaderboard', (playersList) => {
  leaderboard = Array.isArray(playersList) ? playersList : [];
  updateLeaderboard();
});

socket.on('player-joined', (playerData) => {
  if (playerData.id !== socket.id) createOtherPlayer(playerData);
});

socket.on('player-left', (socketId) => {
  if (socketId !== socket.id) removeOtherPlayer(socketId);
});

socket.on('player-moved', (data) => {
  if (!data || data.id === socket.id) return;
  const player = otherPlayers.get(data.id);
  if (!player) return;
  player.targetPos = { x: data.x, z: data.z };
  player.clanId = data.clanId || null;
  if (Number.isFinite(Number(data.score)) && Number(data.score) !== player.score) {
    updateOtherPlayerLength(player, Number(data.score));
  }
});

socket.on('initial-players', (playersList) => {
  const visiblePlayers = new Set();
  (playersList || []).forEach(player => {
    if (player.id !== socket.id) {
      visiblePlayers.add(player.id);
      createOtherPlayer(player);
    }
  });
  otherPlayers.forEach((_, id) => {
    if (!visiblePlayers.has(id)) removeOtherPlayer(id);
  });
});

socket.on('chat-message', (data) => addChatMessage(data.username, data.message));

socket.on('player-died', (data) => {
  showDeath(data && data.killer);
});

socket.on('death-drops', (data) => {
  (data.drops || []).forEach(drop => {
    const type = chooseNoteType(Number(drop.points));
    createNoteMesh(type, drop.x, drop.z, Number(drop.points));
  });
});

socket.on('clans-update', (nextClans) => {
  clans = Array.isArray(nextClans) ? nextClans : [];
  renderClans();
});

socket.on('my-clan-update', (data) => {
  myClanId = data && data.clanId ? data.clanId : null;
  updateLocalLeaderboardEntry();
  renderClans();
});

socket.on('burrow-update', (data) => {
  updateSingleBurrow(data.index, data.burrow);
});

socket.on('player-clan-updated', (data) => {
  if (!data) return;
  const player = otherPlayers.get(data.id);
  if (player) {
    player.clanId = data.clanId || null;
    player.clanName = data.clanName || null;
  }
});

socket.on('clan-error', (message) => {
  clanStatusEl.textContent = message || 'Не удалось выполнить действие';
});

const updateSnakeMovement = (deltaTime) => {
  updateDirectionFromKeys();
  const input = new THREE.Vector2(nextDirection.x, nextDirection.z);
  if (input.lengthSq() > 0.001) {
    input.normalize();
    lastMoveDirection.copy(input);
    const targetVelocity = input.multiplyScalar(getCurrentMoveSpeed());
    currentVelocity.lerp(targetVelocity, Math.min(1, deltaTime * 7.5));
  } else {
    currentVelocity.multiplyScalar(Math.max(0, 1 - deltaTime * 8));
  }

  if (currentVelocity.lengthSq() < 0.01) return;

  const head = snake[0];
  head.position.x += currentVelocity.x * deltaTime;
  head.position.z += currentVelocity.y * deltaTime;

  const halfGround = GROUND_SIZE / 2;
  if (head.position.x > halfGround) head.position.x = -halfGround;
  if (head.position.x < -halfGround) head.position.x = halfGround;
  if (head.position.z > halfGround) head.position.z = -halfGround;
  if (head.position.z < -halfGround) head.position.z = halfGround;

  snakeTrail.unshift({ x: head.position.x, z: head.position.z });
  snakeTrail.length = Math.min(snakeTrail.length, snake.length * TRAIL_STEP + 50);

  for (let i = 1; i < snake.length; i++) {
    const follow = snakeTrail[Math.min(i * TRAIL_STEP, snakeTrail.length - 1)];
    if (!follow) continue;
    snake[i].position.x += (follow.x - snake[i].position.x) * Math.min(1, deltaTime * 14);
    snake[i].position.z += (follow.z - snake[i].position.z) * Math.min(1, deltaTime * 14);
  }

  checkNoteCollisions();
};

const updateOtherPlayers = (deltaTime) => {
  otherPlayers.forEach(player => {
    if (!player.targetPos || !player.segments.length) return;
    const head = player.segments[0];
    head.position.x += (player.targetPos.x - head.position.x) * Math.min(1, deltaTime * 8);
    head.position.z += (player.targetPos.z - head.position.z) * Math.min(1, deltaTime * 8);
    player.history.unshift({ x: head.position.x, z: head.position.z });
    player.history.length = Math.min(player.history.length, player.segments.length * TRAIL_STEP + 40);

    for (let i = 1; i < player.segments.length; i++) {
      const follow = player.history[Math.min(i * TRAIL_STEP, player.history.length - 1)];
      if (!follow) continue;
      player.segments[i].position.x += (follow.x - player.segments[i].position.x) * Math.min(1, deltaTime * 12);
      player.segments[i].position.z += (follow.z - player.segments[i].position.z) * Math.min(1, deltaTime * 12);
    }
  });
};

const smoothStep = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

const getDayNightBlend = (now) => {
  const cycle = DAY_DURATION_MS + NIGHT_DURATION_MS;
  const age = (now - serverCreatedAt) % cycle;

  if (age < DAY_DURATION_MS - DAY_NIGHT_TRANSITION_MS) return 0;
  if (age < DAY_DURATION_MS) {
    return smoothStep((age - (DAY_DURATION_MS - DAY_NIGHT_TRANSITION_MS)) / DAY_NIGHT_TRANSITION_MS);
  }
  if (age < cycle - DAY_NIGHT_TRANSITION_MS) return 1;
  return 1 - smoothStep((age - (cycle - DAY_NIGHT_TRANSITION_MS)) / DAY_NIGHT_TRANSITION_MS);
};

const updateDayNight = (now) => {
  const blend = getDayNightBlend(now);
  const fieldColor = dayColor.clone().lerp(nightColor, blend);
  groundMaterial.color.copy(fieldColor);
  scene.background.copy(fieldColor);
  ambientLight.intensity = 0.82 - blend * 0.28;
  directionalLight.intensity = 0.78 - blend * 0.3;
  gridHelper.material.opacity = 0.22 - blend * 0.08;
};

const updateNotes = (time, deltaTime) => {
  notes.forEach(note => {
    note.position.y = 0.75 + Math.sin((time - note.userData.spawnedAt) / 360) * 0.12;
    note.rotation.z += deltaTime * 0.7;
  });
};

const updateAttachments = (time) => {
  if (snake.length) {
    placeBadge(localHeadBadge, snake[0], lastMoveDirection);
    
    // Clan label Y position - above head
    const textY = 3.5;
    
    // Обновляем лейбл клана (если есть)
    if (myClanId) {
      const clan = clans.find(c => c.id === myClanId);
      if (clan && clan.name) {
        if (!localClanNameLabel) {
          localClanNameLabel = createClanLabel(clan.name);
        }
        localClanNameLabel.position.set(
          snake[0].position.x,
          textY,
          snake[0].position.z
        );
        localClanNameLabel.element.style.opacity = burrowOpacity;
      } else if (localClanNameLabel) {
        scene.remove(localClanNameLabel);
        localClanNameLabel = null;
      }
    } else if (localClanNameLabel) {
      scene.remove(localClanNameLabel);
      localClanNameLabel = null;
    }
  }

  otherPlayers.forEach(player => {
    if (!player.segments.length) return;
    const head = player.segments[0];
    const next = player.segments[1] || head;
    const direction = new THREE.Vector2(head.position.x - next.position.x, head.position.z - next.position.z);
    if (direction.lengthSq() < 0.001) direction.set(1, 0);
    direction.normalize();
    placeBadge(player.headBadge, head, direction);
    
    const textY = 3.5;
    
    // Обновляем лейбл клана другого игрока
    if (player.clanName) {
      if (!player.clanNameLabel) {
        player.clanNameLabel = createClanLabel(player.clanName);
      }
      player.clanNameLabel.position.set(
        head.position.x, 
        textY, 
        head.position.z
      );
      
      let otherOpacity = 1;
      for (const burrow of burrows) {
        const dist = Math.hypot(head.position.x - burrow.x, head.position.z - burrow.z);
        if (dist < burrow.innerRadius) {
          otherOpacity = 0;
          break;
        } else if (dist < burrow.radius) {
          otherOpacity = (dist - burrow.innerRadius) / (burrow.radius - burrow.innerRadius);
          break;
        }
      }
      player.clanNameLabel.element.style.opacity = otherOpacity;
    } else if (player.clanNameLabel) {
      scene.remove(player.clanNameLabel);
      player.clanNameLabel = null;
    }
  });
};

// ============================================
// Функция проверки и обновления роста:
const updateGrowth = (deltaTime) => {
  // Проверяем, достиг ли игрок нового шага очков
  const stepsSinceStart = Math.floor((playerScore - 50) / GROWTH_CONFIG.scoreStep);
  const targetStepScale = 1 + stepsSinceStart * (GROWTH_CONFIG.sizeIncreasePercent / 100);
  const targetCameraScale = cameraBaseScale * (1 + stepsSinceStart * (GROWTH_CONFIG.cameraIncreasePercent / 100));
  
  // Обновляем целевые значения
  targetScale = targetStepScale;
  cameraTargetScale = targetCameraScale;
  
  // Плавно интерполируем текущий масштаб к целевому
  currentScale += (targetScale - currentScale) * deltaTime * 3;
  
  // Применяем масштаб к змейке
  snake.forEach((segment, i) => {
    const baseScale = i === 0 ? 1.22 : 1.02;
    const targetSegScale = baseScale * currentScale;
    // Плавно меняем масштаб сегмента
    segment.scale.x += (targetSegScale - segment.scale.x) * deltaTime * 5;
    segment.scale.y += (targetSegScale * 0.72 - segment.scale.y) * deltaTime * 5; // Чуть сжимаем по Y
    segment.scale.z += (targetSegScale - segment.scale.z) * deltaTime * 5;
  });
  
  // Обновляем камеру
  const targetLeft = -window.innerWidth / cameraTargetScale;
  const targetRight = window.innerWidth / cameraTargetScale;
  const targetTop = window.innerHeight / cameraTargetScale;
  const targetBottom = -window.innerHeight / cameraTargetScale;
  
  // Плавно меняем параметры камеры
  camera.left += (targetLeft - camera.left) * deltaTime * 3;
  camera.right += (targetRight - camera.right) * deltaTime * 3;
  camera.top += (targetTop - camera.top) * deltaTime * 3;
  camera.bottom += (targetBottom - camera.bottom) * deltaTime * 3;
  camera.updateProjectionMatrix();
};
// ============================================

const drawMinimap = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = minimapCanvas.width / dpr;
  const height = minimapCanvas.height / dpr;
  minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  minimapCtx.clearRect(0, 0, width, height);

  const center = width / 2;
  const radius = width / 2 - 7;
  minimapCtx.beginPath();
  minimapCtx.arc(center, center, radius, 0, Math.PI * 2);
  minimapCtx.fillStyle = 'rgba(18, 29, 21, 0.88)';
  minimapCtx.fill();
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.25)';
  minimapCtx.lineWidth = 1;
  minimapCtx.stroke();

  if (!snake.length) return;
  const head = snake[0].position;
  const drawRelativeDot = (x, z, color, size) => {
    const dx = x - head.x;
    const dz = z - head.z;
    const distance = Math.hypot(dx, dz);
    if (distance > MINIMAP_RANGE) return;
    const px = center + (dx / MINIMAP_RANGE) * radius;
    const py = center + (dz / MINIMAP_RANGE) * radius;
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, size, 0, Math.PI * 2);
    minimapCtx.fillStyle = color;
    minimapCtx.fill();
  };

  notes.forEach(note => drawRelativeDot(note.position.x, note.position.z, 'rgba(255,224,122,0.8)', 1.8));
  otherPlayers.forEach(player => {
    if (!player.segments.length) return;
    const dotColor = player.clanId && player.clanId === myClanId ? '#7dd3fc' : `#${player.color.getHexString()}`;
    drawRelativeDot(player.segments[0].position.x, player.segments[0].position.z, dotColor, 3.2);
  });

  minimapCtx.beginPath();
  minimapCtx.arc(center, center, 6, 0, Math.PI * 2);
  minimapCtx.fillStyle = '#ffffff';
  minimapCtx.fill();
  minimapCtx.strokeStyle = '#111';
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();
};

let lastTime = performance.now();
let lastSocketUpdateTime = 0;
const SOCKET_UPDATE_INTERVAL = 1000 / 30; // 30 updates per second

const animate = (time) => {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  updateDayNight(Date.now());
  updateBurrows(time);  // Обновляем пульсацию норок

  if (hasJoinedServer && isGameStarted && !isDead && snake.length) {
    updateSnakeMovement(deltaTime);
    updateGrowth(deltaTime); // Обновляем рост и камеру
    
    // Проверяем, находится ли игрок в норке
    const headPos = snake[0].position;
    const burrowState = checkIfInBurrow(headPos.x, headPos.z);
    
    // Плавно обновляем прозрачность
    const targetOpacity = burrowState.opacity;
    burrowOpacity += (targetOpacity - burrowOpacity) * deltaTime * 8;
    
    // Применяем прозрачность к змейке
    snake.forEach(segment => {
      segment.material.transparent = true;
      segment.material.opacity = burrowOpacity;
    });
    
    // Также скрываем корону и значок головы
    if (localCrown) {
      localCrown.traverse(child => {
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = burrowOpacity;
        }
      });
    }
    if (localHeadBadge) {
      localHeadBadge.material.transparent = true;
      localHeadBadge.material.opacity = burrowOpacity;
    }
    
    // Throttle socket updates
    if (time - lastSocketUpdateTime >= SOCKET_UPDATE_INTERVAL) {
      lastSocketUpdateTime = time;
      socket.emit('update-position', {
        x: headPos.x,
        z: headPos.z,
        score: playerScore,
        segments: snake.map(segment => ({ x: segment.position.x, z: segment.position.z }))
      });
    }
  }

  updateOtherPlayers(deltaTime);
  updateNotes(time, deltaTime);
  updateAttachments(time);
  drawMinimap();

  if (snake.length) {
    camera.position.set(snake[0].position.x, 82, snake[0].position.z);
    camera.lookAt(snake[0].position.x, 0, snake[0].position.z);
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
};

resizeCamera();
resizeMinimap();
createSnake(0, 0);
createGrass();      // Создаем траву
createBurrows();    // Создаем норки
updateLeaderboard();
Promise.all(NOTE_TYPES.map(type => loadTexture(type.texture))).then(() => {
  for (let i = 0; i < 120; i++) spawnNote();
  scheduleNoteSpawn();
});
animate(performance.now());

window.addEventListener('resize', () => {
  resizeCamera();
  resizeMinimap();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});
