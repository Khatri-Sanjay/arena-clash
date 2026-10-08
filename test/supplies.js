import assert from 'node:assert/strict';
import { Room } from '../server/room.js';

const room = new Room('TEST');
clearInterval(room.iv);
const player = (id, hp, al = true) => ({ id, ws:{readyState:1,send(){}}, x: 450, y: 280, hp, al, a: 0, dU: 0, dC: 0, fA: 0, rs: Infinity, in: { mx: 0, my: 0, a: 0, f: false } });
try {
  const events=[]; room.all=m=>events.push(m);
  const p = player(1, 50), q = player(2, 50);
  room.ps.set(1, p); room.ps.set(2, q);
  room.sim(1000, 0);
  assert.equal(p.hp, 85);
  assert.equal(q.hp, 50, 'one collector per pickup');
  room.sim(12999, 0);
  assert.equal(p.hp, 85, 'cooldown prevents collection');
  room.sim(13000, 0);
  assert.equal(p.hp, 100, 'health caps at maximum');
  assert.equal(events.filter(m=>m.t==='pickup').at(-1).healed,15,'notification reports actual capped healing');
  room.sim(25000, 0);
  assert.equal(q.hp, 85, 'full health player leaves supply for others');
  q.al = false;
  room.sim(37000, 0);
  assert.equal(q.hp, 85, 'dead players cannot collect');
  room.hostId = p.id;
  q.ready = true;
  room.start(p, 40000);
  assert.ok(room.supplies.every(s => s.readyAt === 0), 'new matches reset supplies');
  p.x = 450; p.y = 311; p.hp = 50; q.al = false;
  room.sim(41000, 0);
  assert.equal(p.hp, 50, 'outside collection radius cannot heal');
  p.y = 310;
  room.sim(41000, 0);
  assert.equal(p.hp, 85, 'collection radius includes boundary');
  p.x = 110; p.y = 280;
  room.sim(41001, 0);
  assert.equal(p.hp, 100, 'different supplies have independent cooldowns');
  console.log('PASS supply healing, maximum health, cooldown, eligibility and match reset');
} finally { room.destroy(); }
