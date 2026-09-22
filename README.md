# Burger Boss

A small browser platformer. You are a burger. Every hot dog on the level needs
rescuing, every grill on the level wants you medium-rare. Four courses, each
one meaner than the last.

![no build step, no dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

## Play
Access via cloudflare: https://burger-boss.pages.dev
Open `index.html` in any modern browser. That is the whole install.

Or serve it locally if you prefer:

```bash
python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` or `A` `D` | Move |
| `Space`, `W`, `↑` | Jump (hold for a higher hop) |
| `R` | Restart the current level |
| `M` | Mute |

Tapping the canvas also jumps, so it works on a touchscreen. On a touchscreen
device, on-screen move/jump buttons appear over the canvas automatically
(`mobile-controls.js` - it just dispatches the same keyboard events a keyboard
would, so the game engine doesn't know the difference). The &#9974; button in
the corner enters fullscreen on any device.

## The rules

- Collect **every** hot dog on a level. The exit flag stays `LOCKED` until you do.
- Touching a lit grill costs a life. So does falling off the world.
- Three lives for the whole run. Run out and you start over from level 1.

## The four levels

1. **Backyard Cookout** — 6 hot dogs, 2 grills that just sit there. A warm-up.
2. **Grill Alley** — 8 hot dogs, wider gaps, grills that patrol, and one that
   flares on a timer. Wait for it to go out, then walk through.
3. **Inferno Kitchen** — 10 hot dogs, long jumps, fast patrolling grills, and
   platforms that move under your feet.
4. **Grease Trap** — 12 hot dogs and the longest run of the four. Timed grills
   come in pairs now, so crossing a ledge means reading two flames instead of
   one and waiting in the gap between them. The last hot dog sits on a perch
   you reach by riding a lift up, and a grill paces the floor in front of the
   exit.

## Leaderboard

Beat all four levels and the win screen shows a **Submit to the public
leaderboard** button, carrying your run's time and death count to a
[shared leaderboard](https://claude.ai/code/artifact/ea98dca6-43e5-4ae4-87fe-262a337fa8d2)
that updates for everyone as soon as a new time lands — top 20, fastest first.

A submitted time is checked against a floor computed from the game's own
physics (a run can never legitimately finish faster than each level's width
divided by the burger's top speed) and against the rule that a winning run has
at most 2 deaths (a 3rd ends the run before it can be won). That check runs
twice — once before your own run is posted, and again on every post the page
reads back from a relay, so a bad entry can't reach the board no matter how it
got onto a relay. It stops a typo or a joke entry, not a determined person
signing a fake event by hand: Nostr is fully permissionless, so anyone can
post directly to a relay without going through this page at all. There's no
server here validating against real play, only public math anyone can also
run for themselves — treat the board as fun rather than an anti-cheat
guarantee.

`leaderboard.html`, `leaderboard.css`, and `nostr-leaderboard.js` are the
whole leaderboard; `vendor/nostr-tools.bundle.js` is the (unmodified,
[Unlicense](https://github.com/nbd-wtf/nostr-tools)-licensed) library that
handles the actual signing and relay connections. None of it touches the game
engine — `leaderboard-link.js` just watches for the win screen and builds the
link over in `index.html`.

## How it works

No build step, no dependencies:

- `index.html` — the page and the canvas.
- `levels.js` — pure level data. Platforms, grills, hot dogs, spawn, exit.
- `game.js` — input, physics, collision, and all the drawing.
- `leaderboard-link.js` — additive only; shows the leaderboard link on the win
  screen. The engine has no idea it exists.
- `mobile-controls.js` — additive only; the fullscreen button and the
  on-screen move/jump buttons, driving the engine with real `KeyboardEvent`s
  the same way a keyboard does.
- `leaderboard.html` / `leaderboard.css` / `nostr-leaderboard.js` — the
  leaderboard page: identity, validation, signing, and relay I/O.
- `vendor/nostr-tools.bundle.js` — vendored, unmodified copy of
  [nostr-tools](https://github.com/nbd-wtf/nostr-tools) v2.25.0.

The physics run on a fixed 120 Hz timestep with a variable-rate render loop, so
the feel is identical whether your display is 60 Hz or 144 Hz. Movement has
coyote time and a jump buffer, so late and early jump presses both work the way
you expect them to.

### Making your own level

Add an object to the `LEVELS` array in [`levels.js`](levels.js). Everything is
plain data in world pixels:

```js
{
  name: 'Deep Fryer',
  hint: 'Shown for two seconds when the level starts.',
  width: 2400,               // levels are always 540 tall, and scroll sideways
  height: 540,
  sky: ['#8fd4f2', '#d9f0fb'],
  spawn: { x: 60, y: 400 },
  platforms: [
    { x: 0, y: 480, w: 600, h: 60 },                                  // solid
    { x: 700, y: 360, w: 120, h: 20, patrol: { axis: 'y', range: 130, speed: 55 } }
  ],
  grills: [
    { x: 300, y: 432, w: 80, h: 48 },                                 // always lit
    { x: 900, y: 432, w: 80, h: 48, patrol: { axis: 'x', range: 150, speed: 80 } },
    { x: 1200, y: 432, w: 80, h: 48, pulse: { on: 1.2, off: 0.9 } }    // timed
  ],
  hotdogs: [{ x: 200, y: 446 }],
  goal: { x: 2200, y: 404 }
}
```

Useful numbers when you are placing things: the burger jumps about **133 px**
high and clears about **200 px** of gap at full speed, so keep vertical steps
under ~120 px and gaps under ~180 px if you want the level to be beatable.

## Tests

Open `test.html` in the browser (or visit `/test.html` on the local server). It
freezes the animation loop, drives the real game code frame by frame with a
scripted 60 Hz clock, and reports pass/fail for 75 checks: level geometry (are
all the gaps jumpable, does every hot dog sit on a surface, do patrolling
grills stay on their ledge), physics (jump height, jump distance, friction),
hazards, collection, the locked exit, level progression, moving platforms,
timed grills, and lives. It is deterministic and needs no tooling.

Open `test-leaderboard.html` for the leaderboard's own suite — signs and
verifies real events with the vendored nostr-tools library, and checks the
physics floor, name sanitization, per-identity best-time replacement, and
top-20 sorting. It makes no relay connections, so it's safe to run offline or
repeatedly.

## License

MIT — see [LICENSE](LICENSE).
