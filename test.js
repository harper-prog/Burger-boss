/* Deterministic self test. Open test.html in a browser; every check runs
 * synchronously against the real game code with a scripted 60 Hz clock. */
(() => {
  const BB = window.BurgerBoss;
  const out = [];
  let passed = 0, failed = 0;

  const ok = (name, cond, detail) => {
    (cond ? passed++ : failed++);
    out.push((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const section = t => out.push('\n' + t);

  /* ---- frame driver ---------------------------------------------------- */
  let clock = performance.now();
  function frames(n) {
    for (let i = 0; i < n; i++) {
      const cb = window.__cb;
      if (!cb) throw new Error('animation loop stopped after ' + i + ' frames');
      window.__cb = null;
      clock += 1000 / 60;
      cb(clock);
    }
  }
  const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const hold = code => key('keydown', code);
  const drop = code => key('keyup', code);
  const tap = code => { key('keydown', code); frames(1); key('keyup', code); };

  const G = BB.game, P = BB.player;
  const put = (x, y) => { P.x = x; P.y = y; P.vx = 0; P.vy = 0; };

  /* ---- 1. static level design ------------------------------------------ */
  section('level data');
  const MAX_RISE = 133;      // v^2 / 2g with JUMP_V 800, GRAVITY 2400
  const MAX_GAP = 207;       // airtime * MAX_SPEED

  ok('the game ships four courses', BB.levels.length === 4, BB.levels.length + ' levels');
  ok('the fourth course is Grease Trap', BB.levels[3] && BB.levels[3].name === 'Grease Trap',
    BB.levels.map(L => L.name).join(' / '));
  ok('every level has its own palette', BB.themes && BB.themes.length >= BB.levels.length,
    (BB.themes ? BB.themes.length : 0) + ' themes for ' + BB.levels.length + ' levels');

  BB.levels.forEach((L, i) => {
    const tag = 'L' + (i + 1);
    const ground = L.platforms.filter(p => p.h >= 40).sort((a, b) => a.x - b.x);

    let worstGap = 0;
    for (let k = 1; k < ground.length; k++) {
      worstGap = Math.max(worstGap, ground[k].x - (ground[k - 1].x + ground[k - 1].w));
    }
    ok(tag + ' gaps are jumpable', worstGap <= MAX_GAP - 15, 'widest gap ' + worstGap + 'px, limit ' + (MAX_GAP - 15));

    // every hot dog needs a surface under it, close enough to stand and grab
    let unsupported = [];
    L.hotdogs.forEach(d => {
      const under = L.platforms.filter(p => p.x < d.x + 34 && p.x + p.w > d.x && p.y >= d.y);
      if (!under.length) { unsupported.push(Math.round(d.x) + ' (nothing under it)'); return; }
      const top = Math.min(...under.map(p => p.y));
      if (top - (d.y + 24) > 40) unsupported.push(Math.round(d.x) + ' (floats ' + Math.round(top - d.y - 24) + 'px up)');
    });
    ok(tag + ' every hot dog sits on a surface', unsupported.length === 0, unsupported.join(', '));

    // nothing collectible should be buried inside a grill
    const burned = L.hotdogs.filter(d => L.grills.some(g =>
      d.x < g.x + g.w && d.x + 34 > g.x && d.y < g.y + g.h && d.y + 24 > g.y - 26));
    ok(tag + ' no hot dog inside a grill', burned.length === 0, burned.map(d => d.x).join(', '));

    // patrolling hazards must stay over their own ground segment
    const strays = L.grills.filter(g => {
      if (!g.patrol || g.patrol.axis !== 'x') return false;
      const end = g.x + g.patrol.range + g.w;
      return !ground.some(p => p.x <= g.x && p.x + p.w >= end);
    });
    ok(tag + ' patrolling grills stay on their ledge', strays.length === 0, strays.map(g => g.x).join(', '));

    const goalStands = L.platforms.some(p =>
      p.x <= L.goal.x && p.x + p.w >= L.goal.x + 58 && near(p.y, L.goal.y + 76, 2));
    ok(tag + ' exit flag stands on solid ground', goalStands);

    const spawnClear = !L.grills.some(g =>
      L.spawn.x < g.x + g.w && L.spawn.x + 42 > g.x);
    ok(tag + ' spawn point is not on a grill', spawnClear);
  });

  /* ---- 2. boot and basic movement -------------------------------------- */
  section('movement');
  frames(2);
  ok('boots to the title screen', G.state === 'title', 'state ' + G.state);
  tap('Enter');
  frames(2);
  ok('Enter starts a run', G.state === 'play' && G.levelIndex === 0, 'state ' + G.state);

  frames(30);
  ok('burger falls onto the ground', P.onGround && near(P.y, 440, 1), 'y ' + P.y.toFixed(1));

  const x0 = P.x;
  hold('ArrowRight'); frames(60); drop('ArrowRight');
  ok('running right reaches full speed', P.x > x0 + 200 && near(Math.abs(P.vx), 310, 6), 'moved ' + Math.round(P.x - x0) + 'px at ' + P.vx.toFixed(0) + 'px/s');
  frames(20);
  ok('friction brings it to a stop', near(P.vx, 0, 1), 'vx ' + P.vx.toFixed(2));

  // jump height, holding the button for the full arc
  put(120, 440); frames(4);
  const floor = P.y;
  hold('Space');
  let peak = floor;
  for (let i = 0; i < 70; i++) { frames(1); peak = Math.min(peak, P.y); }
  drop('Space');
  ok('jump clears a grill (74px tall)', floor - peak > 110, 'peak rise ' + Math.round(floor - peak) + 'px');

  // jump distance at speed
  frames(60);
  put(60, 440); frames(4);
  hold('ArrowRight'); frames(45);
  const jx = P.x;
  hold('Space'); frames(50); drop('Space'); drop('ArrowRight');
  ok('jump clears the widest gap in the game', P.x - jx > 170, 'travelled ' + Math.round(P.x - jx) + 'px');

  section('hazards');
  const lives0 = G.lives;
  const grill = BB.level.grills[0];
  put(grill.x + 10, grill.y - 10);
  frames(2);
  ok('touching a lit grill kills', G.state === 'dying' && G.lives === lives0 - 1, 'state ' + G.state + ', lives ' + G.lives);
  frames(80);
  ok('respawns at the start of the level', G.state === 'play' && near(P.x, BB.level.data.spawn.x, 1), 'x ' + P.x.toFixed(0));

  const lives1 = G.lives;
  put(300, 900); frames(2);
  ok('falling off the world kills', G.state === 'dying' && G.lives === lives1 - 1, 'state ' + G.state);
  frames(80);

  // a pulsing grill has to actually go out, and come back
  section('timed grills');
  const pulseLevel = BB.levels.findIndex(L => L.grills.some(g => g.pulse));
  ok('some level has a timed grill', pulseLevel >= 0, 'level ' + (pulseLevel + 1));

  /* ---- 3. collect, unlock, advance ------------------------------------- */
  section('objectives and progression');

  function beatLevel() {
    const L = BB.level;
    const total = L.data.hotdogs.length;
    // walk onto the exit while dogs are missing: it must stay shut
    put(L.goal.x + 4, L.goal.y + 20);
    frames(2);
    const stayedShut = G.state === 'play' && L.left === total;
    put(L.data.spawn.x, L.data.spawn.y); frames(2);
    L.hotdogs.forEach(d => { put(d.x - 4, d.y - 6); frames(1); });
    const collected = L.left === 0;
    put(L.goal.x + 4, L.goal.y + 20);
    frames(2);
    return { stayedShut, collected, cleared: G.state === 'clear', total };
  }

  const LAST = BB.levels.length - 1;
  for (let n = 0; n <= LAST; n++) {
    const tag = 'L' + (n + 1);
    ok(tag + ' is the level we are on', G.levelIndex === n, 'levelIndex ' + G.levelIndex);
    const r = beatLevel();
    ok(tag + ' exit stays locked while hot dogs remain', r.stayedShut);
    ok(tag + ' all ' + r.total + ' hot dogs collect', r.collected, 'left ' + BB.level.left);
    ok(tag + ' reaching the open exit clears the level', r.cleared, 'state ' + G.state);
    frames(240);                   // four seconds of nobody touching anything
    ok(tag + ' clear screen waits for a keypress', G.state === 'clear', 'state ' + G.state);
    tap('Space');
    frames(3);
    if (n < LAST) ok(tag + ' advances to the next level', G.state === 'play' && G.levelIndex === n + 1, 'state ' + G.state + ' level ' + (G.levelIndex + 1));
  }
  ok('finishing the last level wins the game', G.state === 'win', 'state ' + G.state);

  const rising = a => a.every((v, i) => i === 0 || v > a[i - 1]);
  const dogCounts = BB.levels.map(L => L.hotdogs.length);
  ok('each level has more hot dogs than the one before', rising(dogCounts), dogCounts.join(','));
  const widths = BB.levels.map(L => L.width);
  ok('each level is longer than the one before', rising(widths), widths.join(' < '));

  /* ---- 4. moving platforms --------------------------------------------- */
  section('moving platforms');
  tap('Space'); frames(3);           // win -> title
  tap('Enter'); frames(3);           // title -> level 1
  const moverLevel = BB.levels.findIndex(L => L.platforms.some(p => p.patrol && p.patrol.axis === 'y'));
  ok('some level has a vertically moving platform', moverLevel >= 0, 'level ' + (moverLevel + 1));
  G.levelIndex = Math.max(moverLevel, 0);   // jump straight to the level with movers
  tap('KeyR'); frames(30);
  ok('the moving-platform level loaded', BB.level.data.name === BB.levels[G.levelIndex].name, BB.level.data.name);

  const mover = BB.level.platforms.find(p => p.patrol && p.patrol.axis === 'y');
  ok('that level has a vertically moving platform', !!mover);
  if (mover) {
    put(mover.x + 30, mover.y - 45);
    frames(10);
    const gap0 = P.y + P.h - mover.y;
    frames(40);
    const gap1 = P.y + P.h - mover.y;
    ok('a rider is carried by the platform', P.onGround && near(gap0, 0, 2) && near(gap1, 0, 2),
      'foot gap ' + gap0.toFixed(1) + ' then ' + gap1.toFixed(1));
    ok('the platform actually moved', Math.abs(mover.y - mover.by) > 10, 'offset ' + (mover.y - mover.by).toFixed(0));
  }

  const pulser = BB.level.grills.find(g => g.pulse);
  if (pulser) {
    const seen = new Set();
    for (let i = 0; i < 400; i++) { frames(1); seen.add(pulser.lit); }
    ok('a timed grill goes out and relights', seen.size === 2, 'states seen: ' + [...seen].join(','));
  }

  /* ---- 5. running out of lives ----------------------------------------- */
  section('lives');
  G.lives = 1;
  put(300, 900); frames(2); frames(90);
  ok('last life lost ends the run', G.state === 'gameover', 'state ' + G.state);
  frames(240);
  ok('game over screen waits for a keypress', G.state === 'gameover', 'state ' + G.state);
  tap('Space'); frames(3);
  ok('game over returns to the title screen', G.state === 'title', 'state ' + G.state);
  frames(240);
  ok('title screen waits for a keypress', G.state === 'title', 'state ' + G.state);
  tap('Space'); frames(240);
  ok('a single press starts a run and nothing more', G.state === 'play' && G.levelIndex === 0 && G.lives === 3,
    'state ' + G.state + ' level ' + (G.levelIndex + 1) + ' lives ' + G.lives);

  /* ---- report ---------------------------------------------------------- */
  document.getElementById('out').textContent = out.join('\n');
  const s = document.getElementById('summary');
  s.textContent = failed === 0
    ? 'ALL ' + passed + ' CHECKS PASSED'
    : failed + ' FAILED, ' + passed + ' passed';
  s.className = failed === 0 ? 'pass' : 'fail';
  document.title = (failed === 0 ? 'PASS ' : 'FAIL ') + passed + '/' + (passed + failed);
})();
