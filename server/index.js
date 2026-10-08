import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const rooms = new Map();
const okOrigin = o => !ORIGINS.length || !o || ORIGINS.includes(o);

const server = http.createServer((req, res) => {
  try {
    const o = req.headers.origin; if (o && ORIGINS.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.ps.size, 0) })); }
    if (p === '/config.js') { res.setHeader('Content-Type', MIME['.js']); res.setHeader('Cache-Control', 'no-store'); return res.end(`window.CFG=${JSON.stringify({ wsUrl: process.env.PUBLIC_WS_URL || '' })};`); }
    const sh = p.startsWith('/shared/'), dir = path.join(root, sh ? 'shared' : 'client');
    const f = path.join(dir, sh ? p.slice(8) : p === '/' ? 'index.html' : p);
    if (!f.startsWith(dir + path.sep)) { res.statusCode = 403; return res.end(); }
    fs.readFile(f, (e, buf) => {
      if (e) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
      res.setHeader('Cache-Control', f.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
      res.end(buf);
    });
  } catch { res.statusCode = 400; res.end(); }
});

const wss = new WebSocketServer({ server, maxPayload: 2048, verifyClient: i => okOrigin(i.origin) });
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const mk = () => { for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += CODE[Math.random() * CODE.length | 0]; if (!rooms.has(s)) return s; } };
const err = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'err', m }));

wss.on('connection', ws => {
  ws.alive = true; ws.cnt = 0; ws.room = null;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('message', buf => {
    if (++ws.cnt > 150) return ws.close(1008, 'rate limit'); // per-second budget (inputs run ~30/s)
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (ws.room) return ws.room.msg(ws, m);
    if (m.t !== 'join') return;
    const name = String(m.name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
    if (!name) return err(ws, 'Enter a valid name (letters, numbers, spaces)');
    let room;
    if (m.room === 'new') {
      if (rooms.size >= 200) return err(ws, 'Server is busy, try again soon');
      room = new Room(mk()); rooms.set(room.code, room);
    } else {
      const c = String(m.room ?? '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(c)) return err(ws, 'Room code must be 4 characters');
      room = rooms.get(c); if (!room) return err(ws, 'Room not found');
    }
    const tok = typeof m.tok === 'string' && m.tok.length < 64 ? m.tok : '';
    const r = room.join(ws, name, tok);
    if (typeof r === 'string') err(ws, r);
  });
  ws.on('close', () => ws.room?.drop(ws));
});

setInterval(() => { // heartbeat: drop dead sockets
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 15000);
setInterval(() => { for (const ws of wss.clients) ws.cnt = 0; }, 1000); // rate-limit window
setInterval(() => { // clean abandoned rooms
  for (const [c, r] of rooms) if (!r.ps.size && Date.now() - r.idleAt > 30000) { r.destroy(); rooms.delete(c); }
}, 10000);

server.listen(PORT, () => console.log(`Arena Clash listening on :${PORT}`));
const stop = () => { for (const r of rooms.values()) r.destroy(); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
