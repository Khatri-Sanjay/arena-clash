// Shared by server (authoritative) and client (prediction). Logical world units, never CSS pixels.
export const C = {
  W: 900, H: 560, R: 16, TICK: 30,
  SPEED: 230, DASH_SPEED: 680, DASH_MS: 170, DASH_CD: 1200,
  BULLET_SPEED: 740, BULLET_LIFE: 1.1, FIRE_CD: 260, DMG: 25, HP: 100,
  RESPAWN: 3000, SHIELD: 2000, COUNT: 3500, MATCH: 180000, TARGET: 10,
  MAX_PLAYERS: 8, GRACE: 20000,
};
export const OB = [[380,200,140,30],[380,330,140,30],[200,100,30,120],[670,100,30,120],[200,340,30,120],[670,340,30,120]];
export const SPAWNS = [[60,60],[840,60],[60,500],[840,500],[450,60],[450,500],[60,280],[840,280]];
export const hitRect = (x, y, [rx, ry, rw, rh], r) => {
  const a = Math.max(rx, Math.min(x, rx + rw)), b = Math.max(ry, Math.min(y, ry + rh));
  return (x - a) ** 2 + (y - b) ** 2 < r * r;
};
export function collide(p, obstacles = OB) {
  for (const [rx, ry, rw, rh] of obstacles) {
    const a = Math.max(rx, Math.min(p.x, rx + rw)), b = Math.max(ry, Math.min(p.y, ry + rh));
    let dx = p.x - a, dy = p.y - b, d = Math.hypot(dx, dy);
    if (d < C.R) {
      if (!d) {
        const edges = [[p.x-rx,rx-C.R,p.y],[rx+rw-p.x,rx+rw+C.R,p.y],[p.y-ry,p.x,ry-C.R],[ry+rh-p.y,p.x,ry+rh+C.R]];
        const edge = edges.sort((a,b)=>a[0]-b[0])[0]; p.x=edge[1];p.y=edge[2];
      } else { p.x += dx / d * (C.R - d); p.y += dy / d * (C.R - d); }
    }
  }
  p.x = Math.max(C.R, Math.min(C.W - C.R, p.x)); p.y = Math.max(C.R, Math.min(C.H - C.R, p.y));
}
export function move(p, mx, my, dt, t, obstacles = OB) {
  let l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; l = 1; }
  const dash = t < p.dU;
  if (dash && l < 0.1) { mx = Math.cos(p.a); my = Math.sin(p.a); }
  const sp = dash ? C.DASH_SPEED : p.boost ? 360 : C.SPEED;
  p.x += mx * sp * dt; p.y += my * sp * dt; collide(p, obstacles);
}
export function tryDash(p, t) { if (t < p.dC) return false; p.dU = t + C.DASH_MS; p.dC = t + C.DASH_CD; return true; }

export const SUPPLIES = [[450,280],[110,280],[790,280]];

export const MAPS = {
  neon: { name: 'Neon Yard', description: 'Balanced cover and a contested central supply.', obstacles: OB, supplies: SUPPLIES, spawns: SPAWNS, color: '#8aeeab' },
  lanes: { name: 'Crossfire', description: 'Long firing lanes with sheltered side routes.', obstacles: [[260,110,35,145],[260,305,35,145],[605,110,35,145],[605,305,35,145],[400,130,100,35],[400,395,100,35]], supplies: [[450,280],[120,170],[780,390]], spawns: SPAWNS, color: '#6b9cff' },
  pillars: { name: 'Reactor', description: 'Scattered pillars reward flanking and quick dashes.', obstacles: [[300,150,55,55],[545,150,55,55],[300,355,55,55],[545,355,55,55],[415,245,70,70],[140,245,45,70],[715,245,45,70]], supplies: [[450,110],[450,450],[110,280],[790,280]], spawns: SPAWNS, color: '#d6a0ff' },
};

export const WEAPONS = {
  cannon: {name:'Main Cannon',label:'C',damage:25,pellets:1,spread:0,cooldown:260,speed:740,life:1.1,magazine:10,reload:1100,color:'#ffe066'},
  heavy: {name:'Heavy Cannon',label:'H',damage:45,pellets:1,spread:0,cooldown:850,speed:680,life:1.2,magazine:5,reload:1700,color:'#ff986b'},
  twin: {name:'Twin Cannon',label:'T',damage:16,pellets:2,spread:0,barrelSpacing:10,cooldown:420,speed:780,life:1.05,magazine:8,reload:1500,color:'#6bdcff'},
};
export const weaponPads = map => [[450,60,'heavy'],[450,500,'twin'],[60,170,'cannon']];

export function updateBoost(p, held, dt) {
  p.energy = Math.max(0,Math.min(100,p.energy ?? 100));
  // Empty boost must recover before it can be engaged again.
  if(p.energy<=0)p.boostLocked=true;
  if(!held && p.energy>=25)p.boostLocked=false;
  p.boost=!!held && !p.boostLocked && p.energy>0;
  p.energy=Math.max(0,Math.min(100,p.energy+(p.boost?-45:24)*dt));
  if(!held && p.energy>=25)p.boostLocked=false;
  if(p.energy<=0){p.boost=false;p.boostLocked=true;}
}
export const arenaObjects = () => [
  {id:1,type:'crate',x:100,y:100,hp:50}, {id:2,type:'crate',x:800,y:460,hp:50},
  {id:3,type:'barrel',x:100,y:460,hp:25}, {id:4,type:'barrel',x:800,y:100,hp:25},
];
export const BOOST_PADS = [[100,380],[800,180]];
export const objectRect = o => [o.x-14,o.y-14,28,28];
