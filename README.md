# Tap Bounce

**Play now: [tap-bounce.aryayi.dev](https://tap-bounce.aryayi.dev/)**

A one-tap endless bouncer. A ball runs along a scrolling track:

- **Tap anywhere (or press Space)** to hop over the **red ground blocks** — with
  a springy "boing".
- **Roll _under_ the cyan floating spikes** — if you jump into one, you're out
  (to a comedic crash sound).
- **Pause** any time with the top-right button (or `P` / `Esc`).
- **Mute** with the speaker button next to pause (or `M`).

The world speeds up the longer you survive. Hit anything and you're out; tap
again to restart instantly. Your best score — and your mute preference — are
saved on the device.

All sound effects are **synthesized at runtime with the Web Audio API**, so there
are still no audio files to ship.

Written in **TypeScript**, compiled to a single dependency-free HTML5 Canvas
script — no runtime libraries, no assets. It runs in any modern mobile or
desktop browser and is designed to be wrapped into an Android APK later
(e.g. Capacitor or a Trusted Web Activity).

## Play locally

With Node installed:

```bash
npm start          # compiles TS, then serves on http://localhost:8080
```

`game.js` is committed (built from `game.ts`), so you can also just open
`index.html` directly in a browser without building.

On a phone, serve over your LAN and open the machine's IP:8080, or add to the
home screen for a full-screen experience.

## Develop

```bash
npm run build      # compile game.ts -> game.js
npm run watch      # recompile on save
npm run serve      # static server without rebuilding
```

## Files

| File | Purpose |
|---|---|
| `index.html` | Full-screen canvas + mobile viewport/input setup. |
| `game.ts` | Source of truth: loop, physics, spawning, collision, rendering, HUD. |
| `game.js` | Compiled output referenced by `index.html` (generated from `game.ts`). |
| `tsconfig.json` | Strict TypeScript config. |
| `LICENSE` | MIT license. |

## How it works

- **Resolution independent** — everything scales from the canvas height (`S`),
  so it looks and plays the same on any screen.
- **Delta-time physics** — feel is identical regardless of frame rate; large
  frame gaps (tab switches) are clamped.
- **Two obstacle kinds** — _ground_ blocks you hop over, and _floating_ blocks
  you roll under. Each obstacle stores a height and a ground clearance (`gap`),
  and its rectangle is derived from `groundY` at draw/collision time, so both
  kinds stay correct across resizes. A ground clearance of ~1.5 ball diameters
  lets a grounded ball pass safely while any real hop collides.
- **Difficulty ramp** — scroll speed rises with time; obstacle spacing is
  time-based, so gaps stay fair as speed climbs. Ground heights are capped below
  the jump apex; floating blocks unlock after a short warm-up and grow more
  common over time.
- **States** — Menu → Playing (with pause) → Game Over → instant restart (with a
  short lockout so the killing tap doesn't immediately retry). Pausing freezes
  the world; the game also auto-pauses when the tab is hidden.
- **Sound** — jump and crash effects are synthesized on the fly (oscillators +
  a noise burst); the `AudioContext` is created lazily on the first tap to
  satisfy autoplay policies.
- **Persistence** — best score (`tapbounce.best`) and mute preference
  (`tapbounce.muted`) in `localStorage`.

## Tuning

Gameplay constants live near the top of `game.ts` (gravity, jump velocity,
base/max speed, speed ramp, spawn cadence, and the floating-obstacle unlock time
and probability). Adjust, run `npm run build`, and reload.

## Packaging for Android (later)

Wrap the static files with [Capacitor](https://capacitorjs.com/) or ship as a
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/).
No code changes required — input already uses pointer/touch events and the
layout is full-bleed with `viewport-fit=cover`.

## License

[MIT](LICENSE) © 2026 Mahdi Aryayi
