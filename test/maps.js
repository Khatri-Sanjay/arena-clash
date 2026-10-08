import assert from 'node:assert/strict';
import { C, MAPS, hitRect, move } from '../shared/game.js';
import { Room } from '../server/room.js';
const room=new Room('MAPS');clearInterval(room.iv);
const messages=[];
const socket=()=>({readyState:1,send:raw=>messages.push(JSON.parse(raw))});
try {
  const host=room.join(socket(),'Host',''),guest=room.join(socket(),'Guest','');
  room.configure(guest,{map:'pillars',minutes:5,target:20});
  assert.equal(room.settings.map,'neon','guests cannot configure');
  for(const map of ['__proto__','bad'])room.configure(host,{map,minutes:3,target:10});
  assert.equal(room.settings.map,'neon','invalid map rejected');
  room.configure(host,{map:'lanes',minutes:999,target:0});
  assert.equal(room.settings.map,'neon','invalid rules rejected');
  for(const [id,map] of Object.entries(MAPS)) {
    guest.ready=true;
    room.configure(host,{map:id,minutes:5,target:20});
    assert.equal(guest.ready,false,'settings change resets guest readiness');
    assert.equal(room.supplies.length,map.supplies.length);
    for(const [x,y] of [...map.spawns,...map.supplies])assert.ok(!map.obstacles.some(o=>hitRect(x,y,o,C.R)),'spawns and supplies clear of cover');
    const [x,y,w,h]=map.obstacles[0];
    const p={x:x-17,y:y+h/2,a:0,dU:0};
    move(p,1,0,.1,100,map.obstacles);
    assert.ok(p.x<=x-C.R+.001,'movement collides with selected map');
    room.bs=[{id:1,o:host.id,x:x-4,y:y+h/2,a:0,l:1}];
    room.sim(100,1/C.TICK);
    assert.equal(room.bs.length,0,'bullets collide with selected map');
  }
  host.al=guest.al=true;host.x=100;guest.x=150;host.y=guest.y=60;guest.sh=0;guest.hp=C.HP;
  room.bs=[{id:10,o:host.id,x:130,y:60,a:0,l:1}];room.sim(1000,1/C.TICK);
  const hit=messages.filter(m=>m.t==='fx').at(-1);
  assert.equal(hit.kid,host.id,'hit confirmation identifies shooter');
  assert.equal(hit.damage,C.DMG,'hit confirmation uses server damage');
  assert.equal(guest.hp,C.HP-C.DMG);
  guest.ready=true;room.start(host,Date.now());
  room.configure(host,{map:'neon',minutes:1,target:5});
  assert.equal(room.settings.map,'pillars','settings locked during match');
  room.endTs=0;room.tick();
  assert.ok(room.endTs-Date.now()>299000,'configured duration used');
  host.k=20;room.tick();assert.equal(room.ph,'end','configured kill target ends match');
  console.log('PASS map geometry, collision, settings validation, permissions, readiness and match rules');
} finally {room.destroy();}
