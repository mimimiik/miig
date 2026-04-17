// app.js — MIM Galaxy Ultimate
import * as webllm from '@mlc-ai/web-llm';

// ---------- БАЗА ДАННЫХ ----------
let db;
const DB_NAME = 'mimGalaxyUltimate';
const request = indexedDB.open(DB_NAME, 12);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'chatId' });
  if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'username' });
  if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('channels')) db.createObjectStore('channels', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'chatId' });
  if (!db.objectStoreNames.contains('blacklist')) db.createObjectStore('blacklist', { keyPath: 'username' });
};
request.onsuccess = (e) => { db = e.target.result; initApp(); };

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
window.socket = io();
window.currentUser = null;
window.currentChat = null;
window.chats = [
  { id: 'ai', name: 'MIM Ассистент', avatar: '🤖', type: 'ai', lastMsg: 'Привет!', time: '10:00' },
  { id: 'friend1', name: 'Анна', avatar: 'А', type: 'user', lastMsg: 'Привет! Как дела?', time: '14:20' },
  { id: 'friend2', name: 'Кирилл', avatar: 'К', type: 'user', lastMsg: '🐾 Стикер', time: '27 мар' }
];
window.contacts = [
  { id: 'friend1', name: 'Анна', avatar: 'А', online: true },
  { id: 'friend2', name: 'Кирилл', avatar: 'К', online: false }
];
window.ringtones = ['ringtone1.mp3', 'ringtone2.mp3', 'ringtone3.mp3'];
window.messageSounds = ['message1.mp3', 'message2.mp3'];
window.selectedRingtone = ringtones[0];
window.selectedMessageSound = messageSounds[0];
let currentTab = 'chats';
let llmEngine = null, llmReady = false;
let pendingFiles = [];
let editingMessageId = null;
let replyingTo = null;
let localStream, peerConnection;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let currentLanguage = 'ru';
let lockEnabled = false;
let lockPIN = null;

// Service Worker (PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.warn);
}

// ---------- СОКЕТЫ ----------
socket.on('onlineUpdate', ({ username, online }) => {
  const contact = contacts.find(c => c.id === username);
  if (contact) contact.online = online;
  if (currentTab === 'contacts') renderContacts();
});
socket.on('onlineList', (users) => {
  contacts.forEach(c => c.online = users.includes(c.id));
  if (currentTab === 'contacts') renderContacts();
});
socket.on('newMessage', ({ chatId, message }) => {
  if (currentChat === chatId) {
    const cont = document.getElementById('msgContainer');
    if (cont) {
      const msgEl = createMessageElement(message);
      cont.appendChild(msgEl);
      cont.scrollTop = cont.scrollHeight;
    }
  }
  updateChatLastMessage(chatId, message);
});
socket.on('messageEdited', ({ chatId, messageId, newText }) => {
  if (currentChat === chatId) {
    const msgEl = document.querySelector(`.message-bubble[data-id="${messageId}"]`);
    if (msgEl) msgEl.innerHTML = `${newText}<div class="message-time">${new Date().toLocaleTimeString().slice(0,5)} (изм.)</div>`;
  }
});
socket.on('messageDeleted', ({ chatId, messageId }) => {
  if (currentChat === chatId) document.querySelector(`.message-row[data-id="${messageId}"]`)?.remove();
});
socket.on('reactionAdded', ({ chatId, messageId, reaction, user }) => {
  if (currentChat === chatId) {
    const reactDiv = document.querySelector(`.message-row[data-id="${messageId}"] .reactions`);
    if (reactDiv) {
      const span = document.createElement('span');
      span.className = 'reaction';
      span.dataset.reaction = reaction;
      span.innerHTML = `${reaction} ${user}`;
      span.onclick = () => addReaction(messageId, reaction);
      reactDiv.appendChild(span);
    }
  }
});
socket.on('incomingCall', async ({ from, signal, video }) => {
  if (confirm(`Входящий ${video?'видео':''}звонок от ${from}. Принять?`)) {
    await setupCall(from, video, signal);
  }
});
socket.on('callAccepted', async (signal) => { if (peerConnection) await peerConnection.setRemoteDescription(signal); });
socket.on('iceCandidate', async (candidate) => { if (peerConnection) await peerConnection.addIceCandidate(candidate); });

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
function initApp() {
  loadSettings();
  const tx = db.transaction('settings', 'readonly');
  tx.objectStore('settings').get('currentUser').onsuccess = (e) => {
    if (e.target.result) {
      window.currentUser = e.target.result.value;
      socket.emit('register', currentUser);
      showScreen('mainScreen');
      switchTab('chats');
      setTimeout(() => openChat('ai'), 50);
    } else {
      document.getElementById('splashScreen').classList.remove('active');
      showScreen('authScreen');
    }
  };
  startSplash();
  applyLanguage();
}

function startSplash() {
  const canvas = document.getElementById('splashCanvas');
  const ctx = canvas.getContext('2d');
  let w, h;
  function resize() { w = canvas.width = canvas.clientWidth; h = canvas.height = canvas.clientHeight; }
  window.addEventListener('resize', resize); resize();
  let progress = 0;
  const fill = document.getElementById('progressFill');
  const timer = setInterval(() => {
    progress += 2; fill.style.width = progress + '%';
    if (progress >= 100) {
      clearInterval(timer);
      if (!currentUser) {
        document.getElementById('splashScreen').classList.remove('active');
        showScreen('authScreen');
      }
    }
  }, 30);
  function draw() {
    if (!document.getElementById('splashScreen')?.classList.contains('active')) return;
    ctx.clearRect(0,0,w,h);
    const grad = ctx.createRadialGradient(w*0.3, h*0.4, 50, w*0.7, h*0.6, 300);
    grad.addColorStop(0,'#8B5CF6'); grad.addColorStop(0.5,'#F97316'); grad.addColorStop(1,'#0EA5E9');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    requestAnimationFrame(draw);
  }
  draw();
}

function loadSettings() {
  const tx = db.transaction('settings', 'readonly');
  tx.objectStore('settings').get('theme').onsuccess = (e) => {
    if (e.target.result) document.documentElement.setAttribute('data-theme', e.target.result.value);
  };
  tx.objectStore('settings').get('accent').onsuccess = (e) => {
    if (e.target.result) document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${e.target.result.value} 0%, #6D28D9 100%)`);
  };
  tx.objectStore('settings').get('fontSize').onsuccess = (e) => {
    if (e.target.result) document.body.style.fontSize = e.target.result.value + 'px';
  };
}

window.showScreen = (id) => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
};

// ---------- АВТОРИЗАЦИЯ ----------
window.switchAuthTab = (tab) => {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  if (tab === 'login') {
    document.querySelector('.auth-tab:first-child').classList.add('active');
    document.getElementById('loginForm').classList.add('active');
  } else {
    document.querySelector('.auth-tab:last-child').classList.add('active');
    document.getElementById('registerForm').classList.add('active');
  }
};

window.register = async () => {
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const c = document.getElementById('regConfirm').value;
  if (!u || !p) return alert('Заполните все поля');
  if (p !== c) return alert('Пароли не совпадают');
  if (p.length < 6) return alert('Пароль минимум 6 символов');
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (data.success) {
    alert('Регистрация успешна! Войдите.');
    switchAuthTab('login');
    document.getElementById('loginUsername').value = u;
  } else alert(data.error);
};

window.login = async () => {
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  if (!u || !p) return alert('Введите логин и пароль');
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (data.success) {
    window.currentUser = u;
    saveSetting('currentUser', u);
    socket.emit('register', u);
    showScreen('mainScreen');
    switchTab('chats');
    setTimeout(() => openChat('ai'), 50);
  } else alert(data.error);
};

window.logout = () => {
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').delete('currentUser');
  tx.oncomplete = () => location.reload();
};

function saveSetting(key, value) {
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
}

// ---------- ВКЛАДКИ ----------
window.switchTab = (tab) => {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  const cont = document.getElementById('tabContent');
  if (tab === 'chats') renderChatsContent(cont);
  else if (tab === 'contacts') renderContactsContent(cont);
  else if (tab === 'tools') renderToolsContent(cont);
};

function renderChatsContent(cont) {
  cont.innerHTML = `
    <div class="content-header">
      <div class="avatar" style="width:40px;height:40px;" onclick="openProfile()">😎</div>
      <h2 data-i18n="chats">Чаты</h2>
      <i class="fas fa-search" onclick="searchMessages()"></i>
      <i class="fas fa-cog" onclick="openSettings()"></i>
    </div>
    <div class="list-container" id="chatList"></div>
    <div class="fab" onclick="createGroup()"><i class="fas fa-users"></i></div>
  `;
  renderChats();
}
function renderChats() {
  const list = document.getElementById('chatList');
  if (list) list.innerHTML = chats.map(c => `
    <div class="list-item" onclick="openChat('${c.id}')" oncontextmenu="showChatMenu(event,'${c.id}')">
      <div class="avatar" style="background:${c.type==='ai'?'var(--primary-gradient)':'var(--secondary-gradient)'}">${c.avatar}</div>
      <div style="flex:1"><strong>${c.name}</strong><p>${c.lastMsg}</p></div>
      <span>${c.time}</span>
    </div>
  `).join('');
}
function renderContactsContent(cont) {
  cont.innerHTML = `
    <div class="content-header"><h2 data-i18n="contacts">Контакты</h2><i class="fas fa-user-plus" onclick="addContact()"></i><i class="fas fa-search" onclick="searchContacts()"></i></div>
    <div class="list-container" id="contactsList"></div>
  `;
  renderContacts();
}
function renderContacts() {
  const list = document.getElementById('contactsList');
  if (list) list.innerHTML = contacts.map(c => `
    <div class="list-item" onclick="openChat('${c.id}')">
      <div class="avatar">${c.avatar}</div>
      <div><strong>${c.name}</strong><br>${c.online ? 'онлайн' : 'офлайн'}</div>
      ${c.online ? '<span style="color:#10b981;">●</span>' : ''}
    </div>
  `).join('');
}
function renderToolsContent(cont) {
  cont.innerHTML = `
    <div class="content-header"><h2 data-i18n="tools">Инструменты</h2></div>
    <div class="tools-grid">
      <div class="tool-card" onclick="openNotes()"><i class="fas fa-sticky-note"></i><br>Заметки</div>
      <div class="tool-card" onclick="openPaint()"><i class="fas fa-paint-brush"></i><br>Paint</div>
      <div class="tool-card" onclick="openMedia()"><i class="fas fa-photo-video"></i><br>Медиа</div>
      <div class="tool-card" onclick="makeCall(false)"><i class="fas fa-phone-alt"></i><br>Аудиозвонок</div>
      <div class="tool-card" onclick="makeCall(true)"><i class="fas fa-video"></i><br>Видеозвонок</div>
      <div class="tool-card" onclick="startVideoCircle()"><i class="fas fa-circle"></i><br>Кружок</div>
    </div>
  `;
}

// ---------- ЧАТЫ ----------
window.openChat = (id) => {
  currentChat = id;
  socket.emit('joinChat', id);
  const chat = chats.find(c=>c.id===id);
  const cont = document.getElementById('tabContent');
  cont.innerHTML = `
    <div class="content-header">
      <i class="fas fa-arrow-left" onclick="switchTab('chats')"></i>
      <div class="avatar" style="width:40px;height:40px;">${chat.avatar}</div>
      <h3>${chat.name}</h3>
      <i class="fas fa-phone" onclick="makeCall(false,'${id}')"></i>
      <i class="fas fa-video" onclick="makeCall(true,'${id}')"></i>
      <i class="fas fa-search" onclick="searchInChat()"></i>
    </div>
    <div class="messages-container" id="msgContainer"></div>
    ${replyingTo ? `<div class="reply-bar">Ответ на сообщение <i class="fas fa-times" onclick="cancelReply()"></i></div>` : ''}
    <div class="message-input-area" style="padding:12px; display:flex; gap:8px;">
      <i class="fas fa-paperclip" onclick="attachFile()"></i>
      <input id="msgInput" placeholder="Сообщение...">
      <i class="fas fa-microphone" onclick="startVoiceRecord()"></i>
      <i class="fas fa-smile" onclick="openEmojiPicker()"></i>
      <button class="btn" style="width:50px; margin:0;" onclick="sendMessage()"><i class="fas fa-paper-plane"></i></button>
    </div>
  `;
  loadMessages(id);
};

function loadMessages(chatId) {
  fetch(`/api/chat/${chatId}`).then(r=>r.json()).then(data => {
    const cont = document.getElementById('msgContainer');
    cont.innerHTML = data.messages.map(m => createMessageElement(m).outerHTML).join('');
    cont.scrollTop = cont.scrollHeight;
  });
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = `message-row ${msg.sender === currentUser ? 'my' : ''}`;
  div.dataset.id = msg.id || Date.now();
  let content = '';
  if (msg.text) content = msg.text;
  else if (msg.file) content = `<a href="${msg.file}" target="_blank">📎 ${msg.fileName||'Файл'}</a>`;
  else if (msg.voice) content = `<audio controls src="${msg.voice}"></audio>`;
  else if (msg.video) content = `<video controls src="${msg.video}" style="max-width:100%; border-radius:16px;"></video>`;
  div.innerHTML = `
    <div class="message-bubble" data-id="${msg.id}" oncontextmenu="showMessageMenu(event,'${msg.id}','${msg.sender}')">
      ${content}
      <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString().slice(0,5)}</div>
      <div class="reactions">${(msg.reactions||[]).map(r => `<span class="reaction" data-reaction="${r.emoji}" onclick="addReaction('${msg.id}','${r.emoji}')">${r.emoji} ${r.user}</span>`).join('')}</div>
    </div>
  `;
  return div;
}

window.sendMessage = () => {
  const inp = document.getElementById('msgInput');
  const text = inp.value.trim();
  if (!text && !pendingFiles.length) return;
  const message = {
    id: Date.now() + Math.random().toString(36),
    sender: currentUser,
    timestamp: Date.now(),
    text: text || '',
    files: [...pendingFiles],
    replyTo: replyingTo
  };
  if (editingMessageId) {
    socket.emit('editMessage', { chatId: currentChat, messageId: editingMessageId, newText: text });
    editingMessageId = null;
  } else {
    socket.emit('sendMessage', { chatId: currentChat, message });
  }
  inp.value = '';
  pendingFiles = [];
  replyingTo = null;
  cancelReply();
};

window.attachFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = (e) => {
    for (let file of input.files) {
      if (file.name.endsWith('.apk') && !confirm('⚠️ APK-файл. Отправить?')) continue;
      const reader = new FileReader();
      reader.onload = (ev) => pendingFiles.push({ name: file.name, data: ev.target.result });
      reader.readAsDataURL(file);
    }
  };
  input.click();
};

window.startVoiceRecord = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = RecordRTC(stream, { type: 'audio' });
  recorder.startRecording();
  alert('Запись... ОК для остановки');
  setTimeout(() => {
    recorder.stopRecording(() => {
      const blob = recorder.getBlob();
      const url = URL.createObjectURL(blob);
      pendingFiles.push({ voice: true, data: url });
      alert('Голосовое готово');
    });
  }, 3000);
};

window.startVideoCircle = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const recorder = RecordRTC(stream, { type: 'video' });
  recorder.startRecording();
  alert('Запись кружка... ОК для остановки');
  setTimeout(() => {
    recorder.stopRecording(() => {
      const blob = recorder.getBlob();
      const url = URL.createObjectURL(blob);
      pendingFiles.push({ video: true, data: url });
    });
  }, 3000);
};

window.showMessageMenu = (e, msgId, sender) => {
  e.preventDefault();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = e.clientY + 'px';
  menu.style.left = e.clientX + 'px';
  menu.innerHTML = `
    <div onclick="replyTo('${msgId}')"><i class="fas fa-reply"></i> Ответить</div>
    ${sender === currentUser ? '<div onclick="editMessage(\''+msgId+'\')"><i class="fas fa-edit"></i> Изменить</div>' : ''}
    <div onclick="deleteMessage('${msgId}','${sender}')"><i class="fas fa-trash"></i> Удалить</div>
    <div onclick="forwardMessage('${msgId}')"><i class="fas fa-share"></i> Переслать</div>
    <div onclick="copyMessage('${msgId}')"><i class="fas fa-copy"></i> Копировать</div>
  `;
  document.body.appendChild(menu);
  setTimeout(() => menu.remove(), 3000);
};

window.replyTo = (msgId) => { replyingTo = msgId; openChat(currentChat); };
window.editMessage = (msgId) => {
  const msg = document.querySelector(`.message-bubble[data-id="${msgId}"]`);
  if (msg) {
    document.getElementById('msgInput').value = msg.innerText.split('\n')[0];
    editingMessageId = msgId;
  }
};
window.deleteMessage = (msgId, sender) => {
  if (sender !== currentUser && !confirm('Удалить сообщение?')) return;
  socket.emit('deleteMessage', { chatId: currentChat, messageId: msgId, forEveryone: sender === currentUser });
};
window.addReaction = (msgId, emoji) => {
  socket.emit('addReaction', { chatId: currentChat, messageId: msgId, reaction: emoji, user: currentUser });
};
window.cancelReply = () => { replyingTo = null; openChat(currentChat); };

// ---------- ЗВОНКИ ----------
window.makeCall = async (video, targetUser = null) => {
  if (!targetUser) targetUser = prompt('Имя пользователя');
  if (!targetUser) return;
  await setupCall(targetUser, video);
};

async function setupCall(targetUser, video, incomingSignal = null) {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  peerConnection = new RTCPeerConnection(configuration);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.onicecandidate = (e) => {
    if (e.candidate) socket.emit('iceCandidate', { to: targetUser, candidate: e.candidate });
  };
  peerConnection.ontrack = (e) => {
    const remoteVideo = document.createElement('video');
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.style.width = '100%';
    document.body.appendChild(remoteVideo);
  };
  if (incomingSignal) {
    await peerConnection.setRemoteDescription(incomingSignal);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answerCall', { to: targetUser, signal: answer });
  } else {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('callUser', { to: targetUser, signal: offer, video });
  }
}

// ---------- НАСТРОЙКИ ----------
window.openSettings = () => {
  document.getElementById('panelTitle').innerText = 'Настройки';
  document.getElementById('panelContent').innerHTML = `
    <div class="settings-grid">
      <div class="settings-tile" onclick="openCategory('appearance')"><i class="fas fa-palette"></i><span>Внешний вид</span></div>
      <div class="settings-tile" onclick="openCategory('notifications')"><i class="fas fa-bell"></i><span>Уведомления</span></div>
      <div class="settings-tile" onclick="openCategory('privacy')"><i class="fas fa-shield-alt"></i><span>Безопасность</span></div>
      <div class="settings-tile" onclick="openCategory('chats')"><i class="fas fa-comments"></i><span>Чаты</span></div>
      <div class="settings-tile" onclick="openCategory('media')"><i class="fas fa-photo-video"></i><span>Медиа</span></div>
      <div class="settings-tile" onclick="openCategory('account')"><i class="fas fa-user-circle"></i><span>Аккаунт</span></div>
    </div>
    <input type="text" placeholder="Поиск в настройках..." oninput="searchSettings(this.value)" style="width:100%;padding:12px;border-radius:30px;border:1px solid var(--border-light);margin:16px 0;">
    <div class="lang-switch">
      <div class="lang-btn active" onclick="setLanguage('ru')">🇷🇺 Русский</div>
      <div class="lang-btn" onclick="setLanguage('en')">🇬🇧 English</div>
    </div>
    <button class="btn" onclick="logout()">Выйти</button>
  `;
  document.getElementById('slidePanel').classList.add('active');
};

window.openCategory = (cat) => {
  let html = '';
  if (cat === 'appearance') {
    html = `<h3>Тема</h3><select id="themeSelect" onchange="setTheme(this.value)"><option>light</option><option>dark</option></select>
            <h3>Акцент</h3><div>${['#8B5CF6','#F97316','#0EA5E9'].map(c => `<div class="color-dot" style="background:${c}" onclick="setAccent('${c}')"></div>`).join('')}</div>
            <h3>Размер шрифта</h3><input type="range" min="14" max="22" onchange="document.body.style.fontSize=this.value+'px'; saveSetting('fontSize',this.value)">
            <h3>Фон чата</h3><input type="file" accept="image/*,video/*" onchange="setChatBg(this.files[0])">`;
  } else if (cat === 'notifications') {
    html = `<h3>Звук сообщений</h3><select>${messageSounds.map(s=>`<option>${s}</option>`).join('')}</select>
            <h3>Рингтон</h3><select>${ringtones.map(r=>`<option>${r}</option>`).join('')}</select>
            <h3>Вибрация</h3><label class="switch"><input type="checkbox"><span class="slider"></span></label>`;
  } else html = `<p>Настройки "${cat}" в разработке.</p>`;
  html += `<button class="btn" onclick="openSettings()">Назад</button>`;
  document.getElementById('panelContent').innerHTML = html;
};

window.setTheme = (t) => { document.documentElement.setAttribute('data-theme', t); saveSetting('theme', t); };
window.setAccent = (c) => { document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${c} 0%, #6D28D9 100%)`); saveSetting('accent', c); };
window.closeSlidePanel = () => document.getElementById('slidePanel').classList.remove('active');
window.setLanguage = (lang) => { currentLanguage = lang; applyLanguage(); saveSetting('language', lang); };
function applyLanguage() { /* базовая локализация */ }

// ---------- ПРОФИЛЬ ----------
window.openProfile = () => {
  document.getElementById('panelTitle').innerText = 'Профиль';
  document.getElementById('panelContent').innerHTML = `
    <div style="text-align:center;">
      <div class="avatar" style="width:100px;height:100px;margin:20px auto;">😎</div>
      <h2>${currentUser}</h2>
      <button class="btn" onclick="editProfile()">Редактировать</button>
      <button class="btn" style="background:#FF0000;" onclick="window.open('https://youtube.com/@MIDBED')"><i class="fab fa-youtube"></i> MIDBED</button>
      <button class="btn" onclick="showQR()">QR-код</button>
      <button class="btn" onclick="closeSlidePanel()">Закрыть</button>
    </div>`;
  document.getElementById('slidePanel').classList.add('active');
};

window.showQR = () => {
  document.getElementById('qrOverlay').classList.add('active');
  document.getElementById('qrModal').classList.add('active');
  new QRCode(document.getElementById('qrcode'), { text: `https://mim.space/@${currentUser}`, width: 200, height: 200 });
};
window.closeQR = () => {
  document.getElementById('qrOverlay').classList.remove('active');
  document.getElementById('qrModal').classList.remove('active');
  document.getElementById('qrcode').innerHTML = '';
};

// ---------- ИНСТРУМЕНТЫ ----------
window.openNotes = () => {
  const cont = document.getElementById('tabContent');
  cont.innerHTML = `<div class="content-header"><i class="fas fa-arrow-left" onclick="switchTab('tools')"></i><h2>Заметки</h2><i class="fas fa-plus" onclick="addNote()"></i></div><div class="list-container" id="notesList"></div>`;
  loadNotes();
};
function loadNotes() {
  const tx = db.transaction('notes','readonly');
  tx.objectStore('notes').getAll().onsuccess = (e) => {
    document.getElementById('notesList').innerHTML = e.target.result.map(n => `<div class="list-item" onclick="editNote(${n.id})"><strong>${n.title}</strong><br>${n.content}</div>`).join('');
  };
}
window.addNote = () => {
  const title = prompt('Название'), content = prompt('Текст');
  if (title && content) {
    const tx = db.transaction('notes','readwrite');
    tx.objectStore('notes').add({ title, content });
    tx.oncomplete = loadNotes;
  }
};
window.editNote = (id) => {
  const tx = db.transaction('notes','readonly');
  tx.objectStore('notes').get(id).onsuccess = (e) => {
    const note = e.target.result;
    const newContent = prompt('Редактировать', note.content);
    if (newContent) {
      note.content = newContent;
      const tx2 = db.transaction('notes','readwrite');
      tx2.objectStore('notes').put(note);
      tx2.oncomplete = loadNotes;
    }
  };
};
window.openPaint = () => {
  const cont = document.getElementById('tabContent');
  cont.innerHTML = `<div class="content-header"><i class="fas fa-arrow-left" onclick="switchTab('tools')"></i><h2>Paint</h2><i class="fas fa-save" onclick="savePaint()"></i></div><canvas id="paintCanvas" width="400" height="600" style="background:white;"></canvas><button class="btn" onclick="clearPaint()">Очистить</button>`;
  const canvas = document.getElementById('paintCanvas'), ctx = canvas.getContext('2d');
  let painting = false;
  canvas.onmousedown = () => painting = true;
  canvas.onmouseup = () => painting = false;
  canvas.onmousemove = (e) => { if(painting) { ctx.fillRect(e.offsetX, e.offsetY, 5, 5); } };
};
window.clearPaint = () => document.getElementById('paintCanvas').getContext('2d').clearRect(0,0,400,600);
window.savePaint = () => {
  const canvas = document.getElementById('paintCanvas');
  const a = document.createElement('a');
  a.href = canvas.toDataURL();
  a.download = 'paint.png';
  a.click();
};
window.openMedia = () => alert('Медиа-менеджер');

// ---------- ИИ ----------
async function initLLM() { if (llmReady) return true; try { llmEngine = await webllm.CreateMLCEngine("SmolLM2-1.7B-Instruct"); llmReady = true; return true; } catch { return false; } }
async function askLLM(prompt) { if (!llmReady) await initLLM(); if (!llmReady) return 'ИИ не загружен.'; const sys = 'Ты MIM Ассистент.'; const messages = [{ role: 'system', content: sys }, { role: 'user', content: prompt }]; try { const reply = await llmEngine.chat.completions.create({ messages, temperature: 0.7, max_tokens: 200 }); return reply.choices[0].message.content; } catch { return 'Ошибка.'; } }

// Вспомогательные
function updateChatLastMessage(chatId, message) {
  const chat = chats.find(c => c.id === chatId);
  if (chat) { chat.lastMsg = message.text?.substring(0,30) || '📎'; chat.time = new Date(message.timestamp).toLocaleTimeString().slice(0,5); if (currentTab==='chats') renderChats(); }
}
window.searchMessages = () => alert('Поиск');
window.searchInChat = () => alert('Поиск в чате');
window.showChatMenu = (e, chatId) => { /* контекстное меню чата */ };
window.createGroup = () => alert('Создание группы — модуль будет добавлен');
window.addContact = () => alert('Добавление контакта');
window.searchContacts = () => alert('Поиск контактов');
window.openEmojiPicker = () => alert('Эмодзи');
window.setChatBg = (file) => { if(file) alert('Фон установлен'); };
window.searchSettings = (q) => {};
window.editProfile = () => alert('Редактирование профиля');
