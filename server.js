const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(__dirname, {
  etag: true,
  maxAge: '30d',
  setHeaders(res, filePath) {
    if (/\.(png|jpe?g|gif|webp|mp3|wav|wasm|data)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

function genCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

wss.on('connection', ws => {
  console.log('New connection established');
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    const str = raw.toString();
    console.log('Received message:', str);
    let msg;
    try { msg = JSON.parse(str); } catch { return; }

    if (msg.type === 'create') {
      const code = genCode();
      console.log('Creating room:', code);
      rooms.set(code, { host: ws, guest: null });
      ws.room = code; ws.role = 'host';
      ws.send(JSON.stringify({ type: 'created', code }));
    } else if (msg.type === 'join') {
      console.log('Joining room:', msg.code);
      const room = rooms.get(msg.code);
      if (!room) return ws.send(JSON.stringify({ type: 'error', msg: '房间不存在' }));
      if (room.guest) return ws.send(JSON.stringify({ type: 'error', msg: '房间已满' }));
      room.guest = ws; ws.room = msg.code; ws.role = 'guest';
      ws.send(JSON.stringify({ type: 'joined' }));
      room.host.send(JSON.stringify({ type: 'peer_joined' }));
    } else {
      const room = rooms.get(ws.room);
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      if (peer && peer.readyState === 1) peer.send(str);
    }
  });

  ws.on('close', () => {
    console.log('Connection closed');
    if (!ws.room) return;
    const room = rooms.get(ws.room);
    if (!room) return;
    const peer = ws.role === 'host' ? room.guest : room.host;
    if (peer && peer.readyState === 1) peer.send(JSON.stringify({ type: 'peer_left' }));
    rooms.delete(ws.room);
    if (peer) { peer.room = null; peer.role = null; }
  });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) return ws.terminate();
    ws.alive = false; ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Greedy Cat server on port ' + PORT));
