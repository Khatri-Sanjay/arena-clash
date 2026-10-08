import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { C, WEAPONS, MAPS, weaponPads, hitRect } from '../shared/game.js';
const room=new Room('GUNS');clearInterval(room.iv);
const events=[];const ws={readyState:1,send:raw=>events.push(JSON.parse(raw))};
const p=room.join(ws,'Tester','');
try {
  for(const map of Object.values(MAPS))for(const [x,y] of weaponPads(map))assert.ok(!map.obstacles.some(o=>hitRect(x,y,o,C.R)),'weapon pads clear cover');
  room.spawn(p,1000,false);p.x=100;p.y=60;p.sh=0;
  const fire=t=>{p.inputAt=t;p.in.f=true;room.sim(t,0);};
  fire(2000);assert.equal(room.bs.length,1);assert.equal(p.ammo,9);
  fire(2001);assert.equal(p.ammo,9,'fire cooldown enforced');
  p.ammo=1;fire(2300);assert.equal(p.ammo,0);assert.equal(p.reloadAt,3400);
  fire(3399);assert.equal(p.ammo,0,'no firing during reload');
  p.in.f=false;room.sim(3400,0);assert.equal(p.ammo,10,'automatic reload refills');
  p.ammo=7;room.ph='play';room.msg(ws,{t:'reload'});assert.ok(p.reloadAt>0,'manual reload');
  p.x=450;p.y=60;p.in.f=false;room.sim(5000,0);
  assert.equal(p.weapon,'shotgun');assert.equal(p.ammo,5);assert.equal(p.reloadAt,0,'pickup cancels previous reload');
  assert.ok(events.some(e=>e.t==='weapon' && e.weapon==='shotgun'));
  room.bs=[];p.x=400;p.y=60;fire(5200);
  assert.equal(room.bs.length,5,'shotgun pellets');assert.equal(p.ammo,4,'pellets consume one shell');
  assert.equal(room.bs[0].damage,12);assert.ok(room.bs[0].a<room.bs[4].a);
  p.x=450;p.y=500;p.in.f=false;room.sim(6100,0);assert.equal(p.weapon,'rapid');
  p.x=400;room.bs=[];fire(6300);fire(6399);assert.equal(room.bs.length,1);
  fire(6400);assert.equal(room.bs.length,2,'rapid fire cadence');
  room.msg(ws,{t:'in',weapon:'shotgun',ammo:999,damage:999,mx:0,my:0,f:false,d:0,a:0});
  assert.equal(p.weapon,'rapid');assert.equal(p.ammo,22,'client cannot change weapon or ammo');
  room.spawn(p,7000,false);assert.equal(p.weapon,'cannon');assert.equal(p.ammo,WEAPONS.cannon.magazine);
  room.ph='lobby';const q=room.join({readyState:1,send(){}},'Guest','');
  // A weapon's damage is attached to its projectile, even after the shooter swaps.
  p.x=100;p.y=60;q.x=150;q.y=60;q.al=true;q.sh=0;q.hp=100;q.rs=0;
  room.bs=[{id:999,o:p.id,x:130,y:60,a:0,l:1,speed:820,damage:10,weapon:'rapid'}];
  room.sim(7100,1/C.TICK);assert.equal(q.hp,90);
  assert.equal(events.filter(e=>e.t==='fx').at(-1).damage,10);
  console.log('PASS weapon pickup, cooldown, pellets, ammo, reload, respawn, damage and anti-cheat');
} finally {room.destroy();}
