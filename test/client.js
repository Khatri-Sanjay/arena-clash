// Exercise client input and reconnect flows without a browser or a running server.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { C, MAPS, WEAPONS, weaponPads, updateBoost, BOOST_PADS, objectRect, move, tryDash } from '../shared/game.js';
const html = fs.readFileSync('client/index.html', 'utf8');
const elements = new Map();
const handlers = {};
const memory = new Map();
const document = {
  activeElement: null, hidden: false,
  body: {classList:{toggle(){}}},
  getElementById(id) { assert.ok(elements.has(id), `element ${id} exists`); return elements.get(id); },
  querySelectorAll() { return [...elements.values()].filter(e => ['menu','lobby'].includes(e.id)); },
  addEventListener(type, fn) { handlers[type] = fn; },
};
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, {
  id, value:'', style:{}, hidden:false, disabled:false, checked:false, textContent:'', innerHTML:'',
  classList:{add(){},remove(){}}, events:{}, clientWidth:800,clientHeight:500,
  addEventListener(type,fn){this.events[type]=fn;}, setPointerCapture(){},
  focus(){document.activeElement=this;},getContext(){return new Proxy({}, {get:(obj,key)=>obj[key] || (()=>{}),set:(obj,key,v)=>(obj[key]=v,true)});},querySelectorAll(){return [];},
  attrs:{},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},
});
const sockets=[];
class Socket {
  constructor(){this.readyState=1;this.messages=[];sockets.push(this);}
  send(raw){this.messages.push(JSON.parse(raw));}
  close(){this.readyState=3;this.onclose?.();}
  receive(m){this.onmessage({data:JSON.stringify(m)});}
}
const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v))};
const context=vm.createContext({C,MAPS,WEAPONS,weaponPads,updateBoost,BOOST_PADS,objectRect,move,tryDash,document,console,URL,URLSearchParams,
  navigator:{clipboard:{async writeText(text){memory.set('clipboard',text);}}},
  window:{CFG:{}}, location:{protocol:'http:',host:'localhost',href:'http://localhost/?room=TEST',search:'?room=TEST'},
  sessionStorage:storage,localStorage:storage, WebSocket:Socket,
  matchMedia:()=>({matches:false}),performance:{now:()=>1000},
  setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},
  ResizeObserver:class{observe(){}},AbortController,
  innerWidth:800,innerHeight:500,devicePixelRatio:1,
  addEventListener(type,fn){handlers[type]=fn;},
});
vm.runInContext(fs.readFileSync('client/main.js','utf8').replace(/^import .*\r?\n/,''),context);
const $=id=>elements.get(id);
assert.equal($('cdi').value,'TEST','invitation fills room code');
assert.equal($('friends-panel').hidden,false);
$('nm').value='Tester';$('practice').onclick();
let ws=sockets.at(-1);ws.onopen();
assert.equal(ws.messages[0].room,'new');
ws.receive({t:'welcome',id:1,code:'TEST',tok:'token'});
assert.equal(ws.messages.filter(m=>m.t==='bot').length,2);
assert.ok(ws.messages.some(m=>m.t==='start'));
assert.equal(memory.get('room'),'TEST');
await $('share-room').onclick();
assert.equal(memory.get('clipboard'),'http://localhost/?room=TEST','share fallback copies invitation');
ws.receive({t:'room',ph:'count',code:'TEST',host:1,ps:[{id:1,n:'Tester',on:true}]});
ws.receive({t:'room',ph:'lobby',code:'TEST',host:1,settings:{map:'pillars',minutes:5,target:20},ps:[{id:1,n:'Tester',on:true}]});
assert.equal($('map-choice').value,'pillars');
assert.equal($('map-choice').disabled,false);
$('kill-target').value='5';$('kill-target').onchange();
assert.equal(ws.messages.at(-1).target,5);
ws.receive({t:'room',ph:'count',code:'TEST',host:2,settings:{map:'pillars',minutes:5,target:20},ps:[{id:1,n:'Tester',on:true}]});
assert.equal($('map-choice').disabled,true,'guest cannot change settings');
ws.receive({t:'s',ph:'play',left:180000,p:[[1,450,280,0,100,1,0,0,0,0,0]],b:[],supplies:[]});
ws.receive({t:'fx',x:500,y:280,kid:1,v:2,damage:25,a:0});
assert.equal(vm.runInContext('hitLabels[0].damage',context),25,'server hit produces damage feedback');
vm.runInContext('draw(1000)',context);
assert.equal($('game').style.display,'block');
for (const weapon of ['heavy', 'twin', 'cannon']) {
  vm.runInContext(`ents.get(1).weapon='${weapon}'; hudT=0; hud(1000)`, context);
  assert.equal($('weapon-symbol').getAttribute('href'), '/icons.svg#'+weapon, 'HUD icon follows weapon pickup');
  assert.equal($('weapon-hud').getAttribute('aria-label'), WEAPONS[weapon].name, 'weapon remains accessible');
}
ws.receive({t:'s',ph:'play',left:180000,p:[[1,450,280,0,100,1,0,0,0,0,0,'twin',8]],b:[[123,478,275,0,'twin',1]],supplies:[]});
assert.equal(vm.runInContext('ents.get(1).fireUntil',context),1090,'new tank shell triggers turret recoil');
vm.runInContext('pred.hullA=Math.PI/2; draw(1000)',context);
assert.equal(vm.runInContext('pred.hullA',context),Math.PI/2,'drawing turret preserves independent hull direction');

const pointer={pointerType:'touch',pointerId:1,offsetX:600,offsetY:300,stopPropagation(){}};
$('aim-stick').events.pointerdown(pointer);
assert.equal(vm.runInContext('readInput().f',context),false,'touch aim dead zone does not fire');
$('cv').events.pointermove({...pointer,offsetX:630});
assert.equal(vm.runInContext('readInput().f',context),true,'dragging aim fires');
handlers.blur();
assert.equal(vm.runInContext('readInput().f',context),false,'blur resets touch controls');
$('separate-fire').checked=true;$('separate-fire').onchange();
$('aim-stick').events.pointerdown(pointer);
$('cv').events.pointermove({...pointer,offsetX:630});
assert.equal(vm.runInContext('readInput().f',context),false,'separate fire mode aims without firing');
$('fire').events.pointerdown({preventDefault(){},pointerId:2});
assert.equal(vm.runInContext('readInput().f',context),true,'fire button shoots');
$('fire').events.pointercancel();
assert.equal(vm.runInContext('readInput().f',context),false,'cancel releases fire');
$('boost').events.pointerdown({preventDefault(){},pointerId:3});
assert.equal(vm.runInContext('readInput().boost',context),true);
handlers.blur();assert.equal(vm.runInContext('readInput().boost',context),false,'blur resets boost');
$('score-toggle').onclick();assert.equal($('score-toggle').getAttribute('aria-expanded'),'true');
$('volume').value='25';$('graphics').value='low';$('vibration').checked=true;$('volume').onchange();
assert.equal(JSON.parse(memory.get('ac_controls')).volume,25,'device settings saved');
$('rejoin').onclick();ws=sockets.at(-1);ws.onopen();
assert.equal(ws.messages[0].tok,'token');
assert.equal(ws.messages[0].room,'TEST');
ws.receive({t:'welcome',id:1,code:'TEST',tok:'token'});
ws.receive({t:'room',ph:'play',code:'TEST',host:1,ps:[{id:1,n:'Tester',on:true}]});
ws.receive({t:'s',ph:'play',left:150000,p:[[1,450,280,0,100,1,0,0,0,0,0]],b:[],supplies:[]});
assert.equal($('game').style.display,'block','rejoin during play displays arena');
ws.receive({t:'room',ph:'end',code:'TEST',host:1,settings:{map:'neon',mode:'2v2'},teamWinner:0,ps:[{id:1,n:'Tester',on:true,r:false}],res:[{id:1,n:'Tester',k:2,d:1}]});
assert.equal($('et').textContent,'Blue team wins!');
$('ag').onclick();assert.equal(ws.messages.at(-1).t,'rematch');assert.equal(ws.messages.at(-1).v,true);
$('ql').onclick();assert.equal(memory.get('room'),'');
console.log('PASS client practice setup, touch dead zone, input reset, rejoin and leave');

// Thumb zones must remain inside the screen even with large joystick preferences.
for (const [width, height] of [[320,568],[360,640],[390,844],[430,932],[568,320],[844,390],[768,1024]]) {
  $('cv').clientWidth=width; $('cv').clientHeight=height;
  vm.runInContext('prefs.size=90; resize(); safeInsets={left:20,right:20,top:24,bottom:34}',context);
  const radius=vm.runInContext('stickSize()',context);
  for (const [x,y] of [[0,0],[width,height],[width*.2,height-90],[width*.8,height-90]]) {
    const origin=vm.runInContext(`stickOrigin(${x},${y})`,context);
    assert.ok(origin.x-radius>=20 && origin.x+radius<=width-20, `${width}x${height}: horizontal joystick bounds`);
    assert.ok(origin.y-radius>=24 && origin.y+radius<=height-34, `${width}x${height}: vertical joystick bounds`);
  }
  vm.runInContext('sticks.L={x:1,y:1,ox:0,oy:0}; resize()',context);
  assert.equal(vm.runInContext('sticks.L',context),null,'viewport changes release movement');
}
console.log('PASS responsive joystick bounds and rotation input reset across seven viewport sizes');

vm.runInContext("teaching=true; lastPh='play'; noticeText='CANNON EQUIPPED'; noticeUntil=2000; hudT=0; hud(1000)",context);
assert.equal($('tutorial-tip').hidden,true,'pickup notices temporarily replace tutorial tips');
$('ban').style.display='block';
vm.runInContext('hudT=0; hud(1000)',context);
assert.equal($('notice').textContent,'','connection warning takes priority over pickup notices');
assert.equal($('tutorial-tip').hidden,true);
$('ban').style.display='none';
vm.runInContext('noticeUntil=0; hudT=0; hud(1000)',context);
assert.equal($('tutorial-tip').hidden,false,'tutorial returns once other messages clear');
$('dismiss-tip').onclick();
assert.equal(vm.runInContext('teaching',context),false,'tutorial can be dismissed');
assert.equal($('tutorial-tip').hidden,true);
$('score-toggle').onclick();
$('cv').events.pointerdown({...pointer,pointerId:8});
assert.equal($('score-toggle').getAttribute('aria-expanded'),'false','touching arena closes scores');
vm.runInContext('setPause(true)',context);
assert.equal($('ps').style.display,'flex');
vm.runInContext('setPause(false)',context);
assert.equal($('ps').style.display,'none');
console.log('PASS popup priority, dismissible tutorial, scoreboard dismissal and pause resume');

for (const [width,height] of [[320,568],[390,844],[568,320],[667,375],[844,390],[1024,768]]) {
  $('cv').clientWidth=width; $('cv').clientHeight=height;
  vm.runInContext('touch=true; prefs.size=90; safeInsets={left:20,right:20,top:24,bottom:34}; resize(); pred.init=true; pred.x=20; pred.y=20; draw(1000)',context);
  const bounds=vm.runInContext('view.bounds',context);
  assert.ok(bounds.width>150 && bounds.height>90,`${width}x${height}: usable arena`);
  assert.ok(vm.runInContext('view.s',context)>=.75,'mobile camera keeps tanks readable');
  const player=vm.runInContext('({x:view.bounds.x+(pred.x-cam.x)*view.s,y:view.bounds.y+(pred.y-cam.y)*view.s})',context);
  assert.ok(Math.abs(player.x-bounds.x-bounds.width/2)<1e-8,'tank centered horizontally, including at map edges');
  assert.ok(Math.abs(player.y-bounds.y-bounds.height/2)<1e-8,'tank centered vertically');
  const home=vm.runInContext('stickHome(true)',context), radius=vm.runInContext('stickSize()',context);
  assert.ok(width>height ? home.x+radius<bounds.x : home.y-radius>bounds.y+bounds.height,'movement stick sits outside arena');
}
let fullscreens=0, locks=0, unlocks=0;
context.document.documentElement={async requestFullscreen(){fullscreens++;document.fullscreenElement=true;}};
context.document.exitFullscreen=async()=>{document.fullscreenElement=false;};
context.window.screen={orientation:{async lock(value){assert.equal(value,'landscape');locks++;},unlock(){unlocks++;}}};
await vm.runInContext('landscapeMode()',context);
assert.equal(fullscreens,1); assert.equal(locks,1);
vm.runInContext('releaseLandscape()',context);
assert.equal(unlocks,1); assert.equal(document.fullscreenElement,false);
context.window.screen.orientation.lock=async()=>{throw new Error('Unsupported');};
await vm.runInContext('landscapeMode()',context);
delete context.document.documentElement; delete context.window.screen;
console.log('PASS clear arena, centered tank, control gutters, landscape request and unsupported-browser fallback');

vm.runInContext("lastPh='play';paused=false;prefs.fire=false;resetInput();resize()",context);
$('cv').events.pointerdown(pointer);
assert.equal(vm.runInContext('sticks.R',context),null,'touching arena does not steer turret');
$('move-stick').events.pointerdown({...pointer,pointerId:21,offsetX:60});
$('aim-stick').events.pointerdown({...pointer,pointerId:22});
$('cv').events.pointermove({...pointer,pointerId:21,offsetX:90});
$('cv').events.pointermove({...pointer,pointerId:22,offsetX:630});
const dual=vm.runInContext('readInput()',context);
assert.ok(dual.mx>0 && dual.f,'movement and cannon fire work together');
vm.runInContext('updateTouchPads()',context);
assert.equal($('move-stick').getAttribute('data-active'),'true');
assert.equal($('aim-stick').getAttribute('data-active'),'true');
$('cv').events.pointercancel({...pointer,pointerId:22});
assert.equal(vm.runInContext('readInput().f',context),false,'canceling aim releases fire while moving');
assert.ok(vm.runInContext('readInput().mx',context)>0);
vm.runInContext('prefs.left=true; resetInput(); resize()',context);
assert.ok(parseFloat($('move-stick').style.left)>parseFloat($('aim-stick').style.left),'left-handed pads mirror');
$('move-stick').events.pointerdown({...pointer,pointerId:23});
assert.equal(vm.runInContext('sticks.L.id',context),23,'mirrored move pad retains movement role');
vm.runInContext('resize();updateTouchPads()',context);
assert.equal($('move-stick').getAttribute('data-active'),'false','rotation returns knob to neutral');
vm.runInContext("on.kill({kid:2,vid:1,k:'Bot 3',v:'Tester',x:450,y:280})",context);
vm.runInContext('hudT=0;hud(1000)',context);
assert.ok($('feed').innerHTML.includes('feed-name'),'elimination names have bounded layout');
console.log('PASS explicit joystick pads, simultaneous drive/fire, pointer cancel, handedness and bounded feed');
