// Get URL params
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
const colorParam = urlParams.get('color') || '#00ff00';
const serverId = Number(urlParams.get('server'));
const authToken = localStorage.getItem('token') || '';
const serverPassword = Number(pendingJoin.serverId) === serverId ? pendingJoin.password : null;

// Initialize Socket.io for multiplayer
const socket = io();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2d8a4e);

// Orthographic camera for top-down view - CLOSER!
const camera = new THREE.OrthographicCamera(
  window.innerWidth / -25,
  window.innerWidth / 25,
  window.innerHeight / 25,
  window.innerHeight / -25,
  0.1,
  1000
);
camera.position.set(0, 60, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game-container').appendChild(renderer.domElement);

// Create BIGGER ground plane
const groundSize = 400;
const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x3a8c5e, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Grid helper (BIGGER)
const gridHelper = new THREE.GridHelper(groundSize, 100, 0xffffff, 0x555555);
scene.add(gridHelper);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(0, 60, 0);
scene.add(directionalLight);

// Game state
let playerScore = 50;
const notes = [];
let snake = [];
const snakeColor = new THREE.Color(colorParam);
let isGameStarted = false;
let hasJoinedServer = false;
const moveSpeed = 60; // SLOWER! Units per second
const snakeSegmentDistance = 1.5;

// Player movement
let currentDirection = { x: 0, z: 0 };
let nextDirection = { x: 0, z: 0 };
const keys = {}; // Keys object as per requirements

// Other players state
const otherPlayers = new Map(); // socketId -> { segments[], color, username, targetPos, score }

// Initialize snake
const createSnake = () => {
  snake = [];
  for (let i = 0; i < 5; i++) {
    const geometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 16);
    const material = new THREE.MeshPhongMaterial({ color: snakeColor });
    const segment = new THREE.Mesh(geometry, material);
    segment.position.set(-i * snakeSegmentDistance, 0.5, 0);
    segment.rotation.x = Math.PI / 2;
    scene.add(segment);
    snake.push(segment);
  }
};

// Spawn notes
const spawnNote = () => {
  const geometry = new THREE.SphereGeometry(0.6, 16, 16);
  const material = new THREE.MeshPhongMaterial({ color: 0xffff00 });
  const note = new THREE.Mesh(geometry, material);
  note.position.set((Math.random() - 0.5) * (groundSize - 40), 0.6, (Math.random() - 0.5) * (groundSize - 40));
  scene.add(note);
  notes.push(note);
};
for (let i = 0; i < 40; i++) spawnNote();
setInterval(spawnNote, Math.random() * 9000 + 5000);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

// Leaderboard state
let leaderboard = [];
const updateLeaderboard = () => {
  const leaderboardEl = document.getElementById('leaderboard-list');
  if (!leaderboard.length) {
    leaderboardEl.innerHTML = '<div class="leaderboard-item"><span>...</span><span>0</span></div>';
    return;
  }
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboardEl.innerHTML = leaderboard.map((p, i) => `
    <div class="leaderboard-item">
      <span>${i + 1}. ${escapeHtml(p.username)}</span>
      <span><strong>${Number(p.score) || 0}</strong></span>
    </div>
  `).join('');
};

// Check collisions
const checkCollisions = () => {
  const headPos = snake[0].position;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const dist = Math.sqrt((headPos.x - note.position.x) ** 2 + (headPos.z - note.position.z) ** 2);
    if (dist < 1.8) {
      scene.remove(note);
      notes.splice(i, 1);
      playerScore += 10;
      // Add snake segment
      const tailPos = { x: snake[snake.length - 1].position.x, z: snake[snake.length - 1].position.z };
      const geometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 16);
      const material = new THREE.MeshPhongMaterial({ color: snakeColor });
      const newSegment = new THREE.Mesh(geometry, material);
      newSegment.position.set(tailPos.x, 0.5, tailPos.z);
      newSegment.rotation.x = Math.PI / 2;
      scene.add(newSegment);
      snake.push(newSegment);
      // Update leaderboard
      const playerEntry = leaderboard.find(p => p.username === username);
      if (playerEntry) playerEntry.score = playerScore;
      updateLeaderboard();
      socket.emit('update-score', playerScore);
    }
  }
};

// --- CONTROLS ---

// Toggle chat
const toggleChatBtn = document.getElementById('toggle-chat');
const chatDiv = document.getElementById('chat');
toggleChatBtn.addEventListener('click', () => chatDiv.classList.toggle('hidden'));

const isTextInputFocused = () => {
  const tagName = document.activeElement && document.activeElement.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA';
};

const isMoveKey = (key) => ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);

// Keyboard controls (PC) - HOLD TO MOVE!
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (isMoveKey(key) && !isTextInputFocused()) {
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

// Check keys and set direction
const updateDirectionFromKeys = () => {
  if (joystickActive) return;

  let x = 0;
  let z = 0;
  if (keys['w'] || keys['arrowup']) z -= 1;
  if (keys['s'] || keys['arrowdown']) z += 1;
  if (keys['a'] || keys['arrowleft']) x -= 1;
  if (keys['d'] || keys['arrowright']) x += 1;

  if (x !== 0 && z !== 0) {
    const diagonal = 1 / Math.sqrt(2);
    x *= diagonal;
    z *= diagonal;
  }

  nextDirection = { x, z };
};

// Joystick controls (MOBILE) - untouched!
const joystickContainer = document.getElementById('joystick-container');
const joystickHandle = document.getElementById('joystick-handle');
let joystickActive = false;
let joystickId = null;

const handleJoystickStart = (e) => {
  e.preventDefault();
  joystickActive = true;
  if (!isGameStarted) isGameStarted = true;
  const touch = e.touches ? e.touches[0] : e;
  joystickId = e.touches ? touch.identifier : null;
  updateJoystick(touch);
};
const handleJoystickMove = (e) => {
  e.preventDefault();
  if (!joystickActive) return;
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
const updateJoystick = (touch) => {
  const rect = joystickContainer.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let dx = touch.clientX - centerX;
  let dy = touch.clientY - centerY;
  const maxDist = rect.width / 2 - 30;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
  joystickHandle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  const deadzone = 10;
  if (Math.abs(dx) > deadzone || Math.abs(dy) > deadzone) {
    if (Math.abs(dx) > Math.abs(dy)) {
      nextDirection = dx > 0 ? { x: 1, z: 0 } : { x: -1, z: 0 };
    } else {
      nextDirection = dy > 0 ? { x: 0, z: 1 } : { x: 0, z: -1 };
    }
  } else nextDirection = { x: 0, z: 0 };
};

joystickContainer.addEventListener('touchstart', handleJoystickStart, { passive: false });
joystickContainer.addEventListener('touchmove', handleJoystickMove, { passive: false });
joystickContainer.addEventListener('touchend', handleJoystickEnd, { passive: false });
joystickContainer.addEventListener('touchcancel', handleJoystickEnd, { passive: false });
joystickContainer.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', handleJoystickMove);
document.addEventListener('mouseup', handleJoystickEnd);

// --- CHAT ---
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatMessages = document.getElementById('chat-messages');

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
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') chatSend.click(); });
socket.on('chat-message', (data) => addChatMessage(data.username, data.message));

// --- MULTIPLAYER ---

// Listen for incoming leaderboard
socket.on('update-leaderboard', (playersList) => {
  leaderboard = playersList;
  updateLeaderboard();
});

socket.on('join-success', ({ player }) => {
  hasJoinedServer = true;
  if (player && snake.length > 0) {
    snake.forEach((segment, index) => {
      segment.position.set(player.x - index * snakeSegmentDistance, 0.5, player.z);
    });
  }
  sessionStorage.removeItem('sekaiJoin');
});

socket.on('join-error', (message) => {
  alert(message || 'Could not join server');
  window.location.href = '/';
});

socket.on('disconnect', () => {
  hasJoinedServer = false;
});

// Player joined
socket.on('player-joined', (playerData) => {
  if (playerData.id !== socket.id) {
    createOtherPlayer(playerData);
  }
});

// Player left
socket.on('player-left', (socketId) => {
  removeOtherPlayer(socketId);
});

// Player moved
socket.on('player-moved', (data) => {
  if (data.id === socket.id) return;
  const player = otherPlayers.get(data.id);
  if (player) {
    player.targetPos = { x: data.x, z: data.z };
    if (data.score && data.score !== player.score) {
      player.score = data.score;
      updateOtherPlayerLength(player, data.score);
    }
  }
});

// Initial players on server
socket.on('initial-players', (playersList) => {
  const visiblePlayers = new Set();
  playersList.forEach(p => {
    if (p.id !== socket.id) {
      visiblePlayers.add(p.id);
      createOtherPlayer(p);
    }
  });
  otherPlayers.forEach((_, id) => {
    if (!visiblePlayers.has(id)) removeOtherPlayer(id);
  });
});

// Create other player's snake
const createOtherPlayer = (playerData) => {
  if (!playerData || playerData.id === socket.id) return;
  if (otherPlayers.has(playerData.id)) removeOtherPlayer(playerData.id);

  const segments = [];
  const color = new THREE.Color(playerData.color || '#ff0000');
  const length = 5 + Math.floor(Math.max(0, (playerData.score || 50) - 50) / 10);
  const baseX = playerData.x !== undefined ? playerData.x : 0;
  const baseZ = playerData.z !== undefined ? playerData.z : 0;
  for (let i = 0; i < length; i++) {
    const geometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 16);
    const material = new THREE.MeshPhongMaterial({ color });
    const segment = new THREE.Mesh(geometry, material);
    segment.position.set(baseX - i * snakeSegmentDistance, 0.5, baseZ);
    segment.rotation.x = Math.PI / 2;
    scene.add(segment);
    segments.push(segment);
  }
  otherPlayers.set(playerData.id, {
    segments, color, username: playerData.username, score: playerData.score || 50,
    targetPos: { x: baseX, z: baseZ },
    history: Array.from({ length: length * 8 }, () => ({ x: baseX, z: baseZ }))
  });
};

// Update other player's snake length
const updateOtherPlayerLength = (player, newScore) => {
  const targetLength = 5 + Math.floor(Math.max(0, newScore - 50) / 10);
  while (player.segments.length < targetLength) {
    const tailPos = { x: player.segments[player.segments.length - 1].position.x, z: player.segments[player.segments.length - 1].position.z };
    const geometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 16);
    const material = new THREE.MeshPhongMaterial({ color: player.color });
    const newSegment = new THREE.Mesh(geometry, material);
    newSegment.position.set(tailPos.x, 0.5, tailPos.z);
    newSegment.rotation.x = Math.PI / 2;
    scene.add(newSegment);
    player.segments.push(newSegment);
    player.history.push(tailPos);
  }
};

// Remove other player
const removeOtherPlayer = (socketId) => {
  const player = otherPlayers.get(socketId);
  if (player) {
    player.segments.forEach(s => scene.remove(s));
    otherPlayers.delete(socketId);
  }
};

// Join server after Socket.IO has a real socket id.
socket.on('connect', () => {
  if (!Number.isInteger(serverId) || serverId <= 0 || !authToken || !username) {
    alert('Login and choose a server first');
    window.location.href = '/';
    return;
  }

  socket.emit('join-server', {
    username,
    color: colorParam,
    serverId,
    password: serverPassword,
    token: authToken
  });
});

// --- GAME LOOP ---
let lastTime = performance.now();
const animate = (time) => {
  requestAnimationFrame(animate);
  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  if (hasJoinedServer && isGameStarted) {
    // Update direction from keys (PC)
    updateDirectionFromKeys();

    // Only move if direction is not zero
    if (nextDirection.x !== 0 || nextDirection.z !== 0) {
      currentDirection = { ...nextDirection };
      // Move head
      snake[0].position.x += currentDirection.x * moveSpeed * deltaTime;
      snake[0].position.z += currentDirection.z * moveSpeed * deltaTime;

      // Wrap around boundaries
      const halfGround = groundSize / 2;
      if (snake[0].position.x > halfGround) snake[0].position.x = -halfGround;
      if (snake[0].position.x < -halfGround) snake[0].position.x = halfGround;
      if (snake[0].position.z > halfGround) snake[0].position.z = -halfGround;
      if (snake[0].position.z < -halfGround) snake[0].position.z = halfGround;

      // Move body segments smoothly
      for (let i = 1; i < snake.length; i++) {
        const targetX = snake[i - 1].position.x - currentDirection.x * snakeSegmentDistance;
        const targetZ = snake[i - 1].position.z - currentDirection.z * snakeSegmentDistance;
        snake[i].position.x += (targetX - snake[i].position.x) * 15 * deltaTime;
        snake[i].position.z += (targetZ - snake[i].position.z) * 15 * deltaTime;
      }

      checkCollisions();
      // Send our position to server
      socket.emit('update-position', { x: snake[0].position.x, z: snake[0].position.z, score: playerScore });
    }
  }

  // Move other players smoothly
  otherPlayers.forEach((player, id) => {
    if (player.targetPos) {
      // Move head
      player.segments[0].position.x += (player.targetPos.x - player.segments[0].position.x) * 8 * deltaTime;
      player.segments[0].position.z += (player.targetPos.z - player.segments[0].position.z) * 8 * deltaTime;

      player.history.unshift({
        x: player.segments[0].position.x,
        z: player.segments[0].position.z
      });
      player.history.length = Math.min(player.history.length, player.segments.length * 8);

      // Move body
      for (let i = 1; i < player.segments.length; i++) {
        const follow = player.history[Math.min(i * 6, player.history.length - 1)];
        if (follow) {
          player.segments[i].position.x += (follow.x - player.segments[i].position.x) * 10 * deltaTime;
          player.segments[i].position.z += (follow.z - player.segments[i].position.z) * 10 * deltaTime;
        }
      }
    }
  });

  // Camera follows snake head (top-down) - CLOSER!
  if (snake.length > 0) {
    camera.position.set(snake[0].position.x, 60, snake[0].position.z);
    camera.lookAt(snake[0].position.x, 0, snake[0].position.z);
  }

  renderer.render(scene, camera);
};

createSnake();
updateLeaderboard();
animate(0);

window.addEventListener('resize', () => {
  camera.left = window.innerWidth / -25;
  camera.right = window.innerWidth / 25;
  camera.top = window.innerHeight / 25;
  camera.bottom = window.innerHeight / -25;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
