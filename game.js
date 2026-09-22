/* Burger Boss - a tiny canvas platformer.
 * You are a burger. Collect every hot dog, avoid the flaming grills,
 * reach the serving table. Four levels, each meaner than the last. */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  /* ---------------------------------------------------------------- tuning */
  const GRAVITY = 2400;
  const MOVE_ACCEL = 3200;
  const MAX_SPEED = 310;
  const GROUND_FRICTION = 2800;
  const AIR_FRICTION = 500;
  const JUMP_V = -800;          // ~133px of hang, ~200px of reach at full tilt
  const JUMP_CUT = 0.35;        // releasing jump early clips the arc
  const MAX_FALL = 1150;
  const COYOTE_TIME = 0.10;
  const JUMP_BUFFER = 0.12;
  const STEP = 1 / 120;
  const FLAME_H = 26;
  const START_LIVES = 3;
  const DOG_W = 34, DOG_H = 24;

  const THEMES = [
    { top: '#6ab04c', body: '#5b3a24', edge: '#8fd45e', plank: '#a9713f', plankTop: '#c98d55' },
    { top: '#cf7a3f', body: '#5a3320', edge: '#eb9a55', plank: '#9d6237', plankTop: '#bf7f4c' },
    { top: '#8e8f9c', body: '#39333f', edge: '#b3b4c1', plank: '#6d6a78', plankTop: '#8f8c9b' },
    { top: '#7d6a3c', body: '#241c2b', edge: '#a89150', plank: '#4f3f4a', plankTop: '#6d5a63' }
  ];

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* Constant-speed ping-pong used by every moving grill and platform. */
  function patrolOffset(p, time) {
    const period = (p.range * 2) / p.speed;
    let u = ((time + (p.offset || 0)) % period) / period;
    if (u < 0) u += 1;
    return p.range * (u < 0.5 ? u * 2 : 2 - u * 2);
  }

  /* ----------------------------------------------------------------- audio */
  let muted = false;
  const sfx = (() => {
    let ac = null;
    function ready() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ac && AC) ac = new AC();
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, dur, type, vol, slideTo) {
      if (muted) return;
      const a = ready();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.05, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur + 0.02);
    }
    return {
      ready,
      jump: () => tone(300, 0.15, 'square', 0.045, 640),
      collect: () => { tone(760, 0.07, 'square', 0.05); setTimeout(() => tone(1020, 0.09, 'square', 0.05), 65); },
      die: () => tone(320, 0.45, 'sawtooth', 0.06, 70),
      clear: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.055), i * 110))
    };
  })();

  /* ----------------------------------------------------------------- input */
  const held = Object.create(null);
  const LEFT = ['ArrowLeft', 'KeyA'];
  const RIGHT = ['ArrowRight', 'KeyD'];
  const JUMP = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'];
  const CONFIRM = ['Space', 'Enter', 'NumpadEnter'];
  const anyHeld = list => list.some(c => held[c]);

  let jumpBuffer = 0;
  let confirmHit = false;

  addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    held[e.code] = true;
    sfx.ready();
    if (JUMP.includes(e.code)) jumpBuffer = JUMP_BUFFER;
    if (CONFIRM.includes(e.code)) confirmHit = true;
    if (e.code === 'KeyM') muted = !muted;
    if (e.code === 'KeyR' && game.state === 'play') resetLevel(false);
  });
  addEventListener('keyup', e => { held[e.code] = false; });
  addEventListener('blur', () => { for (const k in held) held[k] = false; });

  /* Tapping the canvas works as a jump/confirm so it is playable on a couch. */
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    sfx.ready();
    jumpBuffer = JUMP_BUFFER;
    confirmHit = true;
  });

  /* ------------------------------------------------------------ game state */
  const game = {
    state: 'title',     // title | play | dying | clear | gameover | win
    levelIndex: 0,
    lives: START_LIVES,
    deaths: 0,
    time: 0,
    t: 0,               // never-resetting clock, drives all animation
    timer: 0,
    intro: 0,
    flash: 0
  };

  const player = {
    x: 0, y: 0, w: 42, h: 40,
    vx: 0, vy: 0,
    onGround: false, coyote: 0, face: 1,
    squash: 0, walk: 0, spin: 0
  };
  player.riding = null;

  const cam = { x: 0 };
  let level = null;

  function buildLevel(data) {
    return {
      data,
      theme: THEMES[Math.min(game.levelIndex, THEMES.length - 1)],
      platforms: data.platforms.map(p => ({
        x: p.x, y: p.y, w: p.w, h: p.h, bx: p.x, by: p.y,
        patrol: p.patrol || null, dx: 0, dy: 0
      })),
      grills: data.grills.map(g => ({
        x: g.x, y: g.y, w: g.w, h: g.h, bx: g.x, by: g.y,
        patrol: g.patrol || null, pulse: g.pulse || null, lit: true, warn: false
      })),
      hotdogs: data.hotdogs.map((d, i) => ({ x: d.x, y: d.y, taken: false, phase: i * 0.9 })),
      goal: { x: data.goal.x, y: data.goal.y, w: 58, h: 76 },
      left: data.hotdogs.length
    };
  }

  function resetLevel(costLife) {
    if (costLife) game.deaths++;
    level = buildLevel(LEVELS[game.levelIndex]);
    player.x = level.data.spawn.x;
    player.y = level.data.spawn.y;
    player.vx = player.vy = 0;
    player.onGround = false;
    player.coyote = 0;
    player.face = 1;
    player.squash = 0;
    player.spin = 0;
    player.riding = null;
    game.state = 'play';
    game.intro = 2.2;
    updateCamera(true);
  }

  function startRun() {
    game.levelIndex = 0;
    game.lives = START_LIVES;
    game.deaths = 0;
    game.time = 0;
    resetLevel(false);
  }

  function die() {
    if (game.state !== 'play') return;
    game.state = 'dying';
    game.timer = 1.1;
    game.flash = 0.25;
    game.lives--;
    player.vy = -520;
    player.vx = -player.face * 90;
    sfx.die();
  }

  function clearLevel() {
    game.state = 'clear';
    game.timer = 0.6;
    sfx.clear();
  }

  /* -------------------------------------------------------------- simulate */
  function updateCamera(instant) {
    const target = clamp(player.x + player.w / 2 - W / 2, 0, Math.max(0, level.data.width - W));
    cam.x = instant ? target : cam.x + (target - cam.x) * 0.09;
  }

  function updateMovers() {
    for (const p of level.platforms) {
      if (!p.patrol) continue;
      const o = patrolOffset(p.patrol, game.t);
      const nx = p.patrol.axis === 'x' ? p.bx + o : p.bx;
      const ny = p.patrol.axis === 'y' ? p.by + o : p.by;
      p.dx = nx - p.x;
      p.dy = ny - p.y;
      p.x = nx;
      p.y = ny;
    }
    for (const g of level.grills) {
      if (g.patrol) {
        const o = patrolOffset(g.patrol, game.t);
        g.x = g.patrol.axis === 'x' ? g.bx + o : g.bx;
        g.y = g.patrol.axis === 'y' ? g.by + o : g.by;
      }
      if (g.pulse) {
        const period = g.pulse.on + g.pulse.off;
        let ph = (game.t + (g.pulse.offset || 0)) % period;
        if (ph < 0) ph += period;
        g.lit = ph < g.pulse.on;
        g.warn = !g.lit && period - ph < 0.5;   // sputtering back to life
      }
    }
  }

  function hazardBox(g) {
    return { x: g.x + 4, y: g.y - FLAME_H, w: g.w - 8, h: g.h + FLAME_H };
  }

  function movePlayer(dt) {
    const dir = (anyHeld(RIGHT) ? 1 : 0) - (anyHeld(LEFT) ? 1 : 0);
    if (dir !== 0) {
      player.vx += dir * MOVE_ACCEL * dt;
      player.face = dir;
    } else {
      const f = (player.onGround ? GROUND_FRICTION : AIR_FRICTION) * dt;
      player.vx = Math.abs(player.vx) <= f ? 0 : player.vx - Math.sign(player.vx) * f;
    }
    player.vx = clamp(player.vx, -MAX_SPEED, MAX_SPEED);
    player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL);

    // ride whatever we were standing on last step
    if (player.riding) {
      player.x += player.riding.dx;
      player.y += player.riding.dy;
    }

    player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);
    if (jumpBuffer > 0 && player.coyote > 0) {
      player.vy = JUMP_V;
      player.onGround = false;
      player.coyote = 0;
      jumpBuffer = 0;
      player.squash = -0.35;
      sfx.jump();
    }
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (!anyHeld(JUMP) && player.vy < JUMP_V * JUMP_CUT) player.vy = JUMP_V * JUMP_CUT;

    // horizontal sweep
    player.x += player.vx * dt;
    for (const p of level.platforms) {
      if (!overlaps(player, p)) continue;
      if (player.vx > 0) player.x = p.x - player.w;
      else if (player.vx < 0) player.x = p.x + p.w;
      else continue;
      player.vx = 0;
    }
    player.x = clamp(player.x, 0, level.data.width - player.w);

    // vertical sweep
    const wasOn = player.onGround;
    player.onGround = false;
    player.riding = null;
    player.y += player.vy * dt;
    for (const p of level.platforms) {
      if (!overlaps(player, p)) continue;
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.riding = p;
        if (!wasOn) player.squash = 0.3;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
      }
    }

    player.walk = player.onGround && Math.abs(player.vx) > 20
      ? player.walk + Math.abs(player.vx) * dt * 0.045
      : 0;
    player.squash += (0 - player.squash) * Math.min(1, dt * 12);
  }

  function update(dt) {
    game.t += dt;
    game.flash = Math.max(0, game.flash - dt);

    if (game.state === 'title') {
      if (confirmHit) { confirmHit = false; startRun(); }
      return;
    }

    if (game.state === 'play') {
      game.time += dt;
      game.intro = Math.max(0, game.intro - dt);
      updateMovers();
      movePlayer(dt);
      updateCamera(false);

      for (const d of level.hotdogs) {
        if (d.taken) continue;
        if (overlaps(player, { x: d.x, y: d.y, w: DOG_W, h: DOG_H })) {
          d.taken = true;
          level.left--;
          sfx.collect();
        }
      }
      for (const g of level.grills) {
        if (g.lit && overlaps(player, hazardBox(g))) return die();
      }
      if (player.y > level.data.height + 120) return die();
      if (level.left === 0 && overlaps(player, level.goal)) return clearLevel();
      return;
    }

    if (game.state === 'dying') {
      player.vy = Math.min(player.vy + GRAVITY * 0.55 * dt, MAX_FALL);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.spin += dt * 7;
      updateCamera(false);
      game.timer -= dt;
      if (game.timer <= 0) {
        if (game.lives > 0) resetLevel(true);
        else { game.deaths++; game.state = 'gameover'; confirmHit = false; }
      }
      return;
    }

    if (game.state === 'clear') {
      game.timer = Math.max(0, game.timer - dt);
      if (game.timer > 0) return;
      if (confirmHit) {
        confirmHit = false;
        if (game.levelIndex < LEVELS.length - 1) {
          game.levelIndex++;
          resetLevel(false);
        } else {
          game.state = 'win';
        }
      }
      return;
    }

    if ((game.state === 'gameover' || game.state === 'win') && confirmHit) {
      confirmHit = false;
      game.state = 'title';
      level = null;
    }
  }

  /* ----------------------------------------------------------------- paint */
  function drawSky() {
    const sky = level ? level.data.sky : ['#8fd4f2', '#d9f0fb'];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky[0]);
    g.addColorStop(1, sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun / heat lamp
    ctx.fillStyle = 'rgba(255,240,190,.75)';
    ctx.beginPath();
    ctx.arc(W - 130 - cam.x * 0.05, 92, 46, 0, Math.PI * 2);
    ctx.fill();

    // parallax condiment hills
    const hills = [
      { c: 'rgba(208,52,44,.30)', k: 0.25, y: 430, r: 190 },
      { c: 'rgba(242,193,78,.35)', k: 0.45, y: 470, r: 150 }
    ];
    for (const hill of hills) {
      ctx.fillStyle = hill.c;
      const span = hill.r * 1.4;
      const start = Math.floor((cam.x * hill.k) / span) * span;
      for (let i = -1; i < W / span + 3; i++) {
        const x = start + i * span - cam.x * hill.k;
        ctx.beginPath();
        ctx.arc(x, hill.y, hill.r, Math.PI, 0);
        ctx.fill();
      }
    }
  }

  function drawPlatform(p, theme) {
    if (p.h >= 40) {                       // thick ground slab
      ctx.fillStyle = theme.body;
      roundRect(p.x, p.y, p.w, p.h, 6);
      ctx.fill();
      ctx.fillStyle = theme.top;
      roundRect(p.x, p.y, p.w, 14, 6);
      ctx.fill();
      ctx.fillStyle = theme.edge;
      for (let x = p.x + 6; x < p.x + p.w - 4; x += 18) ctx.fillRect(x, p.y + 12, 9, 5);
    } else {                               // thin plank / counter
      ctx.fillStyle = p.patrol ? '#7a5230' : theme.plank;
      roundRect(p.x, p.y, p.w, p.h, 5);
      ctx.fill();
      ctx.fillStyle = p.patrol ? '#c2924f' : theme.plankTop;
      roundRect(p.x, p.y, p.w, 6, 3);
      ctx.fill();
      if (p.patrol) {                      // bolts mark the movers
        ctx.fillStyle = '#3a2617';
        ctx.beginPath(); ctx.arc(p.x + 9, p.y + p.h - 7, 2.5, 0, 6.3); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + p.w - 9, p.y + p.h - 7, 2.5, 0, 6.3); ctx.fill();
      }
    }
  }

  function drawFlame(x, y, h, seed) {
    const f = 0.75 + 0.25 * Math.sin(game.t * 11 + seed) + 0.12 * Math.sin(game.t * 23 + seed * 2);
    const hh = h * f;
    const w = hh * 0.52;
    const grad = ctx.createLinearGradient(0, y, 0, y - hh);
    grad.addColorStop(0, '#ff4d1a');
    grad.addColorStop(0.55, '#ff9a1f');
    grad.addColorStop(1, '#ffe97a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 0.9, y - hh * 0.6, x, y - hh);
    ctx.quadraticCurveTo(x + w * 0.9, y - hh * 0.6, x + w, y);
    ctx.quadraticCurveTo(x, y + 4, x - w, y);
    ctx.fill();
  }

  function drawGrill(g) {
    ctx.fillStyle = '#2a2a30';           // legs
    ctx.fillRect(g.x + 8, g.y + g.h - 4, 7, 6);
    ctx.fillRect(g.x + g.w - 15, g.y + g.h - 4, 7, 6);

    ctx.fillStyle = '#3a3a44';           // kettle body
    roundRect(g.x, g.y + 12, g.w, g.h - 12, 8);
    ctx.fill();
    ctx.fillStyle = '#55555f';
    roundRect(g.x + 4, g.y + 16, g.w - 8, 8, 4);
    ctx.fill();

    ctx.fillStyle = '#191920';           // coal bed
    roundRect(g.x + 6, g.y + 4, g.w - 12, 12, 4);
    ctx.fill();
    const embers = g.lit ? '#ff6a2a' : g.warn ? '#8a3a18' : '#4a2a20';
    ctx.fillStyle = embers;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(g.x + 10 + i * ((g.w - 20) / 4), g.y + 7 + (i % 2), 8, 5);
    }

    if (g.lit) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.arc(g.x + g.w / 2, g.y, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawFlame(g.x + g.w * 0.28, g.y + 6, FLAME_H, g.bx * 0.1);
      drawFlame(g.x + g.w * 0.52, g.y + 4, FLAME_H * 1.25, g.bx * 0.1 + 2);
      drawFlame(g.x + g.w * 0.76, g.y + 6, FLAME_H * 0.9, g.bx * 0.1 + 4);
    } else if (g.warn) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.t * 30);
      drawFlame(g.x + g.w * 0.52, g.y + 4, 9, g.bx);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = '#6c6c78';         // grate
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const x = g.x + 6 + i * ((g.w - 12) / 4);
      ctx.beginPath();
      ctx.moveTo(x, g.y + 2);
      ctx.lineTo(x, g.y + 16);
      ctx.stroke();
    }
  }

  function drawHotdog(d) {
    const bob = Math.sin(game.t * 3 + d.phase) * 4;
    const x = d.x, y = d.y + bob;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(x + DOG_W / 2, y + DOG_H / 2, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#e8a04c';            // bun
    roundRect(x, y + 5, DOG_W, DOG_H - 6, 9);
    ctx.fill();
    ctx.fillStyle = '#c0472f';            // sausage
    roundRect(x + 2, y + 1, DOG_W - 4, 12, 6);
    ctx.fill();
    ctx.strokeStyle = '#f7d046';          // mustard
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const px = x + 5 + i * ((DOG_W - 10) / 5);
      const py = y + 4 + (i % 2 ? 4 : 0);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawGoal(gl, open) {
    const bob = open ? Math.sin(game.t * 4) * 3 : 0;
    ctx.fillStyle = open ? '#f2c14e' : '#7d7466';
    roundRect(gl.x, gl.y + gl.h - 14, gl.w, 14, 6);      // plate
    ctx.fill();
    ctx.fillStyle = open ? '#8a6b3a' : '#5b564d';
    ctx.fillRect(gl.x + gl.w / 2 - 3, gl.y + 6, 6, gl.h - 18);   // pole

    const fx = gl.x + gl.w / 2 + 3, fy = gl.y + 4 + bob;         // checkered flag
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? (open ? '#ffffff' : '#9a938a') : (open ? '#d0342c' : '#5b564d');
        ctx.fillRect(fx + c * 9, fy + r * 9, 9, 9);
      }
    }
    if (!open) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LOCKED', gl.x + gl.w / 2, gl.y + gl.h + 14);
    }
  }

  /* The sprite is drawn to fit inside the 42x40 hitbox so the burger never
   * visually clips through a ceiling it is allowed to stand under. */
  function drawBurger(px, py, squash, spin, face, walk) {
    const w = player.w, h = player.h;
    ctx.save();
    ctx.translate(px + w / 2, py + h);
    if (spin) ctx.rotate(spin);
    ctx.scale((1 + squash * 0.35) * (face < 0 ? -1 : 1), 1 - squash * 0.35);
    ctx.translate(-w / 2, -h);

    ctx.fillStyle = 'rgba(0,0,0,.18)';                    // shadow puddle
    ctx.beginPath();
    ctx.ellipse(w / 2, h + 2, w * 0.42, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const lift = Math.abs(Math.sin(walk)) * 3;            // little feet
    ctx.fillStyle = '#4a2f1c';
    roundRect(9, h - 5 - lift, 10, 6, 3); ctx.fill();
    roundRect(w - 19, h - 5 - (3 - lift), 10, 6, 3); ctx.fill();

    ctx.fillStyle = '#e2a25c';                            // bottom bun
    roundRect(1, h - 12, w - 2, 12, 6); ctx.fill();
    ctx.fillStyle = '#6d3f1f';                            // patty
    roundRect(0, h - 19, w, 9, 4); ctx.fill();
    ctx.fillStyle = '#f5c542';                            // cheese + drips
    roundRect(1, h - 24, w - 2, 7, 3); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, h - 18); ctx.lineTo(11, h - 11); ctx.lineTo(16, h - 18);
    ctx.moveTo(24, h - 18); ctx.lineTo(29, h - 12); ctx.lineTo(34, h - 18);
    ctx.fill();
    ctx.fillStyle = '#5fbf4a';                            // lettuce
    ctx.beginPath();
    ctx.moveTo(0, h - 24);
    for (let i = 0; i <= 6; i++) ctx.lineTo(i * (w / 6), h - 24 + (i % 2 ? 5 : 0));
    ctx.lineTo(w, h - 29); ctx.lineTo(0, h - 29);
    ctx.fill();

    ctx.fillStyle = '#f0b464';                            // top bun dome
    ctx.beginPath();
    ctx.moveTo(1, h - 26);
    ctx.quadraticCurveTo(w / 2, h - 54, w - 1, h - 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,244,222,.9)';               // sesame
    [[12, h - 30], [21, h - 35], [30, h - 30]]
      .forEach(([sx, sy]) => { ctx.beginPath(); ctx.ellipse(sx, sy, 2.6, 1.6, 0.4, 0, 6.3); ctx.fill(); });

    ctx.fillStyle = '#20140c';                            // eyes
    ctx.beginPath(); ctx.arc(15, h - 33, 3.1, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(27, h - 33, 3.1, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(16, h - 34, 1.1, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(28, h - 34, 1.1, 0, 6.3); ctx.fill();
    ctx.restore();
  }

  function panel(lines, opts) {
    const o = opts || {};
    ctx.fillStyle = 'rgba(20,12,8,' + (o.dim === undefined ? 0.72 : o.dim) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    let y = o.top || 170;
    for (const line of lines) {
      ctx.font = 'bold ' + line.size + 'px "Trebuchet MS", sans-serif';
      ctx.fillStyle = line.color || '#fff4e0';
      if (line.blink && Math.sin(game.t * 4) < -0.2) { y += line.size + 16; continue; }
      ctx.fillText(line.text, W / 2, y);
      y += line.size + (line.gap === undefined ? 16 : line.gap);
    }
    ctx.textAlign = 'left';
  }

  function drawHUD() {
    ctx.fillStyle = 'rgba(20,12,8,.45)';
    roundRect(12, 10, 250, 34, 8); ctx.fill();
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#f2c14e';
    ctx.textAlign = 'left';
    ctx.fillText('LEVEL ' + (game.levelIndex + 1) + '  ' + level.data.name, 24, 33);

    const got = level.data.hotdogs.length - level.left;
    ctx.fillStyle = 'rgba(20,12,8,.45)';
    roundRect(W / 2 - 78, 10, 156, 34, 8); ctx.fill();
    ctx.save();
    ctx.translate(W / 2 - 62, 16);
    ctx.scale(0.62, 0.62);
    drawHotdog({ x: 0, y: 0, phase: 0 });
    ctx.restore();
    ctx.fillStyle = got === level.data.hotdogs.length ? '#8ce67a' : '#fff4e0';
    ctx.fillText(got + ' / ' + level.data.hotdogs.length, W / 2 - 22, 33);

    ctx.fillStyle = 'rgba(20,12,8,.45)';
    roundRect(W - 152, 10, 140, 34, 8); ctx.fill();
    ctx.fillStyle = '#fff4e0';
    ctx.fillText('LIVES', W - 140, 33);
    for (let i = 0; i < Math.max(0, game.lives); i++) {
      ctx.save();
      ctx.translate(W - 78 + i * 22, 14);
      ctx.scale(0.45, 0.45);
      drawBurger(0, 0, 0, 0, 1, 0);
      ctx.restore();
    }

    if (game.intro > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, game.intro / 0.6);
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#fff4e0';
      ctx.strokeStyle = 'rgba(20,12,8,.8)';
      ctx.lineWidth = 5;
      ctx.strokeText(level.data.name, W / 2, 150);
      ctx.fillText(level.data.name, W / 2, 150);
      ctx.font = '17px "Trebuchet MS", sans-serif';
      ctx.strokeText(level.data.hint, W / 2, 180);
      ctx.fillText(level.data.hint, W / 2, 180);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  function drawTitle() {
    ctx.save();
    ctx.translate(W / 2 - 21, 330);
    ctx.scale(1.7, 1.7);
    drawBurger(0, 0, Math.sin(game.t * 2) * 0.06, 0, 1, 0);
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      drawHotdog({ x: 250 + i * 210, y: 250, phase: i * 1.3 });
    }
    panel([
      { text: 'BURGER BOSS', size: 62, color: '#f2c14e', gap: 6 },
      { text: 'Collect every hot dog. Dodge the flaming grills.', size: 19, gap: 30 },
      { text: 'Arrows / WASD to move  •  Space to jump', size: 16, color: '#d8c3a5', gap: 8 },
      { text: 'R restarts a level  •  M mutes', size: 16, color: '#d8c3a5', gap: 150 },
      { text: 'PRESS SPACE TO COOK', size: 26, color: '#ff9a3c', blink: true }
    ], { dim: 0.55, top: 130 });
  }

  function render() {
    drawSky();

    if (level && game.state !== 'title') {
      ctx.save();
      ctx.translate(-Math.round(cam.x), 0);
      for (const p of level.platforms) drawPlatform(p, level.theme);
      for (const d of level.hotdogs) if (!d.taken) drawHotdog(d);
      drawGoal(level.goal, level.left === 0);
      for (const g of level.grills) drawGrill(g);
      drawBurger(player.x, player.y, player.squash, player.spin, player.face, player.walk);
      ctx.restore();
      drawHUD();
    }

    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(255,90,40,' + (game.flash * 1.6) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (game.state === 'title') drawTitle();

    if (game.state === 'clear') {
      panel([
        { text: 'LEVEL ' + (game.levelIndex + 1) + ' SERVED!', size: 46, color: '#8ce67a' },
        { text: 'All ' + level.data.hotdogs.length + ' hot dogs rescued.', size: 20, gap: 40 },
        { text: game.levelIndex < LEVELS.length - 1
            ? 'Next up: ' + LEVELS[game.levelIndex + 1].name
            : 'One last course...', size: 22, color: '#f2c14e', gap: 60 },
        { text: 'PRESS SPACE', size: 24, color: '#ff9a3c', blink: true }
      ], { top: 180 });
    }

    if (game.state === 'gameover') {
      panel([
        { text: 'WELL DONE', size: 58, color: '#d0342c' },
        { text: '...and that is not a compliment.', size: 20, gap: 40 },
        { text: 'You were flame-grilled on level ' + (game.levelIndex + 1) + '.', size: 20, gap: 70 },
        { text: 'PRESS SPACE FOR THE TITLE SCREEN', size: 22, color: '#ff9a3c', blink: true }
      ], { top: 180 });
    }

    if (game.state === 'win') {
      panel([
        { text: 'YOU ARE THE BURGER BOSS', size: 44, color: '#f2c14e' },
        { text: 'Every hot dog saved. Every grill survived.', size: 20, gap: 40 },
        { text: 'Time: ' + game.time.toFixed(1) + 's   •   Deaths: ' + game.deaths, size: 22, gap: 70 },
        { text: 'PRESS SPACE TO PLAY AGAIN', size: 22, color: '#ff9a3c', blink: true }
      ], { top: 180 });
    }

    if (muted) {
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.fillStyle = 'rgba(255,244,224,.6)';
      ctx.fillText('muted', 16, H - 14);
    }
  }

  /* ------------------------------------------------------------- main loop */
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 8) {
      update(STEP);
      acc -= STEP;
    }
    confirmHit = false;
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // handy for poking at the game from the console, and used by test.html
  window.BurgerBoss = { game, player, levels: LEVELS, themes: THEMES, get level() { return level; } };
})();
