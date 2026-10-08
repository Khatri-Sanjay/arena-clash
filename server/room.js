import { randomUUID } from 'node:crypto';
import { C, MAPS, WEAPONS, weaponPads, updateBoost, arenaObjects, BOOST_PADS, objectRect, hitRect, move, tryDash } from '../shared/game.js';
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export class Room {
  constructor(code) {
    this.code = code; this.ps = new Map(); this.bs = []; this.ph = 'lobby'; this.endTs = 0;
    this.hostId = null; this.nid = 1; this.nb = 1; this.res = null; this.idleAt = Date.now();
    this.settings = { map: 'neon', minutes: 3, target: 10, mode: 'ffa', difficulty: 'normal' };
    this.map = MAPS.neon;
    this.supplies = this.map.supplies.map(([x,y]) => ({x,y,readyAt:0}));
    this.weapons = weaponPads(this.map).map(([x,y,type])=>({x,y,type,readyAt:0}));
    this.objects=arenaObjects(); this.teamWinner=null;
    this.iv = setInterval(() => this.tick(), 1000 / C.TICK);
  }
  send(p, m) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  all(m) { const s = JSON.stringify(m); for (const p of this.ps.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }
  info() {
    this.all({ t: 'room', code: this.code, ph: this.ph, host: this.hostId, res: this.res, settings: this.settings, teamWinner:this.teamWinner, scores:this.teamScores(),
      ps: [...this.ps.values()].map(p => ({ id: p.id, n: p.n, r: p.ready, on: !!p.ws || !!p.bot, bot: !!p.bot, team:p.team ?? 0 })) });
  }
  join(ws, n, tok) {
    if (tok) for (const p of this.ps.values()) if (p.tok === tok) { // reconnect within grace period
      if (p.off && Date.now() - p.off > C.GRACE) return 'Rejoin window expired';
      if (p.ws && p.ws !== ws) { p.ws.room = null; p.ws.close(); }
      p.ws = ws; p.off = 0; this.clearInput(p); ws.pid = p.id; ws.room = this;
      this.send(p, { t: 'welcome', id: p.id, code: this.code, tok: p.tok }); this.info(); return p;
    }
    if (this.ph !== 'lobby') return 'Match in progress — join when it ends';
    if (this.ps.size >= C.MAX_PLAYERS) return 'Room is full';
    const p = { id: this.nid++, n, tok: randomUUID(), ws, off: 0, ready: false, x: 450, y: 280, a: 0, hp: C.HP, al: false,
      k: 0, d: 0, rs: 0, sh: 0, dU: 0, dC: 0, fA: 0, in: { mx: 0, my: 0, f: false, d: 0, a: 0 } };
    this.ps.set(p.id, p); this.assignTeams(); if (this.hostId == null) this.hostId = p.id;
    ws.pid = p.id; ws.room = this;
    this.send(p, { t: 'welcome', id: p.id, code: this.code, tok: p.tok }); this.info(); return p;
  }
  configure(p, m) {
    if (p.id !== this.hostId || this.ph !== 'lobby') return;
    if (!Object.hasOwn(MAPS,m.map) || ![1,3,5].includes(m.minutes) || ![5,10,20].includes(m.target)) return this.send(p,{t:'err',m:'Choose valid room settings'});
    const mode=m.mode ?? this.settings.mode, difficulty=m.difficulty ?? this.settings.difficulty;
    if(!['ffa','2v2','4v4'].includes(mode) || !['easy','normal','hard'].includes(difficulty))return this.send(p,{t:'err',m:'Choose valid match mode and bot difficulty'});
    this.weapons = weaponPads(MAPS[m.map]).map(([x,y,type])=>({x,y,type,readyAt:0}));
    this.settings = {map:m.map,minutes:m.minutes,target:m.target,mode,difficulty};this.assignTeams(); this.map = MAPS[m.map];
    this.supplies = this.map.supplies.map(([x,y])=>({x,y,readyAt:0}));
    for(const q of this.ps.values()) if(q.id!==this.hostId) q.ready=!!q.bot;
    this.info();
  }
  clearInput(p) { p.in.mx = p.in.my = 0; p.in.f = false; p.inputAt = 0; p.dU = 0; p.in.boost=false;p.boost=false; }
  drop(ws) { const p = this.ps.get(ws.pid); if (p && p.ws === ws) { this.clearInput(p); p.ws = null; p.off = Date.now(); p.ready = false; this.info(); } }
  addBot(p) {
    if (p.id !== this.hostId || this.ph !== 'lobby' || this.ps.size >= C.MAX_PLAYERS) return;
    const id = this.nid++;
    this.ps.set(id, { id, n: `Bot ${id}`, bot: true, ready: true, ws: null, off: 0,
      x: 450, y: 280, a: 0, hp: C.HP, al: false, k: 0, d: 0, rs: 0, sh: 0, dU: 0, dC: 0, fA: 0,
      in: { mx: 0, my: 0, f: false, d: 0, a: 0 } });
    this.assignTeams();this.info();
  }
  driveBot(p, t) {
    const foes = [...this.ps.values()].filter(q => q !== p && q.al && (this.settings.mode==='ffa' || q.team!==p.team) && (q.bot || q.ws));
    const foe = foes.sort((a,b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if (!foe) { this.clearInput(p); return; }
    let target = foe;
    if (p.hp <= 65) target = this.supplies.filter(s => t >= s.readyAt).sort((a,b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0] || foe;
    const aim = Math.atan2(foe.y-p.y,foe.x-p.x), direction = Math.atan2(target.y-p.y,target.x-p.x);
    const distance = Math.hypot(target.x-p.x,target.y-p.y);
    let angle = direction + (target === foe ? Math.sin(t/700+p.id)*.65 : 0);
    // Try an alternate direction when cover blocks the next step.
    const probe = { ...p }; move(probe, Math.cos(angle), Math.sin(angle), .12, t, this.obstacles());
    if (Math.hypot(probe.x-p.x,probe.y-p.y) < 10) angle += Math.PI/2 + Math.sin(t/500+p.id);
    const skill={easy:.28,normal:.09,hard:.025}[this.settings.difficulty];
    p.in = { mx: distance > 120 || target !== foe ? Math.cos(angle) : Math.cos(angle+Math.PI/2)*.7,
      my: distance > 120 || target !== foe ? Math.sin(angle) : Math.sin(angle+Math.PI/2)*.7,
      a: aim + Math.sin(t/300+p.id)*skill, f: distance < 550 && t >= foe.sh && (this.settings.difficulty!=='easy' || Math.sin(t/900+p.id)>.25), boost:this.settings.difficulty==='hard' && distance>300, d: 0 };
    if (p.hp < 40 && Math.sin(t/800+p.id) > .8) tryDash(p,t);
  }
  remove(p) {
    this.ps.delete(p.id); if (p.ws) p.ws.room = null;
    if (this.hostId === p.id) this.hostId = [...this.ps.values()].find(q => !q.bot)?.id ?? null;
    if (![...this.ps.values()].some(q => !q.bot)) this.ps.clear();
    if (!this.ps.size) this.idleAt = Date.now();
    if(this.ph==='lobby')this.assignTeams();this.info();
  }
  msg(ws, m) {
    const p = this.ps.get(ws.pid); if (!p || p.ws !== ws) return;
    const t = Date.now();
    switch (m.t) {
      case 'ping': if (typeof m.at === 'number' && Number.isFinite(m.at)) this.send(p, { t: 'pong', at: m.at }); break;
      case 'in': { // client sends only intent; positions/damage are computed here
        p.inputAt = t;
        const i = p.in; i.mx = num(m.mx, -1, 1); i.my = num(m.my, -1, 1); i.f = m.f === true; i.boost=m.boost===true;
        if (typeof m.a === 'number' && Number.isFinite(m.a)) i.a = m.a;
        if (Number.isInteger(m.d) && m.d !== i.d) { i.d = m.d; if (this.ph === 'play' && p.al) tryDash(p, t); }
        break;
      }
      case 'reload': if(this.ph==='play' && p.al)this.reload(p,t); break;
      case 'ready': if (this.ph === 'lobby') { p.ready = m.v === true; this.info(); } break;
      case 'settings': this.configure(p,m); break;
      case 'start': this.start(p, t); break;
      case 'bot': this.addBot(p); break;
      case 'removeBots': if (p.id === this.hostId && this.ph === 'lobby') { for (const q of [...this.ps.values()]) if (q.bot) this.ps.delete(q.id); this.info(); } break;
      case 'rematch': if(this.ph==='end'){p.ready=m.v===true;this.info();if([...this.ps.values()].every(q=>(q.bot || q.ws) && q.ready)){const required=this.settings.mode==='2v2'?4:this.settings.mode==='4v4'?8:0;if(required && this.ps.size!==required){this.send(p,{t:'err',m:'The team roster changed. Ask the host to change the match setup.'});return;}this.ph='lobby';this.start(this.ps.get(this.hostId),t);}} break;
      case 'again': if (p.id === this.hostId && this.ph === 'end') { this.ph = 'lobby'; this.res = null; for (const q of this.ps.values()) q.ready = !!q.bot; this.info(); } break;
      case 'leave': this.remove(p); break;
    }
  }
  start(p, t) {
    if (p.id !== this.hostId || this.ph !== 'lobby') return;
    const required=this.settings.mode==='2v2'?4:this.settings.mode==='4v4'?8:0;
    if(required && this.ps.size!==required)return this.send(p,{t:'err',m:`This mode needs ${required} players. Add bots or invite friends.`});
    if([...this.ps.values()].some(q=>!q.bot && !q.ws))return this.send(p,{t:'err',m:'Wait for disconnected players to rejoin'});
    if (this.ps.size < 2) return this.send(p, { t: 'err', m: 'Invite a friend or add a practice bot first' });
    for (const q of this.ps.values()) if (q.id !== this.hostId && !q.ready) return this.send(p, { t: 'err', m: 'Everyone must be ready first' });
    for (const supply of [...this.supplies,...this.weapons]) supply.readyAt = 0;
    this.assignTeams();this.objects=arenaObjects();this.teamWinner=null;
    this.ph = 'count'; this.endTs = t + C.COUNT; this.res = null; this.bs = [];
    for (const q of this.ps.values()) { q.k = q.d = 0; q.in.f = false; this.spawn(q, t, true); }
    this.info();
  }
  spawn(p, t, first) {
    let best = this.map.spawns[0], bd = -1;
    const foes = [...this.ps.values()].filter(q => q !== p && q.al);
    for (const s of this.map.spawns.filter(s=>this.settings.mode==='ffa' || (p.team===0?s[0]<=450:s[0]>=450)).slice().sort(() => Math.random() - .5)) {
      const d = foes.length ? Math.min(...foes.map(q => Math.hypot(q.x - s[0], q.y - s[1]))) : 1;
      if (d > bd) { bd = d; best = s; }
    }
    p.energy=100;p.boost=false;p.boostLocked=false;p.padUntil=0;
    p.weapon='cannon';p.ammo=WEAPONS.cannon.magazine;p.reloadAt=0;p.pickupAt=0;
    p.x = best[0]; p.y = best[1]; p.hp = C.HP; p.al = true; p.dU = p.dC = p.fA = 0; p.sh = t + (first ? C.COUNT + C.SHIELD : C.SHIELD);
  }
  tick() {
    const t = Date.now(), dt = 1 / C.TICK;
    for (const p of [...this.ps.values()]) if (p.off && t - p.off > C.GRACE) this.remove(p);
    if (this.ph === 'count' && t >= this.endTs) { this.ph = 'play'; this.endTs = t + (+process.env.MATCH_MS || this.settings.minutes*60000); this.info(); }
    if (this.ph === 'play') {
      this.sim(t, dt);
      const top = this.settings.mode==='ffa'?Math.max(0, ...[...this.ps.values()].map(p => p.k)):Math.max(...this.teamScores());
      if (top >= this.settings.target || t >= this.endTs || !this.ps.size) this.finish();
    }
    if (this.ph === 'count' || this.ph === 'play') this.snap(t);
  }
  assignTeams(){let i=0;for(const p of this.ps.values())p.team=i++%2;}
  teamScores(){return [0,1].map(team=>[...this.ps.values()].filter(p=>p.team===team).reduce((sum,p)=>sum+p.k,0));}
  obstacles(){return [...this.map.obstacles,...this.objects.filter(o=>o.hp>0).map(objectRect)];}
  damage(v,amount,owner,t,x=v.x,y=v.y,a=0){
    if(!v.al || t<v.sh)return;
    const killer=this.ps.get(owner);
    if(this.settings.mode!=='ffa' && killer && killer!==v && killer.team===v.team)return;
    v.hp-=amount;this.all({t:'fx',x:Math.round(x),y:Math.round(y),v:v.id,kid:owner,damage:amount,a});
    if(v.hp<=0){v.al=false;v.d++;v.rs=t+C.RESPAWN;if(killer && killer!==v)killer.k++;
      this.all({t:'kill',k:killer?.n || 'Arena',v:v.n,kid:owner,vid:v.id,x:Math.round(v.x),y:Math.round(v.y)});}
  }
  breakObject(o,owner,t){
    if(o.broken)return;o.hp=0;o.broken=true;this.all({t:'object',type:o.type,x:o.x,y:o.y});
    if(o.type==='barrel'){
      for(const v of this.ps.values()){const distance=Math.hypot(v.x-o.x,v.y-o.y);if(distance<110)this.damage(v,Math.round(65*(1-distance/110)),owner,t,v.x,v.y,Math.atan2(v.y-o.y,v.x-o.x));}
      for(const next of this.objects)if(next.hp>0 && Math.hypot(next.x-o.x,next.y-o.y)<110)this.breakObject(next,owner,t);
    }
  }
  reload(p,t) {
    const weapon=WEAPONS[p.weapon] || WEAPONS.cannon;
    if(!p.reloadAt && p.ammo<weapon.magazine)p.reloadAt=t+weapon.reload;
  }
  sim(t, dt) {
    for (const p of this.ps.values()) {
      if (p.bot) this.driveBot(p,t);
      else if (!p.ws || !p.inputAt || t - p.inputAt > 300) this.clearInput(p);
      if (!p.al) { if (t >= p.rs) this.spawn(p, t); continue; }
      updateBoost(p,p.in.boost,dt);
      if(Math.hypot(p.in.mx,p.in.my)>.1 && t>=(p.padUntil || 0) && BOOST_PADS.some(([x,y])=>Math.hypot(p.x-x,p.y-y)<25)){p.dU=t+350;p.padUntil=t+1800;this.all({t:'pad',id:p.id,x:p.x,y:p.y});}
      p.a = p.in.a; move(p, p.in.mx, p.in.my, dt, t, this.obstacles());
      const weapon=WEAPONS[p.weapon] || WEAPONS.cannon;
      if(p.ammo===undefined)p.ammo=weapon.magazine;
      if(p.reloadAt && t>=p.reloadAt){p.ammo=weapon.magazine;p.reloadAt=0;}
      if(p.in.f && !p.reloadAt && t>=p.fA && p.ammo>0){
        p.fA=t+weapon.cooldown;p.ammo--;
        for(let i=0;i<weapon.pellets;i++){
          const a=p.a+(i-(weapon.pellets-1)/2)*weapon.spread;
          this.bs.push({id:this.nb++,o:p.id,x:p.x+Math.cos(a)*(C.R+4),y:p.y+Math.sin(a)*(C.R+4),a,l:weapon.life,speed:weapon.speed,damage:weapon.damage,weapon:p.weapon || 'cannon'});
        }
        if(!p.ammo)this.reload(p,t);
      }
    }
    for(const pad of this.weapons){
      if(t<pad.readyAt)continue;
      for(const p of this.ps.values()){
        if(!p.al || t<(p.pickupAt || 0) || p.weapon===pad.type || Math.hypot(p.x-pad.x,p.y-pad.y)>C.R+14)continue;
        p.weapon=pad.type;p.ammo=WEAPONS[pad.type].magazine;p.reloadAt=0;p.fA=t+150;p.pickupAt=t+1000;pad.readyAt=t+15000;
        this.all({t:'weapon',id:p.id,weapon:pad.type,x:pad.x,y:pad.y});break;
      }
    }

    for (const supply of this.supplies) {
      if (t < supply.readyAt) continue;
      for (const p of this.ps.values()) {
        if (!p.al || p.hp >= C.HP || Math.hypot(p.x-supply.x,p.y-supply.y) > C.R+14) continue;
        const healed = Math.min(35, C.HP-p.hp);
        p.hp += healed; supply.readyAt = t+12000;
        this.all({t:'pickup',id:p.id,x:supply.x,y:supply.y,healed}); break;
      }
    }
    for (const b of this.bs) {
      b.l -= dt;
      for (let s = 0; s < 2 && b.l > 0; s++) {
        b.x += Math.cos(b.a) * (b.speed || C.BULLET_SPEED) * dt / 2; b.y += Math.sin(b.a) * (b.speed || C.BULLET_SPEED) * dt / 2;
        if (b.x < 0 || b.x > C.W || b.y < 0 || b.y > C.H || this.map.obstacles.some(o => hitRect(b.x, b.y, o, 3))) { b.l = 0; break; }
        const object=this.objects.find(o=>o.hp>0 && hitRect(b.x,b.y,objectRect(o),3));
        if(object){object.hp-=b.damage || C.DMG;b.l=0;if(object.hp<=0)this.breakObject(object,b.o,t);break;}
        for (const v of this.ps.values()) {
          if (!v.al || v.id === b.o || (this.settings.mode!=='ffa' && this.ps.get(b.o)?.team===v.team) || t < v.sh || (v.x - b.x) ** 2 + (v.y - b.y) ** 2 > (C.R + 3) ** 2) continue;
          b.l=0;this.damage(v,b.damage || C.DMG,b.o,t,b.x,b.y,b.a);
          break;
        }
      }
    }
    this.bs = this.bs.filter(b => b.l > 0);
  }
  snap(t) {
    this.all({ t: 's', ph: this.ph, left: Math.max(0, this.endTs - t), map: this.settings.map, scores:this.teamScores(), objects:this.objects.map(o=>[o.id,o.type,o.x,o.y,o.hp]), weapons: this.weapons.map(w=>[w.x,w.y,w.type,Math.max(0,w.readyAt-t)]), supplies: this.supplies.map(s => [s.x,s.y,Math.max(0,s.readyAt-t)]),
      p: [...this.ps.values()].map(p => [p.id, Math.round(p.x), Math.round(p.y), Math.round(p.a * 100) / 100, p.hp, p.al ? 1 : 0, p.k, p.d, t < p.sh ? 1 : 0, Math.max(0,p.rs-t), Math.max(0,p.dC-t),p.weapon || 'cannon',p.ammo,Math.max(0,(p.reloadAt || 0)-t),p.team ?? 0,Math.round(p.energy ?? 100),p.boost?1:0,Math.max(0,p.dU-t),p.boostLocked?1:0]),
      b: this.bs.map(b => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.a * 100) / 100,b.weapon || 'cannon']) });
  }
  finish() {
    this.ph = 'end'; this.bs = [];
    this.res = [...this.ps.values()].map(p => ({ id: p.id, n: p.n, k: p.k, d: p.d })).sort((a, b) => b.k - a.k || a.d - b.d);
    const scores=this.teamScores();this.teamWinner=this.settings.mode==='ffa'?null:scores[0]===scores[1]?'draw':scores[0]>scores[1]?0:1;
    for (const p of this.ps.values()) p.ready = !!p.bot;
    this.info();
  }
  destroy() { clearInterval(this.iv); for (const p of this.ps.values()) if (p.ws) p.ws.room = null; }
}
