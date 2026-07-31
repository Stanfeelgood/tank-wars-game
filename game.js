
// ═══════════════════════════════════════════════════════════
// TANK WARS — 5v5 Attack & Defend
// ═══════════════════════════════════════════════════════════
(() => {
'use strict';

// ── Constants ──
const W = 900, H = 452, TILE = 40;
const COLS = Math.ceil(W/TILE), ROWS = Math.ceil(H/TILE);
const FPS = 60;

// ── Weapons ──
const WEAPONS = [
  {id:'machine',name:'Machine Gun',icon:'🔫',dmg:8,rate:6,speed:8,cost:0,color:'#ffd32a',spread:.05},
  {id:'shotgun',name:'Shotgun',icon:'💥',dmg:6,rate:25,speed:7,cost:120,color:'#ff4757',spread:.3,pellets:5},
  {id:'rocket',name:'RPG',icon:'🚀',dmg:35,rate:50,speed:5,cost:200,color:'#ff6348',splash:40},
  {id:'sniper',name:'Sniper',icon:'🎯',dmg:45,rate:60,speed:15,cost:180,color:'#3742fa',spread:0,pierce:true},
  {id:'laser',name:'Laser',icon:'⚡',dmg:4,rate:2,speed:20,cost:250,color:'#00b894',spread:0},
  {id:'flame',name:'Flame',icon:'🔥',dmg:3,rate:3,speed:6,cost:150,color:'#e17055',splash:25,dot:true}
];

// ── Game State ──
let state = 'menu'; // menu, roundIntro, weaponSelect, countdown, playing, roundEnd, matchEnd
let canvas, ctx, miniCanvas, miniCtx;
let player, tanks=[], bullets=[], particles=[], powerups=[], explosions=[];
let round=1, playerRole='atk', roundTime=90, matchTimer;
let score={atk:0,def:0}, playerPts=0, playerStars=0;
let kills=0, losses=0, combo=0, comboTimer=0;
let killFeed=[];
let currentWeapon=WEAPONS[0], fireCooldown=0;
let boostEnergy=100, boostActive=false;
let keys={}, dpad={up:false,down:false,left:false,right:false};
let mapGrid=[];
let lastTime=0, shakeAmount=0;

// ── Init ──
function init() {
  canvas = document.getElementById('c');
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');

  miniCanvas = document.getElementById('minimap');
  if(!miniCanvas) { miniCanvas = document.createElement('canvas'); miniCanvas.id='minimap'; miniCanvas.width=100; miniCanvas.height=50; document.getElementById('wrap').appendChild(miniCanvas); }
  miniCanvas.width=100; miniCanvas.height=50;
  miniCtx = miniCanvas.getContext('2d');

  generateMap();
  setupControls();
  setupOverlays();
  showOverlay('ov-start');
  requestAnimationFrame(loop);
}

// ── Map Generation ──
function generateMap() {
  mapGrid = [];
  for(let r=0;r<ROWS;r++) {
    mapGrid[r]=[];
    for(let c=0;c<COLS;c++) {
      mapGrid[r][c] = 0; // 0=empty, 1=wall, 2=destructible, 3=water
    }
  }
  // Add walls
  for(let i=0;i<12;i++) {
    let r=Math.floor(Math.random()*ROWS), c=Math.floor(Math.random()*COLS);
    let len=2+Math.floor(Math.random()*3);
    let horiz=Math.random()>.5;
    for(let j=0;j<len;j++) {
      let cr=horiz?r:r+j, cc=horiz?c+j:c;
      if(cr<ROWS&&cc<COLS&&!(cr===0||cr===ROWS-1||cc===0||cc===COLS-1))
        mapGrid[cr][cc]=1;
    }
  }
  // Add destructible crates
  for(let i=0;i<20;i++) {
    let r=Math.floor(Math.random()*ROWS), c=Math.floor(Math.random()*COLS);
    if(r>1&&r<ROWS-2&&c>1&&c<COLS-2&&mapGrid[r][c]===0)
      mapGrid[r][c]=2;
  }
  // Add water
  for(let i=0;i<3;i++) {
    let r=2+Math.floor(Math.random()*(ROWS-4)), c=2+Math.floor(Math.random()*(COLS-4));
    for(let j=0;j<3;j++) {
      let cr=r+j, cc=c+Math.floor(Math.random()*2);
      if(cr<ROWS&&cc<COLS&&mapGrid[cr][cc]===0)
        mapGrid[cr][cc]=3;
    }
  }
}

// ── Tank Class ──
class Tank {
  constructor(x,y,team,isPlayer) {
    this.x=x; this.y=y; this.w=24; this.h=24;
    this.angle=0; this.turretAngle=0;
    this.speed=2; this.hp=100; this.maxHp=100;
    this.team=team; this.isPlayer=isPlayer;
    this.alive=true; this.weapon=WEAPONS[0];
    this.fireTimer=0; this.invulnerable=0;
    this.aiTimer=0; this.aiTarget=null;
    this.trail=[];
    this.name=isPlayer?'YOU':team.toUpperCase()+'-'+Math.floor(Math.random()*99);
  }
  update(dt) {
    if(!this.alive) return;
    // Trail
    this.trail.push({x:this.x,y:this.y,alpha:.6});
    if(this.trail.length>8) this.trail.shift();
    this.trail.forEach(t=>t.alpha*=.92);
    if(this.invulnerable>0) this.invulnerable-=dt;
  }
  move(dx,dy) {
    if(!this.alive) return;
    let spd=boostActive&&this.isPlayer?this.speed*1.6:this.speed;
    let nx=this.x+dx*spd, ny=this.y+dy*spd;
    // Map collision
    let col=Math.floor(nx/TILE), row=Math.floor(ny/TILE);
    if(col>=0&&col<COLS&&row>=0&&row<ROWS&&mapGrid[row][col]!==1&&mapGrid[row][col]!==3) {
      this.x=Math.max(12,Math.min(W-12,nx));
      this.y=Math.max(12,Math.min(H-12,ny));
    }
    if(dx!==0||dy!==0) this.angle=Math.atan2(dy,dx);
  }
  fire() {
    if(!this.alive||this.fireTimer>0) return;
    let w=this.weapon;
    this.fireTimer=w.rate;
    let pellets=w.pellets||1;
    for(let i=0;i<pellets;i++) {
      let spread=(Math.random()-.5)*w.spread*2;
      let a=this.turretAngle+spread;
      bullets.push({
        x:this.x, y:this.y,
        vx:Math.cos(a)*w.speed, vy:Math.sin(a)*w.speed,
        dmg:w.dmg, owner:this, color:w.color,
        splash:w.splash||0, pierce:w.pierce||false, dot:w.dot||false,
        life:60, size:w.id==='rocket'?5:w.id==='laser'?3:3
      });
    }
    // Muzzle flash
    for(let i=0;i<5;i++) {
      let a=this.turretAngle+(Math.random()-.5)*.5;
      particles.push({x:this.x+Math.cos(this.turretAngle)*14,y:this.y+Math.sin(this.turretAngle)*14,
        vx:Math.cos(a)*3+Math.random()*2,vy:Math.sin(a)*3+Math.random()*2,
        life:8,maxLife:8,color:'#ffd32a',size:3});
    }
  }
  takeDamage(dmg,from) {
    if(this.invulnerable>0) return;
    this.hp-=dmg;
    // Damage flash
    for(let i=0;i<6;i++) {
      particles.push({x:this.x,y:this.y,
        vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4,
        life:15,maxLife:15,color:'#ff4757',size:2+Math.random()*2});
    }
    if(this.hp<=0) {
      this.hp=0; this.alive=false;
      // Death explosion
      for(let i=0;i<25;i++) {
        let a=Math.random()*Math.PI*2;
        let spd=1+Math.random()*4;
        particles.push({x:this.x,y:this.y,
          vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,
          life:20+Math.random()*20,maxLife:40,
          color:['#ff4757','#ffd32a','#ff6348','#2d5a1b'][Math.floor(Math.random()*4)],
          size:2+Math.random()*4});
      }
      shakeAmount=8;
    }
  }
  draw(ctx) {
    if(!this.alive) return;
    // Trail
    this.trail.forEach(t=>{
      ctx.fillStyle=`rgba(${this.team==='atk'?'255,71,87':'55,66,250'},${t.alpha*.3})`;
      ctx.fillRect(t.x-8,t.y-8,16,16);
    });
    ctx.save();
    ctx.translate(this.x,this.y);
    // Invulnerability shield
    if(this.invulnerable>0) {
      ctx.strokeStyle=`rgba(255,211,42,${.5+Math.sin(Date.now()/100)*.3})`;
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.stroke();
    }
    // Body
    let bodyColor=this.team==='atk'?'#c0392b':'#2980b9';
    let bodyHighlight=this.team==='atk'?'#e74c3c':'#3498db';
    // Shadow
    ctx.fillStyle='rgba(0,0,0,.3)';
    ctx.fillRect(-13,-11,26,22);
    // Body rect
    ctx.fillStyle=bodyColor;
    ctx.fillRect(-11,-10,22,20);
    ctx.fillStyle=bodyHighlight;
    ctx.fillRect(-9,-8,18,16);
    // Tracks
    ctx.fillStyle='#2c2c2c';
    ctx.fillRect(-13,-10,4,20);
    ctx.fillRect(9,-10,4,20);
    // Turret
    ctx.save();
    ctx.rotate(this.turretAngle);
    ctx.fillStyle='#444';
    ctx.fillRect(0,-3,16,6);
    ctx.fillStyle='#666';
    ctx.fillRect(2,-2,12,4);
    // Barrel tip
    ctx.fillStyle=this.weapon?this.weapon.color:'#888';
    ctx.fillRect(14,-3,4,6);
    ctx.restore();
    // Player indicator
    if(this.isPlayer) {
      ctx.fillStyle='#ffd32a';
      ctx.beginPath();
      ctx.moveTo(0,-16); ctx.lineTo(-5,-22); ctx.lineTo(5,-22);
      ctx.fill();
    }
    // HP bar
    if(this.hp<this.maxHp) {
      let bw=24;
      ctx.fillStyle='#333';
      ctx.fillRect(-bw/2,-14,bw,4);
      let hpPct=this.hp/this.maxHp;
      ctx.fillStyle=hpPct>.5?'#00b894':hpPct>.25?'#ffd32a':'#ff4757';
      ctx.fillRect(-bw/2,-14,bw*hpPct,4);
    }
    ctx.restore();
  }
}

// ── AI ──
function updateAI(tank) {
  if(!tank.alive) return;
  tank.aiTimer--;
  if(tank.aiTimer<=0) {
    tank.aiTimer=30+Math.floor(Math.random()*60);
    // Find target
    let enemies=tanks.filter(t=>t.team!==tank.team&&t.alive);
    tank.aiTarget=enemies.length?enemies[Math.floor(Math.random()*enemies.length)]:null;
  }
  if(tank.aiTarget&&tank.aiTarget.alive) {
    let dx=tank.aiTarget.x-tank.x, dy=tank.aiTarget.y-tank.y;
    let dist=Math.sqrt(dx*dx+dy*dy);
    tank.turretAngle=Math.atan2(dy,dx);
    // Move towards
    if(dist>120) {
      tank.move(dx/dist, dy/dist);
    } else if(dist<60) {
      tank.move(-dx/dist, -dy/dist);
    } else {
      // Strafe
      tank.move(-dy/dist*0.5, dx/dist*0.5);
    }
    // Fire
    if(dist<250&&Math.abs(dist-150)<100) {
      tank.fire();
    }
  } else {
    // Random movement
    if(Math.random()<.05) {
      let a=Math.random()*Math.PI*2;
      tank.move(Math.cos(a)*0.5, Math.sin(a)*0.5);
      tank.turretAngle=a;
    }
  }
}

// ── Bullets ──
function updateBullets() {
  for(let i=bullets.length-1;i>=0;i--) {
    let b=bullets[i];
    b.x+=b.vx; b.y+=b.vy; b.life--;
    // Map collision
    let col=Math.floor(b.x/TILE), row=Math.floor(b.y/TILE);
    if(col>=0&&col<COLS&&row>=0&&row<ROWS) {
      if(mapGrid[row][col]===1) { b.life=0; }
      else if(mapGrid[row][col]===2) {
        mapGrid[row][col]=0; b.life=0;
        for(let j=0;j<6;j++) {
          particles.push({x:b.x,y:b.y,vx:(Math.random()-.5)*3,vy:(Math.random()-.5)*3,
            life:12,maxLife:12,color:'#c4a35a',size:2});
        }
      }
    }
    // Out of bounds
    if(b.x<0||b.x>W||b.y<0||b.y>H) b.life=0;
    // Hit tanks
    for(let t of tanks) {
      if(!t.alive||t===b.owner) continue;
      let dx=b.x-t.x, dy=b.y-t.y;
      if(Math.sqrt(dx*dx+dy*dy)<16) {
        if(b.pierce) { b.dmg=Math.max(1,b.dmg-3); }
        else { b.life=0; }
        t.takeDamage(b.dmg, b.owner);
        if(b.splash) {
          // Splash damage
          tanks.forEach(tt=>{
            if(tt===t||!tt.alive) return;
            let sd=Math.sqrt((b.x-tt.x)**2+(b.y-tt.y)**2);
            if(sd<b.splash) tt.takeDamage(Math.floor(b.dmg*(1-sd/b.splash)),b.owner);
          });
          // Explosion particles
          for(let j=0;j<20;j++) {
            let a=Math.random()*Math.PI*2, spd=2+Math.random()*3;
            particles.push({x:b.x,y:b.y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,
              life:15+Math.random()*15,maxLife:30,color:b.color,size:3+Math.random()*3});
          }
          shakeAmount=Math.max(shakeAmount,5);
          explosions.push({x:b.x,y:b.y,r:b.splash,life:10});
        }
        if(b.dot) {
          setTimeout(()=>{ if(t.alive) t.takeDamage(b.dmg, b.owner); }, 300);
          setTimeout(()=>{ if(t.alive) t.takeDamage(b.dmg, b.owner); }, 600);
        }
        // Track kills
        if(!t.alive&&b.owner) {
          handleKill(b.owner, t);
        }
      }
    }
    if(b.life<=0) bullets.splice(i,1);
  }
}

function handleKill(killer, victim) {
  kills++; combo++; comboTimer=120;
  let pts=10*combo;
  playerPts+=pts;
  // Kill feed
  killFeed.push({killer:killer.name,victim:victim.name,weapon:killer.weapon.name,time:180});
  if(killFeed.length>5) killFeed.shift();
  // Particles
  for(let i=0;i<15;i++) {
    let a=Math.random()*Math.PI*2, spd=2+Math.random()*4;
    particles.push({x:victim.x,y:victim.y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,
      life:20,maxLife:20,color:'#ff4757',size:2+Math.random()*3});
  }
  shakeAmount=6;
}

// ── Particles ──
function updateParticles() {
  for(let i=particles.length-1;i>=0;i--) {
    let p=particles[i];
    p.x+=p.vx; p.y+=p.vy;
    p.vx*=.95; p.vy*=.95;
    p.life--;
    if(p.life<=0) particles.splice(i,1);
  }
}

// ── Power-ups ──
function spawnPowerups() {
  if(Math.random()<.002&&powerups.length<3) {
    let types=['health','speed','damage','shield'];
    let type=types[Math.floor(Math.random()*types.length)];
    powerups.push({
      x:30+Math.random()*(W-60), y:30+Math.random()*(H-60),
      type, life:600, pulse:0
    });
  }
  for(let i=powerups.length-1;i>=0;i--) {
    let p=powerups[i];
    p.life--; p.pulse+=.1;
    if(p.life<=0) { powerups.splice(i,1); continue; }
    if(player.alive) {
      let dx=p.x-player.x, dy=p.y-player.y;
      if(Math.sqrt(dx*dx+dy*dy)<20) {
        applyPowerup(p.type);
        powerups.splice(i,1);
      }
    }
  }
}

function applyPowerup(type) {
  switch(type) {
    case 'health': player.hp=Math.min(player.maxHp,player.hp+40); break;
    case 'speed': player.speed=3.5; setTimeout(()=>player.speed=2,5000); break;
    case 'damage': player.weapon={...player.weapon,dmg:player.weapon.dmg*1.5}; setTimeout(()=>{player.weapon=WEAPONS.find(w=>w.id===currentWeapon.id)||WEAPONS[0];},5000); break;
    case 'shield': player.invulnerable=180; break;
  }
  // Notification
  let notif=document.getElementById('powerup-notif');
  if(notif) { notif.textContent=`${type.toUpperCase()} ACQUIRED!`; notif.style.opacity='1';
    setTimeout(()=>notif.style.opacity='0',1500); }
}

// ── Draw Map ──
function drawMap() {
  // Ground
  ctx.fillStyle='#2d5a1b';
  ctx.fillRect(0,0,W,H);
  // Ground texture
  ctx.fillStyle='rgba(0,0,0,.05)';
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
    if((r+c)%2===0) ctx.fillRect(c*TILE,r*TILE,TILE,TILE);
  }
  // Tiles
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
    let t=mapGrid[r][c];
    let x=c*TILE, y=r*TILE;
    if(t===1) {
      // Stone wall
      ctx.fillStyle='#5a5a5a';
      ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
      ctx.fillStyle='#6e6e6e';
      ctx.fillRect(x+2,y+2,TILE-4,TILE-4);
      ctx.fillStyle='rgba(0,0,0,.2)';
      ctx.fillRect(x+1,y+TILE-3,TILE-2,2);
    } else if(t===2) {
      // Wooden crate
      ctx.fillStyle='#8B6914';
      ctx.fillRect(x+2,y+2,TILE-4,TILE-4);
      ctx.strokeStyle='#6B4914';
      ctx.lineWidth=1;
      ctx.strokeRect(x+4,y+4,TILE-8,TILE-8);
      ctx.beginPath();
      ctx.moveTo(x+4,y+4); ctx.lineTo(x+TILE-4,y+TILE-4);
      ctx.moveTo(x+TILE-4,y+4); ctx.lineTo(x+4,y+TILE-4);
      ctx.stroke();
    } else if(t===3) {
      // Water
      ctx.fillStyle='#1a5276';
      ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
      ctx.fillStyle='rgba(52,152,219,.3)';
      let wave=Math.sin(Date.now()/500+c+r)*3;
      ctx.fillRect(x+wave,y+4,TILE-8,3);
    }
  }
}

// ── Draw Bullets ──
function drawBullets() {
  bullets.forEach(b=>{
    ctx.save();
    ctx.fillStyle=b.color;
    ctx.shadowColor=b.color;
    ctx.shadowBlur=8;
    if(b.splash) {
      // Rocket trail
      ctx.globalAlpha=.4;
      ctx.fillRect(b.x-b.vx*2,b.y-b.vy*2-2,6,4);
      ctx.globalAlpha=1;
    }
    ctx.beginPath();
    ctx.arc(b.x,b.y,b.size,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
}

// ── Draw Particles ──
function drawParticles() {
  particles.forEach(p=>{
    let alpha=p.life/p.maxLife;
    ctx.globalAlpha=alpha;
    ctx.fillStyle=p.color;
    ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size*alpha,p.size*alpha);
  });
  ctx.globalAlpha=1;
}

// ── Draw Explosions ──
function drawExplosions() {
  for(let i=explosions.length-1;i>=0;i--) {
    let e=explosions[i];
    e.life--;
    let alpha=e.life/10;
    ctx.strokeStyle=`rgba(255,165,0,${alpha})`;
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.arc(e.x,e.y,e.r*(1-e.life/10)*1.5,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle=`rgba(255,100,0,${alpha*.3})`;
    ctx.fill();
    if(e.life<=0) explosions.splice(i,1);
  }
}

// ── Draw Power-ups ──
function drawPowerups() {
  powerups.forEach(p=>{
    let pulse=Math.sin(p.pulse)*3;
    let colors={health:'#00b894',speed:'#ffd32a',damage:'#ff4757',shield:'#3742fa'};
    let icons={health:'💚',speed:'⚡',damage:'💪',shield:'🛡️'};
    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.globalAlpha=.3+.2*Math.sin(p.pulse*2);
    ctx.fillStyle=colors[p.type];
    ctx.beginPath(); ctx.arc(0,0,14+pulse,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    ctx.font='16px serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(icons[p.type],0,0);
    ctx.restore();
  });
}

// ── Minimap ──
function drawMinimap() {
  if(!miniCtx) return;
  let mw=100,mh=50;
  let sx=mw/W, sy=mh/H;
  miniCtx.clearRect(0,0,mw,mh);
  miniCtx.fillStyle='#1a3a0a';
  miniCtx.fillRect(0,0,mw,mh);
  // Map tiles
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
    if(mapGrid[r][c]===1) { miniCtx.fillStyle='#555'; miniCtx.fillRect(c*TILE*sx,r*TILE*sy,TILE*sx,TILE*sy); }
    else if(mapGrid[r][c]===3) { miniCtx.fillStyle='#1a5276'; miniCtx.fillRect(c*TILE*sx,r*TILE*sy,TILE*sx,TILE*sy); }
  }
  // Tanks
  tanks.forEach(t=>{
    if(!t.alive) return;
    miniCtx.fillStyle=t.isPlayer?'#ffd32a':t.team==='atk'?'#ff4757':'#3742fa';
    miniCtx.fillRect(t.x*sx-1,t.y*sy-1,3,3);
  });
  // Power-ups
  powerups.forEach(p=>{
    miniCtx.fillStyle='#00b894';
    miniCtx.fillRect(p.x*sx-1,p.y*sy-1,2,2);
  });
}

// ── HUD Updates ──
function updateHUD() {
  document.getElementById('hud-round').textContent=round;
  document.getElementById('hud-score-wins').textContent=`${score.atk}:${score.def}`;
  document.getElementById('timer-box').textContent=roundTime;
  document.getElementById('hud-stars-val').textContent=playerStars;
  document.getElementById('hud-pts-val').textContent=playerPts;
  document.getElementById('fire-name').textContent=currentWeapon.name;
  // Team icons
  let atkDiv=document.getElementById('atk-icons');
  let defDiv=document.getElementById('def-icons');
  if(atkDiv) {
    atkDiv.innerHTML='';
    tanks.filter(t=>t.team==='atk').forEach(t=>{
      let s=document.createElement('span');
      s.className='icon '+(t.alive?'alive':'dead');
      s.style.background=t.isPlayer?'#ffd32a':'#ff4757';
      atkDiv.appendChild(s);
    });
  }
  if(defDiv) {
    defDiv.innerHTML='';
    tanks.filter(t=>t.team==='def').forEach(t=>{
      let s=document.createElement('span');
      s.className='icon '+(t.alive?'alive':'dead');
      s.style.background=t.isPlayer?'#ffd32a':'#3742fa';
      defDiv.appendChild(s);
    });
  }
  // Timer urgency
  let timerEl=document.getElementById('timer-box');
  if(roundTime<=15) timerEl.classList.add('urgent');
  else timerEl.classList.remove('urgent');
  // Combo
  let comboEl=document.getElementById('combo');
  if(comboEl) {
    if(combo>1) { comboEl.textContent=`🔥 x${combo} COMBO`; comboEl.classList.add('show'); }
    else comboEl.classList.remove('show');
  }
  // Boost bar
  let boostFill=document.getElementById('boost-fill');
  if(boostFill) boostFill.style.width=boostEnergy+'%';
  // Kill feed
  let feedDiv=document.getElementById('kill-feed');
  if(feedDiv) {
    feedDiv.innerHTML='';
    killFeed.forEach(k=>{
      if(k.time<=0) return;
      k.time--;
      let div=document.createElement('div');
      div.className='kill-entry';
      div.innerHTML=`<span class="killer">${k.killer}</span> [<span class="weapon-used">${k.weapon}</span>] <span class="victim">${k.victim}</span>`;
      feedDiv.appendChild(div);
    });
    killFeed=killFeed.filter(k=>k.time>0);
  }
}

// ── Controls ──
function setupControls() {
  document.addEventListener('keydown',e=>{
    keys[e.key]=true;
    if(e.key===' '||e.key==='Enter') e.preventDefault();
    handleKeyAction(e.key);
  });
  document.addEventListener('keyup',e=>keys[e.key]=false);
  // D-pad buttons
  setupDpad('btn-up','up');
  setupDpad('btn-down','down');
  setupDpad('btn-left','left');
  setupDpad('btn-right','right');
  // Action buttons
  document.getElementById('btn-fire')?.addEventListener('mousedown',()=>fireAction());
  document.getElementById('btn-fire')?.addEventListener('touchstart',e=>{e.preventDefault();fireAction()});
  document.getElementById('btn-boost')?.addEventListener('mousedown',()=>boostAction());
  document.getElementById('btn-boost')?.addEventListener('touchstart',e=>{e.preventDefault();boostAction()});
  document.getElementById('btn-rec')?.addEventListener('click',()=>{
    let data=canvas.toDataURL('image/png');
    let a=document.createElement('a');
    a.download='tankwars_screenshot.png';
    a.href=data; a.click();
  });
  // Mouse aim
  canvas.addEventListener('mousemove',e=>{
    let rect=canvas.getBoundingClientRect();
    let mx=e.clientX-rect.left, my=e.clientY-rect.top;
    let scaleX=W/rect.width, scaleY=H/rect.height;
    if(player&&player.alive) {
      player.turretAngle=Math.atan2(my*scaleY-player.y, mx*scaleX-player.x);
    }
  });
  canvas.addEventListener('mousedown',()=>{ if(state==='playing') fireAction(); });
}

function setupDpad(id,dir) {
  let btn=document.getElementById(id);
  if(!btn) return;
  btn.addEventListener('mousedown',()=>dpad[dir]=true);
  btn.addEventListener('mouseup',()=>dpad[dir]=false);
  btn.addEventListener('mouseleave',()=>dpad[dir]=false);
  btn.addEventListener('touchstart',e=>{e.preventDefault();dpad[dir]=true});
  btn.addEventListener('touchend',()=>dpad[dir]=false);
}

function handleKeyAction(key) {
  if(key===' '||key==='Enter') {
    if(state==='menu') startMatch();
    else if(state==='roundIntro') startRoundIntro();
    else if(state==='weaponSelect') confirmWeapon();
    else if(state==='roundEnd') nextRound();
    else if(state==='matchEnd') startMatch();
  }
}

function fireAction() { if(state==='playing'&&player.alive) player.fire(); }

function boostAction() {
  if(state!=='playing'||!player.alive) return;
  if(boostEnergy>=30) {
    boostActive=true;
    boostEnergy-=30;
    setTimeout(()=>boostActive=false,2000);
  }
}

function getMovement() {
  let dx=0,dy=0;
  if(keys['ArrowLeft']||keys['a']||keys['A']||dpad.left) dx-=1;
  if(keys['ArrowRight']||keys['d']||keys['D']||dpad.right) dx+=1;
  if(keys['ArrowUp']||keys['w']||keys['W']||dpad.up) dy-=1;
  if(keys['ArrowDown']||keys['s']||keys['S']||dpad.down) dy+=1;
  if(dx!==0&&dy!==0) { dx*=.707; dy*=.707; }
  return {dx,dy};
}

// ── Overlays ──
function setupOverlays() {
  document.getElementById('btn-start')?.addEventListener('click',startMatch);
  document.getElementById('btn-round-go')?.addEventListener('click',startRoundIntro);
  document.getElementById('btn-weapon-confirm')?.addEventListener('click',confirmWeapon);
  document.getElementById('btn-next-rnd')?.addEventListener('click',nextRound);
  document.getElementById('btn-rematch')?.addEventListener('click',startMatch);
  document.getElementById('btn-menu')?.addEventListener('click',()=>{
    showOverlay('ov-start'); state='menu';
  });
}

function showOverlay(id) {
  document.querySelectorAll('.ov').forEach(o=>o.style.display='none');
  let el=document.getElementById(id);
  if(el) el.style.display='flex';
}
function hideOverlays() {
  document.querySelectorAll('.ov').forEach(o=>o.style.display='none');
}

// ── Game Flow ──
function startMatch() {
  round=1; score={atk:0,def:0}; playerPts=0; playerStars=0;
  showRoundIntro();
}

function showRoundIntro() {
  state='roundIntro';
  playerRole=round%2===1?'atk':'def';
  document.getElementById('rnd-num').textContent=round;
  document.getElementById('rnd-role').textContent=playerRole==='atk'?'⚔ ТЫ АТАКУЕШЬ':'🛡 ТЫ ЗАЩИЩАЕШЬ';
  let desc=playerRole==='atk'
    ?'Уничтожь всех защитников!\nИспользуй оружие с умом.'
    :'Защити базу от атакующих!\nНе сдавайся!';
  document.getElementById('rnd-desc').textContent=desc;
  showOverlay('ov-round');
}

function startRoundIntro() {
  hideOverlays();
  state='weaponSelect';
  showWeaponSelect();
}

function showWeaponSelect() {
  document.getElementById('wp-pts').textContent=playerPts;
  document.getElementById('wp-stars').textContent=playerStars;
  let grid=document.getElementById('weapon-grid');
  grid.innerHTML='';
  WEAPONS.forEach((w,i)=>{
    let card=document.createElement('div');
    card.className='weapon-card'+(w===currentWeapon?' selected':'');
    card.innerHTML=`<div class="w-icon">${w.icon}</div><div class="w-name">${w.name}</div><div class="w-stats">DMG:${w.dmg} SPD:${w.speed} RATE:${w.rate}</div><div class="w-cost">${w.cost>0?'● '+w.cost+' pts':'FREE'}</div>`;
    card.onclick=()=>{
      if(playerPts>=w.cost) {
        currentWeapon=w;
        document.querySelectorAll('.weapon-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        let btn=document.getElementById('btn-weapon-confirm');
        btn.style.opacity='1'; btn.style.pointerEvents='auto';
      }
    };
    grid.appendChild(card);
  });
  showOverlay('ov-weapon');
}

function confirmWeapon() {
  hideOverlays();
  state='countdown';
  initRound();
}

function initRound() {
  bullets=[]; particles=[]; explosions=[]; powerups=[]; killFeed=[];
  kills=0; losses=0; combo=0; comboTimer=0;
  roundTime=90; boostEnergy=100; boostActive=false;
  currentWeapon=WEAPONS[0];
  generateMap();
  // Spawn tanks
  tanks=[];
  let isAtk=playerRole==='atk';
  player=new Tank(isAtk?W/4:W*3/4, H/2, playerRole, true);
  player.weapon=WEAPONS[0];
  tanks.push(player);
  // AI teammates
  for(let i=0;i<4;i++) {
    let t=new Tank(W/4+(Math.random()-.5)*100, H/4+i*(H/5), playerRole, false);
    t.weapon=WEAPONS[Math.floor(Math.random()*WEAPONS.length)];
    tanks.push(t);
  }
  // Enemy team
  for(let i=0;i<5;i++) {
    let enemyRole=isAtk?'def':'atk';
    let t=new Tank((isAtk?W*3/4:W/4)+(Math.random()-.5)*100, H/4+i*(H/5), enemyRole, false);
    t.weapon=WEAPONS[Math.floor(Math.random()*WEAPONS.length)];
    t.speed=1.5+Math.random()*.5;
    tanks.push(t);
  }
  // Countdown
  let cd=document.getElementById('countdown');
  let count=3;
  cd.classList.add('show');
  cd.textContent=count;
  let cdInterval=setInterval(()=>{
    count--;
    if(count>0) cd.textContent=count;
    else if(count===0) { cd.textContent='GO!'; }
    else { cd.classList.remove('show'); clearInterval(cdInterval); state='playing'; }
  },800);
}

function endRound() {
  state='roundEnd';
  let atkAlive=tanks.filter(t=>t.team==='atk'&&t.alive).length;
  let defAlive=tanks.filter(t=>t.team==='def'&&t.alive).length;
  let won=(playerRole==='atk'&&atkAlive>=defAlive)||(playerRole==='def'&&defAlive>=atkAlive);
  let ptsEarned=kills*10+(won?50:10);
  playerPts+=ptsEarned;
  if(won) score[playerRole]++;
  // Show result
  document.getElementById('re-banner').className='res-banner '+(won?'win':'lose');
  document.getElementById('re-banner').textContent=won?'ПОБЕДА!':'ПОРАЖЕНИЕ';
  document.getElementById('re-kills').textContent=kills;
  document.getElementById('re-losses').textContent=losses;
  document.getElementById('re-pts').textContent='+'+ptsEarned;
  if(round<2) document.getElementById('btn-next-rnd').style.display='block';
  else document.getElementById('btn-next-rnd').style.display='none';
  showOverlay('ov-rend');
}

function nextRound() {
  round++;
  if(round>2) { showMatchEnd(); return; }
  showRoundIntro();
}

function showMatchEnd() {
  state='matchEnd';
  let won=score[playerRole]>=(1-score[playerRole==='atk'?'def':'atk']);
  document.getElementById('end-banner').className='res-banner '+(won?'win':'lose');
  document.getElementById('end-banner').textContent=won?'МАТЧ ВЫИГРАН!':'МАТЧ ПРОИГРАН';
  document.getElementById('end-score').textContent=`${score.atk} : ${score.def}`;
  // Records
  let recsDiv=document.getElementById('end-recs');
  recsDiv.innerHTML=`<span class="rec highlight">🏆 Очки: ${playerPts}</span><span class="rec">⚔ Убийств: ${kills}</span><span class="rec">⭐ Звёзды: ${playerStars}</span>`;
  showOverlay('ov-end');
}

// ── Main Loop ──
function loop(time) {
  let dt=Math.min((time-lastTime)/16.67, 2);
  lastTime=time;

  // Shake decay
  if(shakeAmount>0) { shakeAmount*=.85; if(shakeAmount<.1) shakeAmount=0; }
  // Combo decay
  if(comboTimer>0) { comboTimer-=dt; if(comboTimer<=0) combo=0; }

  // Update
  if(state==='playing') {
    roundTime-=1/60;
    if(roundTime<=0) { endRound(); }
    // Check win condition
    let atkAlive=tanks.filter(t=>t.team==='atk'&&t.alive).length;
    let defAlive=tanks.filter(t=>t.team==='def'&&t.alive).length;
    if(atkAlive===0||defAlive===0) endRound();
    // Player movement
    if(player.alive) {
      let m=getMovement();
      player.move(m.dx,m.dy);
      player.turretAngle+=Math.sin(Date.now()/2000)*.01; // Slight wobble for realism
      // Keyboard aim
      if(keys['ArrowLeft']||keys['a']) player.turretAngle-=.03;
      if(keys['ArrowRight']||keys['d']) player.turretAngle+=.03;
      // Auto fire
      if(keys[' ']) player.fire();
    }
    // AI
    tanks.forEach(t=>{ if(!t.isPlayer) updateAI(t); });
    // Boost regen
    if(boostEnergy<100) boostEnergy+=.15*dt;
    boostEnergy=Math.min(100,boostEnergy);
    // Weapons cooldown
    tanks.forEach(t=>{ if(t.fireTimer>0) t.fireTimer-=dt; });
    // Update
    tanks.forEach(t=>t.update(dt));
    updateBullets();
    updateParticles();
    spawnPowerups();
  }

  // Draw
  draw();
  updateHUD();
  drawMinimap();

  requestAnimationFrame(loop);
}

function draw() {
  ctx.save();
  // Screen shake
  if(shakeAmount>0) {
    ctx.translate((Math.random()-.5)*shakeAmount,(Math.random()-.5)*shakeAmount);
  }
  drawMap();
  drawPowerups();
  // Draw tanks (sorted by y for depth)
  let sorted=[...tanks].sort((a,b)=>a.y-b.y);
  sorted.forEach(t=>t.draw(ctx));
  drawBullets();
  drawExplosions();
  drawParticles();
  ctx.restore();

  // Damage indicator
  if(player&&player.alive&&player.hp<50) {
    ctx.fillStyle=`rgba(255,0,0,${(.3-player.hp/200)*(.5+Math.sin(Date.now()/300)*.3)})`;
    ctx.fillRect(0,0,W,H);
  }
}

// ── Start ──
window.addEventListener('load', init);
})();
