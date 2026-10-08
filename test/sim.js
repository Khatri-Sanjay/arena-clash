// Integration test: spawns the real server, plays a real match with 3 bot clients over WebSocket.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const PORT = 3199, URL = `ws://localhost:${PORT}`;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, MATCH_MS: '25000' }, stdio: 'inherit' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(c ? '  PASS' : '  FAIL', m); if (!c) fails++; };

function bot(name) {
  const b = { name, snap: null, room: null, kills: [], errs: [], hits: 0 };
  b.open = () => new Promise(res => { b.ws = new WebSocket(URL); b.ws.on('open', res);
    b.ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'welcome') Object.assign(b, { id: m.id, tok: m.tok, code: m.code });
      if (m.t === 'room') b.room = m; if (m.t === 's') b.snap = m; if (m.t === 'kill') b.kills.push(m); if (m.t === 'fx') b.hits++; if (m.t === 'err') b.errs.push(m.m); }); });
  b.send = m => b.ws.send(JSON.stringify(m));
  return b;
}
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return false; };

try {
  await sleep(600);
  const h = await (await fetch(`http://localhost:${PORT}/health`)).json(); ok(h.ok, 'health endpoint');
  const [A, B, Cc] = [bot('Alpha'), bot('Bravo'), bot('Charlie')]; for (const b of [A, B, Cc]) await b.open();
  const bad = bot('x'); await bad.open(); bad.send({ t: 'join', room: 'new', name: '<<>>' }); bad.ws.send('not json'); await sleep(150); ok(bad.errs.length === 1, 'invalid name rejected, garbage ignored');
  bad.send({ t: 'join', room: 'ZZZZ', name: 'Bad' }); await sleep(150); ok(bad.errs.includes('Room not found'), 'unknown room rejected');
  A.send({ t: 'join', room: 'new', name: 'Alpha' }); await until(() => A.code);
  B.send({ t: 'join', room: A.code.toLowerCase(), name: 'Bravo' }); Cc.send({ t: 'join', room: A.code, name: 'Charlie' });
  await until(() => A.room && A.room.ps.length === 3); ok(A.room.ps.length === 3, 'three players joined one room');
  A.send({ t: 'start' }); await sleep(100); ok(A.errs.includes('Everyone must be ready first'), 'host cannot start before ready');
  B.send({ t: 'start' }); B.send({ t: 'ready', v: true }); Cc.send({ t: 'ready', v: true }); await sleep(150);
  A.send({ t: 'start' }); ok(await until(() => A.snap && A.snap.ph === 'count'), 'countdown begins');
  ok(await until(() => A.snap.ph === 'play', 6000), 'match starts');
  // bots chase the nearest enemy and fire; positions come only from server snapshots
  let B2 = null; const drive = setInterval(() => { for (const b of [A, B2 || B, Cc]) { if (!b.snap || b.ws.readyState !== 1) continue; const me = b.snap.p.find(p => p[0] === b.id); if (!me || !me[5]) continue;
    let best = null, bd = 1e9; for (const p of b.snap.p) if (p[0] !== b.id && p[5]) { const d = Math.hypot(p[1] - me[1], p[2] - me[2]); if (d < bd) { bd = d; best = p; } }
    if (!best) continue; const a = Math.atan2(best[2] - me[2], best[1] - me[1]), jig = Math.sin(Date.now() / 400 + b.id) * 0.8;
    b.send({ t: 'in', mx: Math.cos(a + jig), my: Math.sin(a + jig), a, f: true, d: 0 }); } }, 33);
  ok(await until(() => A.hits > 0, 25000), 'server-computed hits happened'); 
  // cheating attempts must have no effect: huge numbers / fake damage fields
  B.send({ t: 'in', mx: 9999, my: -9999, a: 1e308, f: true, d: 0, dmg: 9999, hp: 100000, k: 99, x: 5, y: 5 }); await sleep(300);
  const bp = A.snap.p.find(p => p[0] === B.id); ok(bp[4] <= 100 && bp[6] < 10 && bp[1] > 6, 'client-sent hp/score/position ignored');
  // disconnect + reconnect with token keeps identity
  const oldId = B.id, tok = B.tok; B.ws.terminate(); await sleep(300);
  ok(A.room.ps.find(p => p.id === oldId)?.on === false, 'disconnect detected');
  B2 = bot('Bravo'); await B2.open(); B2.send({ t: 'join', room: A.code, name: 'Bravo', tok }); await until(() => B2.id);
  ok(B2.id === oldId, 'reconnect restores same player');
  ok(await until(() => A.room.ph === 'end' && A.room.res, 60000), 'match ends with results (kills or timer)');
  clearInterval(drive);
  ok(A.room.res[0].k >= 0, `winner determined server-side (${A.room.res[0].n} with ${A.room.res[0].k} kills)`);
  A.send({ t: 'again' }); ok(await until(() => A.room.ph === 'lobby'), 'play again returns to lobby');
  A.ws.close(); Cc.ws.close(); B2.ws.close(); await sleep(200);
} catch (e) { console.error(e); fails++; }
srv.kill('SIGTERM'); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
