import { C, MAPS, WEAPONS, weaponPads, updateBoost, BOOST_PADS, objectRect, move, tryDash } from '/shared/game.js';
const $ = id => document.getElementById(id), esc = s => String(s).replace(/[<>&"']/g, '');
const wsUrl = (window.CFG && window.CFG.wsUrl) || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
let touch = matchMedia('(pointer:coarse)').matches;
const prefs = (() => { try { return JSON.parse(localStorage.getItem('ac_controls')) || {}; } catch { return {}; } })();
function updateControls(type) {
  touch = prefs.mode === 'touch' || (prefs.mode !== 'mouse' && (type ? type !== 'mouse' : matchMedia('(pointer:coarse)').matches));
  document.body.classList.toggle('touch',touch); document.body.classList.toggle('left-handed',!!prefs.left);
  $('fire').hidden = !touch || !prefs.fire;
}

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = { get: k => { try { return sessionStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { sessionStorage.setItem(k, v) } catch {} } };
let ws, tok = store.get('tok') || '', code = '', name = (() => { try { return localStorage.getItem('ac_n') || '' } catch { return '' } })();
let me = 0, R = { ps: [], ph: 'lobby', host: 0, res: null }, snap = null, snapT = 0, joined = false, leaving = false, retry = 0, wantRoom = 'new';
const ents = new Map(), pred = { x: 450, y: 280, a: 0, dU: 0, dC: 0, init: false, al: false };
let arena = MAPS.neon, hitUntil = 0, damageUntil = 0, damageAngle = 0;
const hitLabels = [];
let noticeUntil = 0, noticeText = '';
let bul = [], seen = new Set(), feed = [], shake = 0, flash = 0, lastPh = 'lobby', cdN = 0, paused = false, mute = !!prefs.muted, AC = null, dispHp = 100;
$('nm').value = name;
const invited = new URLSearchParams(location.search || '').get('room')?.toUpperCase();
if(invited && /^[A-Z0-9]{4}$/.test(invited)){ $('cdi').value=invited; $('friends-panel').hidden=false; $('er').textContent='You are invited! Enter your nickname and join.'; }
$('friends').onclick=()=>{ $('friends-panel').hidden=!$('friends-panel').hidden; if(!$('friends-panel').hidden)$('cdi').focus(); };
function invitation(){const url=new URL(location.href || 'http://localhost');url.search='';url.hash='';url.searchParams.set('room',code);return url.href;}

/* ---------- UI helpers ---------- */
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h };
const col = (id, l = 58) => `hsl(${(id * 137.508) % 360} 85% ${l}%)`;
function show(id) { for (const e of document.querySelectorAll('.screen')) e.classList.remove('on'); $('game').style.display = 'none'; if (id === 'game') $('game').style.display = 'block'; else $(id).classList.add('on'); }
function err(m) { $('er').textContent = m; $('le').textContent = m; }
function snd(f, d = .08, t = 'square', v = .05, f2) { if (mute || prefs.volume===0 || !AC) return; try { const o = AC.createOscillator(), g = AC.createGain(), n = AC.currentTime; o.type = t; o.frequency.setValueAtTime(f, n); if (f2) o.frequency.exponentialRampToValueAtTime(f2, n + d); g.gain.setValueAtTime(v*(prefs.volume ?? 70)/100, n); g.gain.exponentialRampToValueAtTime(.0001, n + d); o.connect(g).connect(AC.destination); o.start(); o.stop(n + d) } catch {} }
function vibrate(ms){if(prefs.vibration && navigator.vibrate)navigator.vibrate(ms);}
function obstacles(){return [...arena.obstacles,...(snap?.objects || []).filter(o=>o[4]>0).map(([,type,x,y])=>objectRect({x,y}))];}
function validName() { name = $('nm').value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12); if (!name) { err('Enter a valid nickname'); return false } try { localStorage.setItem('ac_n', name) } catch {} return true }

/* ---------- networking ---------- */
const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)) };
let awaitingWelcome = false;
let reconnectTimer, joinTimer, busy = false, practice = false, teaching = false, lessonStep = 0, lessonProgress = 0, pingAt = 0, latency = null;
function busyUI(v) { busy=v; for(const id of ['mk','jn','practice','tutorial','rejoin','friends']) $(id).disabled=v; }
function updateRejoin() { $('rejoin').hidden = !store.get('room') || !store.get('tok'); }
function connect() {
  clearTimeout(reconnectTimer); clearTimeout(joinTimer);
  awaitingWelcome=true; const socket = new WebSocket(wsUrl); ws=socket;
  socket.onopen = () => { if(ws!==socket)return; send({t:'join',room:wantRoom,name,tok:tok || ''}); };
  socket.onmessage = e => { if(ws!==socket)return; let m; try{m=JSON.parse(e.data)}catch{return} if(on[m.t])on[m.t](m); };
  socket.onclose = () => {
    if(ws!==socket || leaving)return;
    clearTimeout(joinTimer); resetInput();
    if(!joined){busyUI(false);return err('Could not join. Check the room code and connection.');}
    $('ban').textContent='Connection lost. Reconnecting...'; $('ban').style.display='block';
    reconnectTimer=setTimeout(connect,Math.min(5000,400*2**retry++));
  };
  joinTimer=setTimeout(()=>{if(ws===socket && !leaving){socket.close();}},8000);
}
function join(room, restore=false) {
  if(busy || !validName())return;
  try { AC=AC || new(window.AudioContext || window.webkitAudioContext)(); AC.resume(); }catch{}
  clearTimeout(reconnectTimer);clearTimeout(joinTimer);
  const old=ws; ws=null; if(old)old.close();
  err('');leaving=false;joined=false;retry=0;wantRoom=room;tok=restore ? store.get('tok') || '' : '';
  busyUI(true);connect();
}
function resetInput() {
  keys={};mouseDown=false;fireHeld=false;boostHeld=false;sticks.L=sticks.R=null;for(const id of Object.keys(pid))delete pid[id];
  send({t:'in',mx:0,my:0,a:aimA,f:false,d:dashN});
}
function leave() {
  leaving=true;joined=false;clearTimeout(reconnectTimer);clearTimeout(joinTimer); resetInput();send({t:'leave'});
  const old=ws;ws=null;if(old)old.close();store.set('tok','');store.set('room','');tok='';updateRejoin();busyUI(false);
  R={ps:[],ph:'lobby',host:0,res:null};ents.clear();bul=[];snap=null;pred.init=false;lastPh='lobby';paused=false;teaching=false;practice=false;
  $('ps').style.display=$('end').style.display=$('ban').style.display='none';show('menu');
}
const on = {
  welcome(m) { awaitingWelcome=false; clearTimeout(joinTimer);busyUI(false);retry=0;$('ban').style.display='none'; me = m.id; tok = m.tok; code = m.code; wantRoom = m.code; joined = true; store.set('tok', tok); store.set('room', code);updateRejoin(); if(practice){practice=false;send({t:'bot'});send({t:'bot'});send({t:'start'});} if (R.ph === 'lobby' || !snap) show('lobby'); },
  err(m) { if(awaitingWelcome){leave();err(m.m+' Create a room or join again.');return;} err(m.m); },
  room(m) {
    R = m; arena = MAPS[m.settings?.map] || MAPS.neon; code = m.code; $('lc').textContent = code; $('invite-url').value=invitation(); lobbyUI();
    if (m.ph === 'lobby') { $('end').style.display = 'none'; ents.clear(); bul = []; lastPh = 'lobby'; if (joined) show('lobby'); }
    if (m.ph === 'end') showEnd();
  },
  s(m) {
    snap = m; arena = MAPS[m.map] || arena; snapT = performance.now();
    if (m.ph !== lastPh) {
      if (m.ph === 'count' || (m.ph === 'play' && $('game').style.display !== 'block')) { resetClient(); show('game'); resize(); }
      if (m.ph === 'play') { $('cd').style.display = 'flex'; $('cd').innerHTML = '<span style="font-size:.5em">FIGHT!</span>'; snd(220, .3, 'sawtooth', .07, 880); setTimeout(() => { if (lastPh === 'play') $('cd').style.display = 'none' }, 800); }
      lastPh = m.ph;
    }
    if (m.ph === 'count') { const n = Math.ceil(m.left / 1000); if (n !== cdN && n > 0) { cdN = n; $('cd').style.display = 'flex'; $('cd').innerHTML = `<span>${n}</span>`; snd(440, .12, 'sine', .07); } }
    const ids = new Set();
    for (const [id, x, y, a, hp, al, k, d, sh, respawnMs, dashMs, weapon, ammo, reloadMs, team, energy, boosting, dashRemaining, boostLocked] of m.p) {
      ids.add(id); let e = ents.get(id); if (!e) { e = { x, y }; ents.set(id, e); }
      if (id === me) { if (!pred.init || (al && !pred.al) || Math.hypot(pred.x - x, pred.y - y) > 80) { pred.x = x; pred.y = y; pred.init = true; pred.dU = pred.dC = 0; } pred.al = !!al;pred.energy=energy ?? 100;pred.boost=!!boosting;pred.boostLocked=!!boostLocked;if(dashRemaining>0)pred.dU=Math.max(pred.dU,performance.now()+dashRemaining); if (hp < e.hp) { flash = 1; if (!RM) shake = 10; snd(120, .15, 'sawtooth', .08, 60); } }
      Object.assign(e, { tx: x, ty: y, a, hp, al, k, d, sh, respawnMs, dashMs, weapon, ammo, reloadMs, team, energy, boosting });
    }
    for (const id of ents.keys()) if (!ids.has(id)) ents.delete(id);
    bul = m.b.map(([id, x, y, a, weapon]) => { if (!seen.has(id)) { seen.add(id); burst(x, y, '#ffe066', 4, 110); } return { x, y, a, weapon }; });
    if (seen.size > 400) seen = new Set(m.b.map(b => b[0]));
  },
  object(m){burst(m.x,m.y,m.type==='barrel'?'#ff986b':'#cfa66a',m.type==='barrel'?40:15,240);if(m.type==='barrel')snd(90,.2,'sawtooth',.06,35);},
  pad(m){burst(m.x,m.y,'#a6b6ff',12,100);if(m.id===me){noticeText='BOOST PAD!';noticeUntil=performance.now()+900;}},
  pong(m) { latency=Math.round(performance.now()-m.at); },
  pickup(m) { burst(m.x,m.y,'#8aeeab',18,150); if(m.id===me){noticeText='ARMOR RESTORED +'+m.healed;noticeUntil=performance.now()+1800;snd(440,.2,'sine',.06,880);} },
  weapon(m) { const w=WEAPONS[m.weapon];if(!w)return;burst(m.x,m.y,w.color,16,130);if(m.id===me){noticeText=w.name.toUpperCase()+' EQUIPPED';noticeUntil=performance.now()+1800;snd(440,.15,'triangle',.06,880);} },
  fx(m) {
    burst(m.x,m.y,'#ff4d6d',8,200);
    if(m.kid===me){hitUntil=performance.now()+180;hitLabels.push({x:m.x,y:m.y,damage:m.damage || C.DMG,until:performance.now()+650});if(hitLabels.length>20)hitLabels.shift();snd(850,.045,'triangle',.04,1100);}
    if(m.v===me){vibrate(35);damageUntil=performance.now()+500;damageAngle=(m.a || 0)+Math.PI;snd(120,.1,'sawtooth',.05,70);}
  },
  kill(m) {
    burst(m.x, m.y, col(m.vid), 36, 320); snd(100, .4, 'sawtooth', .07, 30); if (m.kid === me) snd(660, .15, 'triangle', .08, 990);
    feed.push({ t: Date.now(), s: `<b style="color:${col(m.kid)}">${esc(m.k)}</b> ➜ ${esc(m.v)}` }); feed = feed.slice(-4);
  },
};
function lobbyUI() {
  const settings=R.settings || {map:'neon',minutes:3,target:10};
  for(const [id,value] of [['map-choice',settings.map],['match-minutes',settings.minutes],['kill-target',settings.target],['match-mode',settings.mode || 'ffa'],['bot-difficulty',settings.difficulty || 'normal']]){ $(id).value=String(value);$(id).disabled=R.host!==me || R.ph!=='lobby'; }
  $('map-description').textContent=arena.description;
  $('settings-help').textContent=R.host===me?'Changes reset player readiness.':'The host chooses the match settings.';
  $('mission').innerHTML=(settings.mode && settings.mode!=='ffa'?'TEAM BATTLE':'FREE FOR ALL')+' <span>FIRST TO '+settings.target+' KILLS</span>';
  previewMap();
  $('player-count').textContent = `Players ${R.ps.length} / ${C.MAX_PLAYERS}`;
  $('pl').innerHTML = R.ps.map(p => `<div class="pl"><span class="dot" style="background:${(R.settings?.mode && R.settings.mode!=='ffa'?(p.team===0?'#6b9cff':'#ff986b'):col(p.id))}"></span>${esc(p.n)}${R.settings?.mode && R.settings.mode!=='ffa'?(p.team===0?' [Blue]':' [Orange]'):''}${p.bot ? ' (bot)' : p.id === me ? ' (you)' : ''}<span class="tag ${p.r || p.id === R.host ? 'ok' : ''}">${!p.on ? 'offline' : p.id === R.host ? 'HOST' : p.r ? 'READY' : 'not ready'}</span></div>`).join('');
  const host = R.host === me; $('add-bot').hidden=$('remove-bots').hidden=!host; $('add-bot').disabled=R.ps.length>=C.MAX_PLAYERS; const others = R.ps.filter(p => p.id !== R.host), all = others.every(p => p.r && p.on), mine = R.ps.find(p => p.id === me);
  $('rd').style.display = host ? 'none' : 'block'; $('st').style.display = host ? 'block' : 'none'; const required=settings.mode==='2v2'?4:settings.mode==='4v4'?8:0;$('st').disabled = !all || R.ps.length<2 || (!!required && R.ps.length!==required);
  if(required && R.ps.length!==required)$('settings-help').textContent=`This mode needs ${required} players. Add bots or invite friends.`;
  $('rd').textContent = mine && mine.r ? 'Not ready' : 'Ready'; $('lh').textContent = host ? (R.ps.length<2 ? 'Invite a friend or add a practice bot.' : all ? 'Everyone is ready — start when you like.' : 'Waiting for players to ready up…') : 'Waiting for the host to start…';
}
function previewMap(){
  const preview=$('map-preview'),ctx=preview.getContext('2d');ctx.clearRect(0,0,450,280);ctx.fillStyle='#101e2b';ctx.fillRect(0,0,450,280);
  ctx.strokeStyle=arena.color;ctx.lineWidth=2;ctx.strokeRect(1,1,448,278);ctx.fillStyle='#47657d';
  for(const [x,y,w,h] of arena.obstacles)ctx.fillRect(x/2,y/2,w/2,h/2);
  for(const [x,y] of arena.supplies){ctx.fillStyle='#8aeeab';ctx.font='bold 14px system-ui';ctx.textAlign='center';ctx.fillText('+',x/2,y/2+5);}
  for(const [x,y,type] of weaponPads(arena)){const weapon=WEAPONS[type];ctx.fillStyle=weapon.color;ctx.font='bold 10px system-ui';ctx.fillText(weapon.label,x/2,y/2+4);}
  for(const [x,y] of arena.spawns){ctx.fillStyle='#6b9cff';ctx.beginPath();ctx.arc(x/2,y/2,3,0,Math.PI*2);ctx.fill();}
}
function showEnd() {
  const r = R.res || [], host = R.host === me, wasOpen=$('end').style.display==='flex'; if (lastPh === 'lobby' && !snap) return;
  $('et').textContent = r[0] ? `🏆 ${esc(r[0].n)} wins!` : 'Match over';
  if(R.settings?.mode && R.settings.mode!=='ffa')$('et').textContent=R.teamWinner==='draw'?'Teams tied!':R.teamWinner===0?'Blue team wins!':'Orange team wins!';
  const ready=R.ps.filter(p=>p.r).length,mine=R.ps.find(p=>p.id===me);$('back-lobby').hidden=!host;$('rematch-status').textContent=ready+' / '+R.ps.length+' ready for rematch';$('ag').textContent=mine?.r?'Cancel ready':'Ready for rematch';
  $('er2').innerHTML = r.map((x, i) => `<div class="pl"><span style="width:28px;font-size:1.2em">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="dot" style="background:${col(x.id)}"></span>${esc(x.n)}${x.id === me ? ' (you)' : ''}<span class="tag" style="background:#0d0f20">${x.k}K · ${x.d}D</span></div>`).join('');
  $('ag').style.display = 'block'; $('ew').style.display='none'; $('cd').style.display = 'none'; $('ps').style.display = 'none'; paused = false; $('end').style.display = 'flex'; resetInput(); (host ? $('ag') : $('ql2')).focus(); if(!wasOpen)snd(520, .5, 'triangle', .08, 1040);
}
function resetClient() { hitUntil=damageUntil=0;hitLabels.length=0;resetInput(); lessonStep=lessonProgress=0; noticeUntil = 0; paused = false; $('ps').style.display = 'none'; keys = {}; mouseDown = false; sticks.L = sticks.R = null; feed = []; bul = []; seen = new Set(); cdN = 0; pred.init = false; $('end').style.display = 'none'; for (const p of pool) p.l = 0; }

$('mk').onclick=()=>{practice=false;teaching=false;join('new');};
$('practice').onclick=()=>{teaching=false;practice=true;join('new');};
$('tutorial').onclick=()=>{teaching=true;practice=true;join('new');};
$('rejoin').onclick=()=>{practice=false;teaching=false;join(store.get('room'),true);};
for(const id of ['map-choice','match-minutes','kill-target','match-mode','bot-difficulty']) $(id).onchange=()=>send({t:'settings',map:$('map-choice').value,minutes:Number($('match-minutes').value),target:Number($('kill-target').value),mode:$('match-mode').value,difficulty:$('bot-difficulty').value});
$('add-bot').onclick=()=>send({t:'bot'});$('remove-bots').onclick=()=>send({t:'removeBots'});
$('control-mode').value=prefs.mode || 'auto';$('stick-size').value=prefs.size || 55;
$('left-handed').checked=!!prefs.left;$('separate-fire').checked=!!prefs.fire;
for(const id of ['control-mode','stick-size','left-handed','separate-fire']) $(id).onchange=()=>{
  prefs.mode=$('control-mode').value;prefs.size=Number($('stick-size').value);prefs.left=$('left-handed').checked;prefs.fire=$('separate-fire').checked;
  try{localStorage.setItem('ac_controls',JSON.stringify(prefs));}catch{}resetInput();updateControls();
};
updateControls();updateRejoin();
$('jn').onclick = () => { practice=false;teaching=false; const c = $('cdi').value.trim().toUpperCase(); if (!/^[A-Z0-9]{4}$/.test(c)) return err('Room code must be 4 characters'); join(c); };
$('cdi').onkeydown = $('nm').onkeydown = e => { if (e.key === 'Enter') ($('cdi').value ? $('jn') : $('mk')).click(); };
$('rd').onclick = () => { const m = R.ps.find(p => p.id === me); send({ t: 'ready', v: !(m && m.r) }); };
$('st').onclick = () => send({ t: 'start' });
$('back-lobby').onclick=()=>send({t:'again'});
$('ag').onclick=()=>send({t:'rematch',v:!R.ps.find(p=>p.id===me)?.r});
$('lv').onclick = $('ql').onclick = $('ql2').onclick = leave;
$('cp').onclick = async () => { try { await navigator.clipboard.writeText(code); $('cp').textContent = 'Copied ✓'; } catch { $('cp').textContent = 'Code: ' + code; } setTimeout(() => $('cp').textContent = 'Copy code', 1800); };
$('share-room').onclick=async()=>{ const url=invitation(); try{if(navigator.share){await navigator.share({title:'Join my Arena Clash room',text:'Room '+code,url});$('invite-status').textContent='Invitation shared';}else{await navigator.clipboard.writeText(url);$('invite-status').textContent='Invitation link copied';}}catch(e){$('invite-status').textContent=e.name==='AbortError'?'':'Select and copy the invitation link below.';} };
$('reload').onclick=()=>send({t:'reload'});
$('pb').onclick = () => setPause(true); $('rs').onclick = () => setPause(false);
$('volume').value=prefs.volume ?? 70;$('vibration').checked=!!prefs.vibration;$('graphics').value=prefs.graphics || 'high';
for(const id of ['volume','vibration','graphics'])$(id).onchange=()=>{prefs.volume=Number($('volume').value);prefs.vibration=$('vibration').checked;prefs.graphics=$('graphics').value;try{localStorage.setItem('ac_controls',JSON.stringify(prefs));}catch{}resize();};
$('score-toggle').onclick=()=>{const expanded=$('score-toggle').getAttribute('aria-expanded')!=='true';$('score-toggle').setAttribute('aria-expanded',String(expanded));document.body.classList.toggle('scores-open',expanded);};
$('snd').textContent=mute?'Sound off':'Sound on';
$('snd').onclick = () => { mute = !mute;prefs.muted=mute;try{localStorage.setItem('ac_controls',JSON.stringify(prefs));}catch{} $('snd').textContent = mute ? '🔇 Sound off' : '🔊 Sound on'; };
function setPause(v) { paused = v; $('ps').style.display = v ? 'flex' : 'none'; if (v) { resetInput(); $('rs').focus(); } else $('pb').focus(); }

/* ---------- input ---------- */
let keys = {}, mouseDown = false, fireHeld = false, boostHeld = false, mouse = { x: 0, y: 0 }, aimA = 0, dashN = 0; const sticks = { L: null, R: null }, pid = {};
const ac = new AbortController(), opt = { signal: ac.signal };
addEventListener('keydown', e => {
  if (!$('game').style.display || $('game').style.display === 'none' || e.target.tagName === 'INPUT') return;
  const dialog = $('end').style.display==='flex' ? $('end') : paused ? $('ps') : null;
  if(dialog && e.key==='Tab') { const nodes=[...dialog.querySelectorAll('button,input,select')].filter(el=>!el.disabled && !el.hidden && el.style.display!=='none'); const first=nodes[0],last=nodes.at(-1); if(e.shiftKey && document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey && document.activeElement===last){first.focus();e.preventDefault();}return; }
  if($('end').style.display==='flex')return;
  const k = e.key.toLowerCase();
  if (k === 'escape') return setPause(!paused);
  if (paused) return;
  if(prefs.mode !== 'touch')updateControls('mouse'); keys[k] = true; if(k==='r' && !e.repeat)send({t:'reload'}); if (k === ' ') { dash(); e.preventDefault(); } if (k.startsWith('arrow')) e.preventDefault();
}, opt);
addEventListener('keyup', e => { delete keys[e.key.toLowerCase()]; }, opt);
addEventListener('blur', resetInput, opt);
document.addEventListener('visibilitychange',()=>{if(document.hidden)resetInput();},opt);
const cv = $('cv'), cx = cv.getContext('2d');
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  if (paused || lastPh!=='play') return; updateControls(e.pointerType); cv.setPointerCapture(e.pointerId);
  if (e.pointerType === 'mouse') { if (e.button === 0) mouseDown = true; mouse = { x: e.offsetX, y: e.offsetY }; return; }
  const left = e.offsetX < cv.clientWidth / 2; const side = (prefs.left ? !left : left) ? 'L' : 'R'; if (sticks[side]) return;
  sticks[side] = { id: e.pointerId, ox: e.offsetX, oy: e.offsetY, x: e.offsetX, y: e.offsetY }; pid[e.pointerId] = side;
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { updateControls('mouse'); mouse = { x: e.offsetX, y: e.offsetY }; return; }
  const s = sticks[pid[e.pointerId]]; if (s) { s.x = e.offsetX; s.y = e.offsetY; }
});
const up = e => { if (e.pointerType === 'mouse') { mouseDown = false; return; } const side = pid[e.pointerId]; if (side) { sticks[side] = null; delete pid[e.pointerId]; } };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
$('fire').addEventListener('pointerdown',e=>{if(paused || lastPh!=='play')return; e.preventDefault();$('fire').setPointerCapture(e.pointerId);fireHeld=true;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('fire').addEventListener(type,()=>fireHeld=false);
$('boost').addEventListener('pointerdown',e=>{if(paused || lastPh!=='play')return;e.preventDefault();$('boost').setPointerCapture(e.pointerId);boostHeld=true;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('boost').addEventListener(type,()=>boostHeld=false);
$('dash').addEventListener('pointerdown', e => { e.stopPropagation(); dash(); });
function dash() { if (paused || lastPh !== 'play' || !pred.al) return; if (tryDash(pred, performance.now())) { dashN = (dashN + 1) % 1000; snd(150, .15, 'sawtooth', .05, 500); } else return; }
const stickSize = () => Number(prefs.size) || 55;
function vec(s) { if (!s) return [0, 0, 0]; const dx = s.x - s.ox, dy = s.y - s.oy, l = Math.hypot(dx, dy); return [Math.min(1, l / stickSize()) * (l ? dx / l : 0), Math.min(1, l / stickSize()) * (l ? dy / l : 0), l]; }
let view = { s: 1, vw: C.W, vh: C.H, cx: 0, cy: 0 }, cam = { x: 0, y: 0 };
function readInput() {
  let mx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), my = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0), f = mouseDown || fireHeld;
  const [lx, ly] = vec(sticks.L), [rx, ry, rl] = vec(sticks.R); mx += lx; my += ly;
  if (sticks.R) { f = fireHeld || (!prefs.fire && rl > 12); if (rl > 12) aimA = Math.atan2(ry, rx); }
  else if (!touch || mouse.x) { const px = (pred.x - cam.x) * view.s, py = (pred.y - cam.y) * view.s; if (mouseDown || !touch) aimA = Math.atan2(mouse.y - py, mouse.x - px); }
  return { mx: Math.max(-1, Math.min(1, mx)), my: Math.max(-1, Math.min(1, my)), a: aimA, f, boost:boostHeld || !!keys.shift };
}
let lastSent = 0;

/* ---------- viewport / camera: equal visible AREA on every screen => fair on any monitor ---------- */
const AREA = 640 * 400;
function resize() {
  const w = cv.clientWidth || innerWidth, h = cv.clientHeight || innerHeight, dpr = Math.min(devicePixelRatio || 1, prefs.graphics==='low'?1:2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ar = w / h; let vw = Math.sqrt(AREA * ar), vh = vw / ar;
  if (vw > C.W) { vw = C.W; vh = vw / ar; } if (vh > C.H) { vh = C.H; vw = vh * ar; }
  view = { s: w / vw, vw, vh, dpr, w, h };
}
new ResizeObserver(resize).observe(cv); addEventListener('resize', resize, opt); addEventListener('orientationchange', () => setTimeout(resize, 250), opt);
if (window.visualViewport) visualViewport.addEventListener('resize', resize, opt);

/* ---------- particles (fixed pool, no per-frame allocation) ---------- */
const pool = Array.from({ length: 360 }, () => ({ l: 0, x: 0, y: 0, vx: 0, vy: 0, c: '', s: 2 })); let pi = 0;
function burst(x, y, c, n = 10, sp = 200) { if (RM || prefs.graphics==='low') n = Math.ceil(n / 3); for (let i = 0; i < n; i++) { const p = pool[pi = (pi + 1) % pool.length], a = Math.random() * 6.283, v = sp * (.3 + Math.random() * .7); p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.l = .5 + Math.random() * .4; p.c = c; p.s = 2 + Math.random() * 3; } }

/* ---------- render loop ---------- */
let last = performance.now(), hudT = 0, dashPrev = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if ($('game').style.display !== 'block') { last = t; return; }
  const dt = Math.min(.05, (t - last) / 1000); last = t; const now = performance.now(), play = lastPh === 'play';
  const inp = paused || document.hidden || !ws || ws.readyState !== 1 ? { mx: 0, my: 0, a: aimA, f: false } : readInput();
  if (pred.init && pred.al && play) {
    updateBoost(pred,inp.boost,dt);pred.a = inp.a; move(pred, inp.mx, inp.my, dt, now, obstacles());
    const e = ents.get(me); if (e) { const k = 1 - Math.exp(-dt * 8); pred.x += (e.tx - pred.x) * k; pred.y += (e.ty - pred.y) * k; }
  }
  if (now - lastSent > 33 && (play || lastPh === 'count')) { lastSent = now; send({ t: 'in', mx: +inp.mx.toFixed(2), my: +inp.my.toFixed(2), a: +inp.a.toFixed(2), f: inp.f && !paused, boost:!!inp.boost, d: dashN }); }
  for (const [id, e] of ents) if (id !== me && e.tx !== undefined) { const k = 1 - Math.exp(-dt * 18); e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; }
  for (const p of pool) if (p.l > 0) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .92; p.vy *= .92; p.l -= dt; }
  shake *= .88; flash *= .9; const me_ = ents.get(me); dispHp += ((me_ ? me_.hp : 100) - dispHp) * .2;
  if(play && now-pingAt>2000 && ws?.readyState===1){pingAt=now;send({t:'ping',at:now});}
  if(teaching && play && !paused){
    const tasks=['Move your tank using WASD or the movement stick.','Aim and fire at a bot.','Dash using Space / Shift or the DASH button.'];
    if(lessonStep===0 && Math.hypot(inp.mx,inp.my)>.2)lessonProgress+=dt;
    if(lessonStep===1 && inp.f)lessonProgress+=dt;
    if(lessonStep===2 && now<pred.dU)lessonProgress=2;
    if(lessonProgress>1.2){lessonStep++;lessonProgress=0;}
    $('lesson').textContent=lessonStep<3 ? (lessonStep+1)+'/3 '+tasks[lessonStep] : 'Training complete! Fight the bots and collect green health supplies.';
  }else $('lesson').textContent='';
  draw(now); hud(now);
}
function tank(x, y, a, c, hp, al, n, you, t, sh) {
  cx.save(); if (!al) cx.globalAlpha = .2;
  cx.save(); cx.translate(x,y); cx.rotate(a); cx.fillStyle='#080f19'; cx.strokeStyle=c; cx.lineWidth=1;
  for (const offset of [-19,11]) { cx.fillRect(-17,offset,34,8); cx.strokeRect(-17,offset,34,8); cx.fillStyle='#334355'; for(let i=-13;i<15;i+=7)cx.fillRect(i,offset+1,3,6);cx.fillStyle='#080f19'; }
  cx.restore();
  cx.shadowColor = c; cx.shadowBlur = prefs.graphics==='low'?0:you ? 20 : 10; cx.fillStyle = c; cx.beginPath(); cx.arc(x, y, C.R, 0, 7); cx.fill(); cx.shadowBlur = 0;
  cx.strokeStyle = you ? '#fff' : '#ffffffaa'; cx.lineWidth = you ? 3 : 1.5; cx.stroke();
  cx.translate(x, y); cx.rotate(a); cx.fillStyle = '#111a'; cx.fillRect(2, -4, C.R + 8, 8); cx.fillStyle = '#fff'; cx.fillRect(C.R, -3, 8, 6); cx.restore();
  if (!al) return;
  if (sh) { cx.strokeStyle = `rgba(120,200,255,${.5 + .3 * Math.sin(t / 80)})`; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, y, C.R + 7, 0, 7); cx.stroke(); }
  cx.fillStyle = '#fff'; cx.font = '12px system-ui'; cx.textAlign = 'center'; cx.fillText(n, x, y - C.R - 14);
  cx.fillStyle = '#0009'; cx.fillRect(x - 19, y - C.R - 10, 38, 5); cx.fillStyle = hp > 50 ? '#3ccf85' : hp > 25 ? '#ffc247' : '#ff4d6d'; cx.fillRect(x - 19, y - C.R - 10, 38 * Math.max(0, hp) / 100, 5);
}
function draw(t) {
  const { s, vw, vh, dpr, w, h } = view; cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#05060d'; cx.fillRect(0, 0, cv.width, cv.height);
  const tx = pred.init ? pred.x : C.W / 2, ty = pred.init ? pred.y : C.H / 2;
  const cxT = vw >= C.W ? (C.W - vw) / 2 : Math.max(0, Math.min(C.W - vw, tx - vw / 2)), cyT = vh >= C.H ? (C.H - vh) / 2 : Math.max(0, Math.min(C.H - vh, ty - vh / 2));
  cam.x += (cxT - cam.x) * .2; cam.y += (cyT - cam.y) * .2;
  const sx = shake > .5 ? (Math.random() - .5) * shake : 0, sy = shake > .5 ? (Math.random() - .5) * shake : 0;
  cx.setTransform(s * dpr, 0, 0, s * dpr, (-cam.x * s + sx) * dpr, (-cam.y * s + sy) * dpr);
  cx.fillStyle = '#101e2b'; cx.fillRect(0, 0, C.W, C.H); cx.strokeStyle = '#ffffff0d'; cx.lineWidth = 1; cx.beginPath();
  for (let i = 0; i <= C.W; i += 50) { cx.moveTo(i, 0); cx.lineTo(i, C.H); } for (let i = 0; i <= C.H; i += 50) { cx.moveTo(0, i); cx.lineTo(C.W, i); } cx.stroke();
  cx.strokeStyle = arena.color; cx.lineWidth = 4; cx.strokeRect(2, 2, C.W - 4, C.H - 4);
  cx.fillStyle = '#263d50'; cx.strokeStyle = '#6597bb'; cx.lineWidth = 2; for (const [x, y, ww, hh] of arena.obstacles) { cx.fillRect(x, y, ww, hh); cx.strokeRect(x, y, ww, hh); }
  for(const [x,y] of BOOST_PADS){cx.fillStyle='#263a69';cx.strokeStyle='#a6b6ff';cx.lineWidth=2;cx.beginPath();cx.arc(x,y,22,0,Math.PI*2);cx.fill();cx.stroke();cx.fillStyle='#a6b6ff';cx.font='bold 17px system-ui';cx.textAlign='center';cx.fillText('>>',x,y+6);}
  for(const [,type,x,y,hp] of snap?.objects || []){if(hp<=0)continue;cx.fillStyle=type==='barrel'?'#8d3f2c':'#74563a';cx.fillRect(x-14,y-14,28,28);cx.strokeStyle=type==='barrel'?'#ff986b':'#cfa66a';cx.strokeRect(x-14,y-14,28,28);cx.fillStyle='#fff';cx.font='bold 12px system-ui';cx.textAlign='center';cx.fillText(type==='barrel'?'!':'X',x,y+4);}
  for(const [x,y,type,cooldown] of snap?.weapons || []){const w=WEAPONS[type];if(!w)continue;cx.fillStyle=cooldown?'#182637':w.color;cx.fillRect(x-14,y-14,28,28);cx.strokeStyle=w.color;cx.strokeRect(x-14,y-14,28,28);cx.fillStyle=cooldown?'#8c9bb1':'#091321';cx.font='bold 14px system-ui';cx.textAlign='center';cx.fillText(cooldown?String(Math.ceil(cooldown/1000)):w.label,x,y+5);cx.fillStyle=w.color;cx.font='9px system-ui';cx.fillText(w.name,x,y-20);}
  for (const [x,y,cooldown] of snap?.supplies || []) {
    cx.save(); cx.translate(x,y); cx.strokeStyle=cooldown?'#34524b':'#8aeeab'; cx.fillStyle=cooldown?'#132c27':'#264f3f';
    cx.shadowColor='#8aeeab'; cx.shadowBlur=cooldown || RM || prefs.graphics==='low'?0:14; cx.fillRect(-12,-12,24,24); cx.strokeRect(-12,-12,24,24); cx.shadowBlur=0;
    cx.fillStyle=cooldown?'#75918b':'#a8ffc9'; cx.font='bold 19px system-ui'; cx.textAlign='center';cx.fillText(cooldown?String(Math.ceil(cooldown/1000)):'+',0,7);cx.restore();
  }
  const ex = Math.min(.1, (performance.now() - snapT) / 1000); cx.strokeStyle = '#ffe066'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.beginPath();
  for (const b of bul) { const x = b.x + Math.cos(b.a) * (WEAPONS[b.weapon]?.speed || C.BULLET_SPEED) * ex, y = b.y + Math.sin(b.a) * (WEAPONS[b.weapon]?.speed || C.BULLET_SPEED) * ex; cx.moveTo(x - Math.cos(b.a) * 9, y - Math.sin(b.a) * 9); cx.lineTo(x, y); } cx.stroke();
  for (const [id, e] of ents) { if (id === me || e.x === undefined) continue; const n = (R.ps.find(p => p.id === id) || {}).n || '?'; tank(e.x, e.y, e.a || 0, (R.settings?.mode && R.settings.mode!=='ffa'?(e.team===0?'#6b9cff':'#ff986b'):col(id)), e.hp, e.al, esc(n).slice(0, 12), false, t, e.sh); }
  const m = ents.get(me); if (m && pred.init) tank(pred.x, pred.y, pred.a, (R.settings?.mode && R.settings.mode!=='ffa'?(m.team===0?'#6b9cff':'#ff986b'):col(me)), dispHp, m.al, esc(name), true, t, m.sh);
  else if (lastPh === 'play' && m && !m.al) { cx.fillStyle = '#fff'; cx.font = 'bold 22px system-ui'; cx.textAlign = 'center'; cx.fillText('Respawning…', cam.x + vw / 2, cam.y + vh / 2); }
  if(m?.al && (pred.boost || t<pred.dU) && !RM){cx.strokeStyle='#8aeeab66';cx.lineWidth=7;cx.beginPath();cx.moveTo(pred.x-Math.cos(pred.a)*35,pred.y-Math.sin(pred.a)*35);cx.lineTo(pred.x-Math.cos(pred.a)*18,pred.y-Math.sin(pred.a)*18);cx.stroke();}
  for (const p of pool) if (p.l > 0) { cx.globalAlpha = Math.min(1, p.l * 1.6); cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.s, 0, 7); cx.fill(); } cx.globalAlpha = 1;
  for(let i=hitLabels.length-1;i>=0;i--){const label=hitLabels[i];if(t>=label.until){hitLabels.splice(i,1);continue;}cx.globalAlpha=Math.min(1,(label.until-t)/250);cx.fillStyle='#ffe066';cx.font='bold 15px system-ui';cx.textAlign='center';cx.fillText('-'+label.damage,label.x,label.y-20-(650-(label.until-t))/35);}cx.globalAlpha=1;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0); // screen-space overlays
  if(lastPh==='play' && m?.al && !paused){
    const x=touch?(pred.x+Math.cos(aimA)*100-cam.x)*s:mouse.x;
    const y=touch?(pred.y+Math.sin(aimA)*100-cam.y)*s:mouse.y;
    cx.strokeStyle=t<hitUntil?'#ffe066':'#ffffffbb';cx.lineWidth=1.5;cx.beginPath();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){cx.moveTo(x+dx*6,y+dy*6);cx.lineTo(x+dx*13,y+dy*13);}cx.stroke();
    if(t<hitUntil){cx.beginPath();for(const [dx,dy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){cx.moveTo(x+dx*4,y+dy*4);cx.lineTo(x+dx*9,y+dy*9);}cx.stroke();}
    if(t<damageUntil){const x=(pred.x-cam.x)*s,y=(pred.y-cam.y)*s;cx.strokeStyle='#ff657c';cx.lineWidth=4;cx.beginPath();cx.arc(x,y,48,damageAngle-.35,damageAngle+.35);cx.stroke();}
  }
  if (flash > .03) { const g = cx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 3, w / 2, h / 2, Math.max(w, h) * .7); g.addColorStop(0, '#ff284600'); g.addColorStop(1, `rgba(255,40,70,${flash * .55})`); cx.fillStyle = g; cx.fillRect(0, 0, w, h); }
  if(touch && !paused){for(const k of ['L','R']){const active=sticks[k];const left=prefs.left ? k==='R' : k==='L';const st=active || {ox:w*(left ? 0.2 : 0.8),oy:h-90};const [vx,vy]=active?vec(active):[0,0];cx.strokeStyle=active?'#ffffff88':'#ffffff35';cx.lineWidth=2;cx.beginPath();cx.arc(st.ox,st.oy,stickSize(),0,Math.PI*2);cx.stroke();cx.fillStyle=k==='R'?'#ff6d8b55':'#8aeeab44';cx.beginPath();cx.arc(st.ox+vx*stickSize(),st.oy+vy*stickSize(),22,0,Math.PI*2);cx.fill();if(!active){cx.fillStyle='#ffffff99';cx.font='10px system-ui';cx.textAlign='center';cx.fillText(k==='L'?'MOVE':'AIM / FIRE',st.ox,st.oy+stickSize()+16);}}}

}
function hud(t) {
  if (t - hudT < 120) return; hudT = t;
  const rows = [...ents].map(([id, e]) => ({ n: (id === me ? name : (R.ps.find(p => p.id === id) || {}).n || '?'), k: e.k || 0, c: R.settings?.mode && R.settings.mode!=='ffa'?(e.team===0?'#6b9cff':'#ff986b'):col(id), me: id === me })).sort((a, b) => b.k - a.k);
  $('sb').innerHTML = rows.map(r => `<div style="color:${r.c}">${esc(r.n)}${r.me ? ' •' : ''} <b style="float:right;margin-left:10px;color:#fff">${r.k}</b></div>`).join('');
  feed = feed.filter(f => Date.now() - f.t < 5000); $('feed').innerHTML = feed.map(f => `<div>${f.s}</div>`).join('');
  const sec = snap && lastPh === 'play' ? Math.max(0, Math.ceil((snap.left - (performance.now() - snapT)) / 1000)) : null;
  $('tm').textContent = sec == null ? '—' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const m = ents.get(me); $('hpb').style.width = Math.max(0, dispHp) + '%'; $('hpb').style.background = dispHp > 50 ? '#3ccf85' : dispHp > 25 ? '#ffc247' : '#ff4d6d';
  const target=R.settings?.target || C.TARGET; $('personal-score').textContent=m ? `${m.k || 0} / ${target} KILLS` : '';
  $('connection').textContent = ws?.readyState===1 ? (latency==null?'CONNECTED':latency+' ms') : 'RECONNECTING';
  const w=WEAPONS[m?.weapon] || WEAPONS.cannon, reloadLeft=Math.max(0,(m?.reloadMs || 0)-(performance.now()-snapT));
  $('boost-meter').hidden=touch && !!prefs.fire;
  $('boost-progress').style.width=(m?.energy ?? 100)+'%';$('boost').disabled=!m?.al || paused || lastPh!=='play';
  if(R.settings?.mode && R.settings.mode!=='ffa')$('personal-score').textContent='BLUE '+(snap?.scores?.[0] || 0)+' / ORANGE '+(snap?.scores?.[1] || 0);
  $('weapon-name').textContent=w.name.toUpperCase();
  $('weapon-symbol').setAttribute('href','/icons.svg#'+(WEAPONS[m?.weapon] ? m.weapon : 'cannon'));
  $('weapon-hud').setAttribute('aria-label',w.name);
  $('weapon-hud').setAttribute('title',w.name);$('ammo-count').textContent=(m?.ammo ?? w.magazine)+' / '+w.magazine;
  $('reload-progress').style.width=(reloadLeft ? Math.max(0,100-reloadLeft/w.reload*100) : 100)+'%';
  $('reload-status').textContent=reloadLeft ? (reloadLeft/1000).toFixed(1)+'s' : '';
  $('reload').disabled=!m?.al || reloadLeft>0 || m?.ammo===w.magazine || paused || lastPh!=='play';
  $('health-value').textContent = Math.max(0,Math.round(dispHp))+' / 100';
  const remaining = Math.max(0,(m?.dashMs || 0)-(performance.now()-snapT),pred.dC-performance.now());
  $('dash-progress').style.width = Math.max(0,100-remaining/C.DASH_CD*100)+'%';
  $('dash-status').textContent = remaining>0 ? (remaining/1000).toFixed(1)+'s' : '';
  $('dash').disabled = !m?.al || remaining>0 || paused || lastPh!=='play';
  $('notice').textContent = t<noticeUntil ? noticeText : '';
  $('respawn').textContent = m && !m.al && lastPh==='play' ? 'BACK IN '+Math.max(1,Math.ceil(((m.respawnMs||0)-(performance.now()-snapT))/1000))+'s' : '';
  $('bf').textContent = m && m.sh ? '🛡 Shield' : '';
}
requestAnimationFrame(frame);
addEventListener('pagehide', resetInput);
