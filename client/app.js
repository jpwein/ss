let currentLang = 'ru';
let translations = translationsRU;
let currentUser = null;
let selectedColor = '#00ff00';
let showAllColors = false;
let socket = io();
let servers = [];

function getAuthToken() {
  return localStorage.getItem('token') || '';
}

function saveSession(token, user) {
  currentUser = user;
  localStorage.setItem('token', token);
  localStorage.setItem('currentUser', JSON.stringify(user));
}

async function loadServers() {
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) return;
    servers = await res.json();
    renderServerList();
  } catch (e) {
    renderServerList();
  }
}

const COLORS = [
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#ff8800', '#8800ff', '#00ff88', '#ff0088', '#88ff00', '#0088ff',
  '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
  '#ffaa00', '#aa00ff', '#00ffaa', '#ff00aa', '#aaff00', '#00aaff'
];

function initLocalization() {
  updateTranslations();
  initColorGrid();
  initAuth();
  initUpload();
  initServerCreation();
  initSocketEvents();
  
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLang = btn.dataset.lang;
      translations = currentLang === 'ru' ? translationsRU : translationsEN;
      updateTranslations();
    });
  });
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Toggle colors button
  document.getElementById('toggle-colors').addEventListener('click', () => {
    showAllColors = !showAllColors;
    initColorGrid();
    document.getElementById('toggle-colors').textContent = showAllColors 
      ? (translations.hideExtraColors || 'Скрыть цвета') 
      : (translations.showExtraColors || 'Показать все цвета');
  });

  // Password input visibility
  document.querySelectorAll('input[name="server-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('new-server-password').style.display = 
        radio.value === 'private' ? 'block' : 'none';
    });
  });
}

function initSocketEvents() {
  socket.on('servers-update', (serverList) => {
    servers = serverList;
    renderServerList();
  });
  loadServers();
}

function updateTranslations() {
  document.getElementById('tab-login').textContent = translations.login;
  document.getElementById('tab-register').textContent = translations.register;
  document.getElementById('login-username').placeholder = translations.enterUsername;
  document.getElementById('login-password').placeholder = translations.enterPassword;
  document.getElementById('register-username').placeholder = translations.createUsername;
  document.getElementById('register-password').placeholder = translations.createPassword;
  document.getElementById('login-btn').textContent = translations.loginBtn;
  document.getElementById('register-btn').textContent = translations.registerBtn;
  document.getElementById('server-list-title').textContent = translations.serverList;
  document.getElementById('customization-title').textContent = translations.selectColor;
  document.getElementById('upload-head-btn').textContent = translations.submitHeadIdea;
  document.getElementById('admin-btn').textContent = translations.adminPanel;
  document.getElementById('toggle-colors').textContent = showAllColors 
      ? (translations.hideExtraColors || 'Скрыть цвета') 
      : (translations.showExtraColors || 'Показать все цвета');
  document.getElementById('create-server-title').textContent = translations.createServer || 'Создать сервер';
  document.getElementById('new-server-name').placeholder = translations.serverNamePlaceholder || 'Название сервера';
  document.getElementById('public-label').textContent = translations.publicServer || 'Публичный';
  document.getElementById('private-label').textContent = translations.privateServer || 'Приватный';
  document.getElementById('new-server-password').placeholder = translations.serverPasswordPlaceholder || '4-хзначный пароль';
  document.getElementById('create-server-btn').textContent = translations.create || 'Создать';
}

function initColorGrid() {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';
  const colorsToShow = showAllColors ? COLORS : COLORS.slice(0, 6);
  colorsToShow.forEach((color, index) => {
    const square = document.createElement('div');
    square.className = 'color-square' + (color === selectedColor ? ' selected' : '');
    square.style.backgroundColor = color;
    square.addEventListener('click', () => {
      document.querySelectorAll('.color-square').forEach(s => s.classList.remove('selected'));
      square.classList.add('selected');
      selectedColor = color;
    });
    grid.appendChild(square);
  });
}

function renderServerList() {
  const listEl = document.getElementById('server-list');
  listEl.innerHTML = '';
  if (servers.length === 0) {
    listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: #666;">${translations.noServers || 'Нет доступных серверов'}</div>`;
    return;
  }
  servers.forEach(server => {
    const serverDiv = document.createElement('div');
    serverDiv.className = 'server-item';
    const typeLabel = server.type === 'public' 
      ? (translations.publicServer || 'Публичный') 
      : (translations.privateServer || 'Приватный');
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';

    const serverName = document.createElement('strong');
    serverName.textContent = server.name;

    const serverType = document.createElement('span');
    serverType.style.color = server.type === 'public' ? '#2d8a4e' : '#ff8800';
    serverType.textContent = typeLabel;

    const details = document.createElement('div');
    details.style.fontSize = '12px';
    details.style.color = '#666';
    details.style.marginTop = '5px';
    details.textContent = `${translations.players || 'Игроков'}: ${server.players}`;

    header.append(serverName, serverType);
    serverDiv.append(header, details);
    serverDiv.addEventListener('click', () => joinServer(server));
    listEl.appendChild(serverDiv);
  });
}

function initServerCreation() {
  document.getElementById('create-server-btn').addEventListener('click', async () => {
    if (!currentUser || !getAuthToken()) {
      alert(translations.loginRequired || 'Сначала войдите в аккаунт!');
      return;
    }

    const name = document.getElementById('new-server-name').value.trim();
    const type = document.querySelector('input[name="server-type"]:checked').value;
    const password = document.getElementById('new-server-password').value;
    
    if (!name || name.length < 2) {
      alert(translations.serverNameError || 'Название сервера слишком короткое');
      return;
    }
    
    if (type === 'private' && (!password || password.length !== 4 || !/^\d+$/.test(password))) {
      alert(translations.passwordError || 'Пароль должен быть 4 цифры');
      return;
    }
    
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ name, type, password })
      });
      
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Ошибка создания');
        return;
      }
      
      // Clear inputs
      document.getElementById('new-server-name').value = '';
      document.getElementById('new-server-password').value = '';
      await loadServers();
      
    } catch (e) {
      alert(translations.serverCreateFailed || 'Не удалось создать сервер');
    }
  });
}

function initAuth() {
  document.getElementById('login-btn').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        saveSession(data.token, data.user);
        showUserPanel();
      } else {
        alert(data.error || translations.invalidCredentials || 'Ошибка входа');
      }
    } catch (e) {
      alert(translations.serverUnavailable || 'Сервер недоступен');
    }
  });

  document.getElementById('register-btn').addEventListener('click', async () => {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        saveSession(data.token, data.user);
        showUserPanel();
      } else {
        alert(data.error || translations.usernameTaken || 'Ошибка регистрации');
      }
    } catch (e) {
      alert(translations.serverUnavailable || 'Сервер недоступен');
    }
  });
}

function initUpload() {
  document.getElementById('upload-head-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const formData = new FormData();
        formData.append('headSubmission', file);
        try {
          await fetch('/api/upload-head', {
            method: 'POST',
            body: formData
          });
          alert('Заявка отправлена!');
        } catch (err) {
          alert('Заявка отправлена (демо)!');
        }
      }
    };
    input.click();
  });
}

function showUserPanel() {
  const leftBlock = document.querySelector('.left-block');
  leftBlock.innerHTML = `
    <h2 style="margin-bottom: 20px; word-wrap: break-word;">${translations.personalCabinet || 'Личный кабинет'}, ${currentUser.username}!</h2>
    <p style="margin-bottom: 10px;">Выберите сервер справа и начните игру!</p>
    <div class="lang-switcher" style="margin-top: 20px;">
      <button class="lang-btn ${currentLang === 'ru' ? 'active' : ''}" data-lang="ru">RU</button>
      <button class="lang-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
    </div>
    ${currentUser.isAdmin ? `
      <button class="admin-btn" style="margin-top: 20px; width: 100%;" onclick="window.location.href='/admin'">
        ${translations.adminPanel || 'Админ-панель'}
      </button>
    ` : ''}
  `;
  document.getElementById('after-login').style.display = 'block';
  loadServers();
  
  document.querySelectorAll('.left-block .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLang = btn.dataset.lang;
      translations = currentLang === 'ru' ? translationsRU : translationsEN;
      updateTranslations();
    });
  });
}

function joinServer(server) {
  if (!currentUser) {
    alert(translations.loginRequired || 'Сначала войдите в аккаунт!');
    return;
  }
  
  let password = null;
  if (server.type === 'private') {
    password = prompt(translations.enterServerPassword || 'Введите пароль для сервера (4 цифры):');
    if (!password) return;
  }
  
  sessionStorage.setItem('sekaiJoin', JSON.stringify({
    serverId: server.id,
    password,
    color: selectedColor
  }));
  window.location.href = `/game?server=${encodeURIComponent(server.id)}&username=${encodeURIComponent(currentUser.username)}&color=${encodeURIComponent(selectedColor)}`;
}

document.addEventListener('DOMContentLoaded', initLocalization);
