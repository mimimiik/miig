const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');
let db = { users: {}, chats: {}, channels: {}, groups: {} };
if (fs.existsSync(DB_PATH)) { try { db = JSON.parse(fs.readFileSync(DB_PATH)); } catch(e) {} }
const saveDb = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

const onlineUsers = {};
const sockets = {};

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    sockets[socket.id] = username;
    onlineUsers[username] = socket.id;
    socket.username = username;
    io.emit('onlineUpdate', { username, online: true });
    socket.emit('onlineList', Object.keys(onlineUsers));
  });
  socket.on('joinChat', (chatId) => socket.join(chatId));
  socket.on('sendMessage', (data) => {
    const { chatId, message } = data;
    if (!db.chats[chatId]) db.chats[chatId] = { messages: [] };
    db.chats[chatId].messages.push(message);
    saveDb();
    io.to(chatId).emit('newMessage', { chatId, message });
  });
  socket.on('editMessage', ({ chatId, messageId, newText }) => {
    const chat = db.chats[chatId];
    if (chat) {
      const msg = chat.messages.find(m => m.id === messageId);
      if (msg) { msg.text = newText; saveDb(); io.to(chatId).emit('messageEdited', { chatId, messageId, newText }); }
    }
  });
  socket.on('deleteMessage', ({ chatId, messageId, forEveryone }) => {
    const chat = db.chats[chatId];
    if (chat) {
      chat.messages = chat.messages.filter(m => m.id !== messageId);
      saveDb();
      io.to(chatId).emit('messageDeleted', { chatId, messageId });
    }
  });
  socket.on('addReaction', ({ chatId, messageId, reaction, user }) => {
    const chat = db.chats[chatId];
    if (chat) {
      const msg = chat.messages.find(m => m.id === messageId);
      if (msg) { if (!msg.reactions) msg.reactions = []; msg.reactions.push({ emoji: reaction, user }); saveDb(); io.to(chatId).emit('reactionAdded', { chatId, messageId, reaction, user }); }
    }
  });
  socket.on('callUser', ({ to, signal, video }) => {
    const targetId = onlineUsers[to];
    if (targetId) io.to(targetId).emit('incomingCall', { from: socket.username, signal, video });
  });
  socket.on('answerCall', ({ to, signal }) => {
    const targetId = onlineUsers[to];
    if (targetId) io.to(targetId).emit('callAccepted', signal);
  });
  socket.on('iceCandidate', ({ to, candidate }) => {
    const targetId = onlineUsers[to];
    if (targetId) io.to(targetId).emit('iceCandidate', candidate);
  });
  socket.on('disconnect', () => {
    const username = sockets[socket.id];
    if (username) { delete onlineUsers[username]; delete sockets[socket.id]; io.emit('onlineUpdate', { username, online: false }); }
  });
});

app.post('/api/register', (req, res) => { /* ... как раньше ... */ });
app.post('/api/login', (req, res) => { /* ... как раньше ... */ });
app.get('/api/chat/:chatId', (req, res) => { /* ... */ });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
