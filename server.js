// Файл 3: server.js — Сервер MIM Galaxy Ultimate для Render
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Простая файловая БД
const DB_PATH = path.join(__dirname, 'db.json');
let db = {
  users: {},
  chats: {},
  channels: {}
};

if (fs.existsSync(DB_PATH)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH));
  } catch(e) { console.error('DB read error, using empty db'); }
}

const saveDb = () => {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
};

// Онлайн пользователи (socket.id -> username)
const onlineUsers = {}; // username -> socket.id
const sockets = {};     // socket.id -> username

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (username) => {
    sockets[socket.id] = username;
    onlineUsers[username] = socket.id;
    socket.username = username;
    io.emit('onlineUpdate', { username, online: true });
    socket.emit('onlineList', Object.keys(onlineUsers));
  });

  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('leaveChat', (chatId) => {
    socket.leave(chatId);
  });

  socket.on('sendMessage', (data) => {
    const { chatId, message } = data;
    if (!db.chats[chatId]) db.chats[chatId] = { messages: [], type: 'private' };
    db.chats[chatId].messages.push(message);
    saveDb();
    io.to(chatId).emit('newMessage', { chatId, message });
  });

  // WebRTC сигнализация
  socket.on('callUser', ({ to, signal, video }) => {
    const targetId = onlineUsers[to];
    if (targetId) {
      io.to(targetId).emit('incomingCall', { from: socket.username, signal, video });
    }
  });

  socket.on('answerCall', ({ to, signal }) => {
    const targetId = onlineUsers[to];
    if (targetId) {
      io.to(targetId).emit('callAccepted', signal);
    }
  });

  socket.on('iceCandidate', ({ to, candidate }) => {
    const targetId = onlineUsers[to];
    if (targetId) {
      io.to(targetId).emit('iceCandidate', candidate);
    }
  });

  socket.on('disconnect', () => {
    const username = sockets[socket.id];
    if (username) {
      delete onlineUsers[username];
      delete sockets[socket.id];
      io.emit('onlineUpdate', { username, online: false });
    }
    console.log('User disconnected:', socket.id);
  });
});

// API регистрации
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (db.users[username]) return res.status(400).json({ error: 'User already exists' });
  
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  db.users[username] = { password: hash, salt };
  saveDb();
  res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const hash = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
  if (hash !== user.password) return res.status(401).json({ error: 'Invalid credentials' });
  
  res.json({ success: true, token: 'jwt-placeholder' });
});

// Получение истории чата
app.get('/api/chat/:chatId', (req, res) => {
  const chat = db.chats[req.params.chatId] || { messages: [] };
  res.json(chat);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MIM Galaxy server running on port ${PORT}`);
});
