let currentLang = 'ru';
let translations = translationsRU;
let currentUser = null;
let selectedColor = '#00ff00';
let selectedHeadUrl = '';
let showAllColors = false;
let socket = io();
let servers = [];
let heads = [];

// ============================================
// ЦВЕТА ДЛЯ ЗМЕЕК - МОЖНО ИЗМЕНИТЬ ИХ ЗДЕСЬ:
const COLORS = [
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#ff8800', '#8800ff', '#00ff88', '#ff0088', '#88ff00', '#0088ff',
  '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
  '#ffaa00', '#aa00ff', '#00ffaa', '#ff00aa', '#aaff00', '#00aaff'
];
// ============================================

function t(key, fallback) {
  return translations[key] || fallback || key;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setPlaceholder(id, value) {
  const el = document.getElementById(id);
  if (el) el.placeholder = value;
}

function getAuthToken() {
  return localStorage.getItem('token') || '';
}

function saveSession(token, user) {
  currentUser = user;
  localStorage.setItem('token', token);
  localStorage.setItem('currentUser', JSON.stringify(user));
}

function restoreSession() {
  try {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user && getAuthToken()) {
      currentUser = user;
      showUserPanel();
    }
  } catch (e) {
    currentUser = null;
  }
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

async function loadHeads() {
  try {
    const res = await fetch('/api/heads');
    heads = res.ok ? await res.json() : [];
  } catch (e) {
    heads = [];
  }
  renderHeadGrid();
}

function initLocalization() {
  updateTranslations();
  initColorGrid();
  initHeadSelection();
  initAuth();
  initUpload();
  initServerCreation();
  initSocketEvents();
  restoreSession();

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
  });

  document.getElementById('toggle-colors').addEventListener('click', () => {
    showAllColors = !showAllColors;
    initColorGrid();
    updateTranslations();
  });

  document.querySelectorAll('input[name="server-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('new-server-password').style.display =
        radio.value === 'private' ? 'block' : 'none';
    });
  });
}

function switchLanguage(lang) {
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.lang-btn[data-lang="${lang}"]`).forEach(b => b.classList.add('active'));
  currentLang = lang;
  translations = currentLang === 'ru' ? translationsRU : translationsEN;
  updateTranslations();
  renderServerList();
  renderHeadGrid();
}

function initSocketEvents() {
  socket.on('servers-update', (serverList) => {
    servers = serverList;
    renderServerList();
  });
  loadServers();
}

function updateTranslations() {
  setText('tab-login', t('login', 'Вход'));
  setText('tab-register', t('register', 'Регистрация'));
  setPlaceholder('login-username', t('enterUsername', 'Введите логин'));
  setPlaceholder('login-password', t('enterPassword', 'Введите пароль'));
  setPlaceholder('register-username', t('createUsername', 'Придумайте логин'));
  setPlaceholder('register-password', t('createPassword', 'Придумайте пароль'));
  // Подсказки
  setText('login-username-hint', t('usernameHint', 'От 3 до 12 символов'));
  setText('login-password-hint', t('passwordHint', 'От 6 до 24 символов'));
  setText('register-username-hint', t('usernameHint', 'От 3 до 12 символов'));
  setText('register-password-hint', t('passwordHint', 'От 6 до 24 символов'));
  
  setText('login-btn', t('loginBtn', 'Войти'));
  setText('register-btn', t('registerBtn', 'Создать аккаунт'));
  setText('server-list-title', t('serverList', 'Список серверов'));
  setText('customization-title', t('selectColor', 'Выберите цвет змейки'));
  setText('head-select-title', t('selectHead', 'Выберите голову'));
  setText('upload-head-btn', t('submitHeadIdea', 'Предложить свою голову'));
  setText('admin-btn', t('adminPanel', 'Админ-панель'));
  setText('toggle-colors', showAllColors
    ? t('hideExtraColors', 'Скрыть цвета')
    : t('showExtraColors', 'Показать все цвета'));
  setText('create-server-title', t('createServer', 'Создать сервер'));
  setPlaceholder('new-server-name', t('serverNamePlaceholder', 'Название сервера'));
  setText('public-label', t('publicServer', 'Публичный'));
  setText('private-label', t('privateServer', 'Приватный'));
  setPlaceholder('new-server-password', t('serverPasswordPlaceholder', '4-значный пароль'));
  setText('create-server-btn', t('create', 'Создать'));
}

function initColorGrid() {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';
  const colorsToShow = showAllColors ? COLORS : COLORS.slice(0, 6);
  colorsToShow.forEach(color => {
    const square = document.createElement('button');
    square.type = 'button';
    square.className = `color-square${color === selectedColor ? ' selected' : ''}`;
    square.style.backgroundColor = color;
    square.title = color;
    square.addEventListener('click', () => {
      document.querySelectorAll('.color-square').forEach(s => s.classList.remove('selected'));
      square.classList.add('selected');
      selectedColor = color;
    });
    grid.appendChild(square);
  });
}

function initHeadSelection() {
  loadHeads();
}

function renderHeadGrid() {
  const grid = document.getElementById('head-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const defaultCard = document.createElement('button');
  defaultCard.type = 'button';
  defaultCard.className = `head-card${selectedHeadUrl === '' ? ' selected' : ''}`;
  defaultCard.innerHTML = `<span>${t('defaultHead', 'Без головы')}</span>`;
  defaultCard.addEventListener('click', () => {
    selectedHeadUrl = '';
    renderHeadGrid();
  });
  grid.appendChild(defaultCard);

  heads.forEach(head => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `head-card${head.url === selectedHeadUrl ? ' selected' : ''}`;
    const img = document.createElement('img');
    img.src = head.url;
    img.alt = head.filename;
    card.appendChild(img);
    card.addEventListener('click', () => {
      selectedHeadUrl = head.url;
      renderHeadGrid();
    });
    grid.appendChild(card);
  });

  if (heads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'head-empty';
    empty.textContent = t('noHeads', 'Пока нет одобренных голов');
    grid.appendChild(empty);
  }
}

function renderServerList() {
  const listEl = document.getElementById('server-list');
  listEl.innerHTML = '';
  if (servers.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('noServers', 'Нет доступных серверов')}</div>`;
    return;
  }

  servers.forEach(server => {
    const serverDiv = document.createElement('div');
    serverDiv.className = 'server-item';
    const typeLabel = server.type === 'public'
      ? t('publicServer', 'Публичный')
      : t('privateServer', 'Приватный');

    const header = document.createElement('div');
    header.className = 'server-header';

    const serverName = document.createElement('strong');
    serverName.textContent = server.name;

    const serverType = document.createElement('span');
    serverType.className = server.type === 'public' ? 'server-type-public' : 'server-type-private';
    serverType.textContent = typeLabel;

    const details = document.createElement('div');
    details.className = 'server-details';
    details.textContent = `${t('players', 'Игроков')}: ${server.players}`;

    header.append(serverName, serverType);
    serverDiv.append(header, details);
    serverDiv.addEventListener('click', () => joinServer(server));
    listEl.appendChild(serverDiv);
  });
}

function initServerCreation() {
  document.getElementById('create-server-btn').addEventListener('click', async () => {
    if (!currentUser || !getAuthToken()) {
      alert(t('loginRequired', 'Сначала войдите в аккаунт!'));
      return;
    }

    const name = document.getElementById('new-server-name').value.trim();
    const type = document.querySelector('input[name="server-type"]:checked').value;
    const password = document.getElementById('new-server-password').value;

    if (!name || name.length < 2) {
      alert(t('serverNameError', 'Название сервера слишком короткое'));
      return;
    }

    if (type === 'private' && (!password || password.length !== 4 || !/^\d+$/.test(password))) {
      alert(t('passwordError', 'Пароль должен быть 4 цифры'));
      return;
    }

    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ name, type, password })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || t('serverCreateFailed', 'Не удалось создать сервер'));
        return;
      }

      document.getElementById('new-server-name').value = '';
      document.getElementById('new-server-password').value = '';
      await loadServers();
    } catch (e) {
      alert(t('serverCreateFailed', 'Не удалось создать сервер'));
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
        alert(data.error || t('invalidCredentials', 'Ошибка входа'));
      }
    } catch (e) {
      alert(t('serverUnavailable', 'Сервер недоступен'));
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
        alert(data.error || t('usernameTaken', 'Ошибка регистрации'));
      }
    } catch (e) {
      alert(t('serverUnavailable', 'Сервер недоступен'));
    }
  });
}

function initUpload() {
  document.getElementById('upload-head-btn').addEventListener('click', () => {
    if (!currentUser || !getAuthToken()) {
      alert(t('loginRequired', 'Сначала войдите в аккаунт!'));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('headSubmission', file);
      try {
        const res = await fetch('/api/upload-head', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAuthToken()}` },
          body: formData
        });
        if (!res.ok) throw new Error('Upload failed');
        alert(t('headSubmitted', 'Заявка отправлена!'));
      } catch (err) {
        alert(t('headSubmitFailed', 'Не удалось отправить заявку'));
      }
    };
    input.click();
  });
}

function showUserPanel() {
  const leftBlock = document.querySelector('.left-block');
  leftBlock.innerHTML = `
    <h2 class="cabinet-title">${t('personalCabinet', 'Личный кабинет')}, ${currentUser.username}!</h2>
    <p class="cabinet-copy">${t('chooseServerHint', 'Выберите сервер справа и начните игру.')}</p>
    <div class="lang-switcher">
      <button class="lang-btn ${currentLang === 'ru' ? 'active' : ''}" data-lang="ru">RU</button>
      <button class="lang-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
    </div>
    ${currentUser.isAdmin ? `
      <button class="admin-btn" onclick="window.location.href='/admin'">
        ${t('adminPanel', 'Админ-панель')}
      </button>
    ` : ''}
    <button class="action-btn logout-btn" id="logout-btn" style="margin-top: 20px;">
      Выйти из аккаунта
    </button>
  `;
  document.getElementById('after-login').style.display = 'block';
  loadServers();
  loadHeads();

  document.querySelectorAll('.left-block .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
  });

  document.getElementById('logout-btn').addEventListener('click', logoutUser);
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  
  // Возвращаем исходный вид лобби (форма входа/регистрации)
  window.location.reload();
}

function joinServer(server) {
  if (!currentUser) {
    alert(t('loginRequired', 'Сначала войдите в аккаунт!'));
    return;
  }

  let password = null;
  if (server.type === 'private') {
    password = prompt(t('enterServerPassword', 'Введите пароль для сервера (4 цифры):'));
    if (!password) return;
  }

  sessionStorage.setItem('sekaiJoin', JSON.stringify({
    serverId: server.id,
    password,
    color: selectedColor,
    headUrl: selectedHeadUrl
  }));

  const query = new URLSearchParams({
    server: String(server.id),
    username: currentUser.username,
    color: selectedColor,
    head: selectedHeadUrl
  });
  window.location.href = `/game?${query.toString()}`;
}

document.addEventListener('DOMContentLoaded', initLocalization);
