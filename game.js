"use strict";
/*
 * Tap Bounce — a one-tap endless bouncer.
 *
 * A ball runs along a scrolling track. Tap anywhere (or press Space) to hop
 * over ground obstacles — but watch for floating obstacles: roll *under* those
 * and never jump into them. The world speeds up over time. Hit anything and the
 * run ends; tap again to restart instantly. Best score persists on the device.
 *
 * Everything is sized relative to the canvas height (via the scale factor `S`)
 * so the game looks and plays the same on any screen. Physics use delta-time
 * so the feel is independent of frame rate.
 */
(function () {
    'use strict';
    // ---------------------------------------------------------------------------
    // Canvas setup (responsive, DPR-aware)
    // ---------------------------------------------------------------------------
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    let W = 0; // CSS pixel width
    let H = 0; // CSS pixel height
    let S = 1; // scale factor, relative to a 700px reference height
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        W = window.innerWidth;
        H = window.innerHeight;
        S = H / 700;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        // Draw in CSS pixels; the transform handles device pixels.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layout();
    }
    // ---------------------------------------------------------------------------
    // Tunables (all in reference units; multiply by S for pixels)
    // ---------------------------------------------------------------------------
    const GRAVITY = 3000; // px/s^2 (at S=1)
    const JUMP_VELOCITY = 1080; // px/s (upward impulse)
    const BASE_SPEED = 360; // px/s scroll speed at start
    const SPEED_RAMP = 15; // px/s added per second survived
    const MAX_SPEED = 1500; // px/s cap
    const MIN_SPAWN_GAP = 0.85; // seconds between obstacles (keeps ground→air landable)
    const MAX_SPAWN_GAP = 1.65; // seconds between obstacles (slow/easy end)
    const RESTART_LOCKOUT = 0.35; // seconds before a tap can restart after dying
    const AIR_START_TIME = 6; // seconds before floating obstacles can appear
    const AIR_MIN_CHANCE = 0.15; // probability an obstacle floats (early)
    const AIR_MAX_CHANCE = 0.4; // probability an obstacle floats (late)
    // Derived layout values (recomputed on resize)
    let groundY = 0; // top of the ground band
    let ballX = 0; // fixed horizontal position of the ball
    let ballR = 0; // ball radius
    let btn = { x: 0, y: 0, w: 0, h: 0 }; // pause button hit rect
    let muteBtn = { x: 0, y: 0, w: 0, h: 0 }; // mute button hit rect
    function layout() {
        groundY = H * 0.82;
        ballX = W * 0.28;
        ballR = Math.max(10, Math.min(W, H) * 0.032);
        const size = Math.max(40, 46 * S);
        const margin = 16 * S;
        const gapBtn = 14 * S;
        btn = { x: W - margin - size, y: margin, w: size, h: size };
        muteBtn = { x: btn.x - gapBtn - size, y: margin, w: size, h: size };
    }
    // ---------------------------------------------------------------------------
    // Game state
    // ---------------------------------------------------------------------------
    let state = 0 /* State.Menu */;
    let paused = false;
    const ball = { y: 0, vy: 0, onGround: true, rot: 0 };
    let obstacles = [];
    let particles = [];
    let trail = [];
    let speed = BASE_SPEED;
    let elapsed = 0; // seconds survived this run
    let distance = 0; // world scroll distance (drives ground dashes; pause-safe)
    let spawnTimer = 0; // seconds until next obstacle
    let score = 0;
    let best = loadBest();
    let overTimer = 0; // time since game over (for restart lockout + anim)
    let shake = 0; // screen-shake magnitude
    // ---------------------------------------------------------------------------
    // High score persistence
    // ---------------------------------------------------------------------------
    const BEST_KEY = 'tapbounce.best';
    function loadBest() {
        try {
            const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
            return isNaN(v) ? 0 : v;
        }
        catch (e) {
            return 0;
        }
    }
    function saveBest(v) {
        try {
            localStorage.setItem(BEST_KEY, String(v));
        }
        catch (e) {
            /* storage unavailable — best simply won't persist */
        }
    }
    // ---------------------------------------------------------------------------
    // Sound (procedural — no audio files). The AudioContext is created lazily on
    // the first interaction to satisfy browser autoplay policies. A springy
    // "boing" for jumps and a comedic descending "sad-trombone + thud" for crashes.
    // Mute state persists on the device.
    // ---------------------------------------------------------------------------
    const MUTED_KEY = 'tapbounce.muted';
    let muted = loadMuted();
    let audioCtx = null;
    function loadMuted() {
        try {
            return localStorage.getItem(MUTED_KEY) === '1';
        }
        catch (e) {
            return false;
        }
    }
    function saveMuted(v) {
        try {
            localStorage.setItem(MUTED_KEY, v ? '1' : '0');
        }
        catch (e) {
            /* ignore */
        }
    }
    function ensureAudio() {
        if (!audioCtx) {
            const Ctor = window.AudioContext ||
                window
                    .webkitAudioContext;
            if (!Ctor)
                return null;
            try {
                audioCtx = new Ctor();
            }
            catch (e) {
                audioCtx = null;
            }
        }
        if (audioCtx && audioCtx.state === 'suspended')
            void audioCtx.resume();
        return audioCtx;
    }
    function toggleMute() {
        muted = !muted;
        saveMuted(muted);
        if (!muted)
            ensureAudio(); // unlock audio on the same gesture
    }
    /** Springy cartoon "boing": a fast up-sweep with a little dip back down. */
    function playJump() {
        if (muted)
            return;
        const ac = ensureAudio();
        if (!ac)
            return;
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(780, t + 0.09);
        osc.frequency.exponentialRampToValueAtTime(500, t + 0.2);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.24);
    }
    /** Comedy crash: a descending "sad trombone" tone plus a filtered noise thud. */
    function playCrash() {
        if (muted)
            return;
        const ac = ensureAudio();
        if (!ac)
            return;
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.5);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.45, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.62);
        // Short filtered-noise "thud" at the moment of impact.
        const dur = 0.16;
        const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        const noise = ac.createBufferSource();
        noise.buffer = buffer;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.55, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        noise.connect(lp).connect(ng).connect(ac.destination);
        noise.start(t);
        noise.stop(t + dur);
    }
    // ---------------------------------------------------------------------------
    // Run lifecycle
    // ---------------------------------------------------------------------------
    function resetRun() {
        ball.y = groundY - ballR;
        ball.vy = 0;
        ball.onGround = true;
        ball.rot = 0;
        obstacles = [];
        particles = [];
        trail = [];
        speed = BASE_SPEED;
        elapsed = 0;
        distance = 0;
        score = 0;
        spawnTimer = 0.6; // brief grace before the first obstacle
        paused = false;
    }
    function startGame() {
        resetRun();
        state = 1 /* State.Playing */;
        jump(); // first tap also launches the ball into a hop — feels responsive
    }
    function gameOver() {
        state = 2 /* State.Over */;
        overTimer = 0;
        shake = 16 * S;
        playCrash();
        spawnDeathParticles();
        if (score > best) {
            best = score;
            saveBest(best);
        }
    }
    function togglePause() {
        if (state !== 1 /* State.Playing */)
            return;
        paused = !paused;
    }
    // ---------------------------------------------------------------------------
    // Input — a single "tap" drives everything; a corner button handles pause
    // ---------------------------------------------------------------------------
    function jump() {
        if (ball.onGround) {
            ball.vy = -JUMP_VELOCITY * S;
            ball.onGround = false;
            playJump();
        }
    }
    function inRect(x, y, rect) {
        const pad = 6 * S; // generous touch target
        return (x >= rect.x - pad &&
            x <= rect.x + rect.w + pad &&
            y >= rect.y - pad &&
            y <= rect.y + rect.h + pad);
    }
    // A tap carries coordinates so we can tell a corner-button press from a hop.
    // Keyboard "primary" actions pass (-1, -1) so they never hit a button.
    function onTap(x, y) {
        // Mute is a global control — reachable in every state.
        if (inRect(x, y, muteBtn)) {
            toggleMute();
            return;
        }
        switch (state) {
            case 0 /* State.Menu */:
                startGame();
                break;
            case 1 /* State.Playing */:
                if (paused) {
                    paused = false; // tapping anywhere resumes
                }
                else if (inRect(x, y, btn)) {
                    paused = true;
                }
                else {
                    jump();
                }
                break;
            case 2 /* State.Over */:
                if (overTimer >= RESTART_LOCKOUT)
                    startGame();
                break;
        }
    }
    // Pointer covers mouse + touch + pen; preventDefault stops synthetic clicks
    // and scrolling. Keyboard mirrors it for desktop testing.
    window.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        onTap(e.clientX, e.clientY);
    }, { passive: false });
    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyM') {
            e.preventDefault();
            toggleMute();
        }
        else if (e.code === 'KeyP' || e.code === 'Escape') {
            e.preventDefault();
            togglePause();
        }
        else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
            e.preventDefault();
            onTap(-1, -1);
        }
    });
    window.addEventListener('resize', resize);
    // Pause when the tab is hidden; reset the clock when it returns so the ball
    // doesn't teleport across the gap.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (state === 1 /* State.Playing */)
                paused = true;
        }
        else {
            lastTime = performance.now();
        }
    });
    // ---------------------------------------------------------------------------
    // Spawning & difficulty
    // ---------------------------------------------------------------------------
    function currentSpeed() {
        return Math.min(MAX_SPEED, BASE_SPEED + elapsed * SPEED_RAMP) * S;
    }
    function spawnObstacle() {
        const d = ballR * 2; // ball diameter, used as a base unit
        // Decide type: floating obstacles unlock after a warm-up, then grow common.
        const t = Math.min(1, elapsed / 60);
        const airChance = elapsed < AIR_START_TIME
            ? 0
            : AIR_MIN_CHANCE + (AIR_MAX_CHANCE - AIR_MIN_CHANCE) * t;
        const air = Math.random() < airChance;
        if (air) {
            // Floating barrier: hangs from the ceiling down to a gap above the track.
            // The gap clears a grounded ball, but the barrier reaches the top of the
            // screen, so it can't be jumped over — the only way past is to roll under
            // it (never jump). `h` is unused for air; the height is derived from the
            // ceiling to the gap at draw/collision time.
            const gap = d * 1.5; // ≈ 3 * ballR of clearance below the barrier
            const w = d * (0.6 + Math.random() * 0.7);
            obstacles.push({ x: W + w, w, h: 0, gap, air: true, passed: false });
        }
        else {
            // Ground block: hop over it. Height stays under the jump apex.
            const minH = d * 0.7;
            const maxH = Math.min(H * 0.16, d * 2.6);
            const h = minH + Math.random() * (maxH - minH);
            const w = d * (0.55 + Math.random() * 0.7);
            obstacles.push({ x: W + w, w, h, gap: 0, air: false, passed: false });
        }
    }
    // Top/bottom edges (y) of an obstacle's rectangle for the current ground.
    // Ground blocks sit on the track; floating barriers hang from just above the
    // top of the screen down to a gap, so they can't be cleared with a jump.
    const CEILING = -30; // reference units (× S); just off the top edge
    function obstacleTop(o) {
        return o.air ? CEILING * S : groundY - o.h;
    }
    function obstacleBottom(o) {
        return o.air ? groundY - o.gap : groundY;
    }
    // ---------------------------------------------------------------------------
    // Particles
    // ---------------------------------------------------------------------------
    function spawnDeathParticles() {
        const cx = ballX;
        const cy = ball.y;
        for (let i = 0; i < 24; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = (120 + Math.random() * 320) * S;
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 120 * S,
                life: 0.6 + Math.random() * 0.4,
                age: 0,
                r: ballR * (0.15 + Math.random() * 0.35),
            });
        }
    }
    // ---------------------------------------------------------------------------
    // Update
    // ---------------------------------------------------------------------------
    function update(dt) {
        // Freeze everything while paused mid-run.
        if (state === 1 /* State.Playing */ && paused)
            return;
        updateParticles(dt);
        if (shake > 0)
            shake = Math.max(0, shake - shake * dt * 8 - 6 * S * dt);
        if (state === 2 /* State.Over */) {
            overTimer += dt;
            return;
        }
        if (state !== 1 /* State.Playing */)
            return;
        elapsed += dt;
        speed = currentSpeed();
        distance += speed * dt;
        // Ball physics
        ball.vy += GRAVITY * S * dt;
        ball.y += ball.vy * dt;
        const floor = groundY - ballR;
        if (ball.y >= floor) {
            ball.y = floor;
            ball.vy = 0;
            ball.onGround = true;
        }
        // Spin: roll while grounded, tumble while airborne.
        ball.rot += (ball.onGround ? speed / Math.max(1, ballR) : 6) * dt;
        // Trail
        trail.push({ x: ballX, y: ball.y, age: 0 });
        if (trail.length > 14)
            trail.shift();
        for (let i = 0; i < trail.length; i++)
            trail[i].age += dt;
        // Spawn obstacles on a time-based cadence so spacing scales with speed.
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnObstacle();
            // Harder over time: interval shrinks from MAX_SPAWN_GAP toward MIN.
            const t = Math.min(1, elapsed / 60);
            const base = MAX_SPAWN_GAP - (MAX_SPAWN_GAP - MIN_SPAWN_GAP) * t;
            spawnTimer = base * (0.85 + Math.random() * 0.4);
        }
        // Move + score + cull obstacles
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            o.x -= speed * dt;
            if (!o.passed && o.x + o.w < ballX) {
                o.passed = true;
                score += 1;
            }
            if (o.x + o.w < -50)
                obstacles.splice(i, 1);
        }
        // Collision (circle vs rect, slightly forgiving). Works for both obstacle
        // kinds since each rect's vertical extent comes from its top/bottom edges.
        const r = ballR * 0.86;
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            const top = obstacleTop(o);
            const bottom = obstacleBottom(o);
            const cx = clamp(ballX, o.x, o.x + o.w);
            const cy = clamp(ball.y, top, bottom);
            const dx = ballX - cx;
            const dy = ball.y - cy;
            if (dx * dx + dy * dy < r * r) {
                gameOver();
                break;
            }
        }
    }
    function updateParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.age += dt;
            if (p.age >= p.life) {
                particles.splice(i, 1);
                continue;
            }
            p.vy += GRAVITY * 0.5 * S * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
    }
    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    function render() {
        ctx.save();
        // Screen shake
        if (shake > 0.5) {
            ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        }
        drawBackground();
        drawGround();
        drawObstacles();
        drawTrail();
        if (state !== 2 /* State.Over */ || overTimer < 0.05)
            drawBall();
        drawParticles();
        ctx.restore(); // shake shouldn't affect the HUD
        drawHUD();
    }
    function drawBackground() {
        // Sky hue drifts subtly with score for a sense of progress.
        const hue = (210 + score * 4) % 360;
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, `hsl(${hue}, 45%, 14%)`);
        g.addColorStop(1, `hsl(${(hue + 30) % 360}, 40%, 8%)`);
        ctx.fillStyle = g;
        ctx.fillRect(-40, -40, W + 80, H + 80);
    }
    function drawGround() {
        ctx.fillStyle = '#0b0b18';
        ctx.fillRect(-40, groundY, W + 80, H - groundY + 40);
        // Bright edge line on top of the track.
        ctx.fillStyle = 'rgba(120, 200, 255, 0.9)';
        ctx.fillRect(-40, groundY - 2 * S, W + 80, 2 * S);
        // Scrolling dashes to convey motion (driven by accumulated distance, so
        // they hold still while paused).
        const dashW = 26 * S;
        const gap = 26 * S;
        const period = dashW + gap;
        const offset = (-distance % period) - period;
        ctx.fillStyle = 'rgba(120, 200, 255, 0.18)';
        for (let x = offset; x < W + period; x += period) {
            ctx.fillRect(x, groundY + 10 * S, dashW, 3 * S);
        }
    }
    function drawObstacles() {
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            const top = obstacleTop(o);
            const bottom = obstacleBottom(o);
            const h = bottom - top;
            const rad = Math.min(6 * S, o.w * 0.3);
            if (o.air) {
                // Floating barrier — cyan curtain from the ceiling, with a bright
                // bottom edge and teeth as a "roll under / don't jump" cue.
                const edge = 6 * S;
                ctx.fillStyle = '#3fd0ff';
                roundRect(o.x, top, o.w, h, rad);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                roundRect(o.x, bottom - edge, o.w, edge, rad);
                ctx.fill();
                drawTeeth(o.x, bottom, o.w);
            }
            else {
                // Ground hazard — red block with a top highlight.
                ctx.fillStyle = '#ff5470';
                roundRect(o.x, top, o.w, h, rad);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                roundRect(o.x, top, o.w, Math.min(6 * S, h), rad);
                ctx.fill();
            }
        }
    }
    function drawTeeth(x, bottom, w) {
        const teeth = Math.max(2, Math.round(w / (8 * S)));
        const tw = w / teeth;
        ctx.fillStyle = '#3fd0ff';
        for (let i = 0; i < teeth; i++) {
            const tx = x + i * tw;
            ctx.beginPath();
            ctx.moveTo(tx, bottom);
            ctx.lineTo(tx + tw, bottom);
            ctx.lineTo(tx + tw / 2, bottom + 5 * S);
            ctx.closePath();
            ctx.fill();
        }
    }
    function drawTrail() {
        for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const a = (i / trail.length) * 0.28;
            const rr = ballR * (0.4 + (i / trail.length) * 0.5);
            ctx.fillStyle = `rgba(255, 214, 92, ${a})`;
            ctx.beginPath();
            ctx.arc(t.x, t.y, rr, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    function drawBall() {
        ctx.save();
        ctx.translate(ballX, ball.y);
        ctx.rotate(ball.rot);
        // glow
        ctx.shadowColor = 'rgba(255, 214, 92, 0.8)';
        ctx.shadowBlur = 18 * S;
        ctx.fillStyle = '#ffd65c';
        ctx.beginPath();
        ctx.arc(0, 0, ballR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // two "eyes"/marks so rotation is visible
        ctx.fillStyle = 'rgba(120, 80, 0, 0.85)';
        ctx.beginPath();
        ctx.arc(ballR * 0.35, -ballR * 0.15, ballR * 0.16, 0, Math.PI * 2);
        ctx.arc(-ballR * 0.35, -ballR * 0.15, ballR * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    function drawParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const a = 1 - p.age / p.life;
            ctx.fillStyle = `rgba(255, 214, 92, ${a})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // ---------------------------------------------------------------------------
    // HUD / overlays
    // ---------------------------------------------------------------------------
    function drawHUD() {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        if (state === 1 /* State.Playing */) {
            ctx.font = `700 ${64 * S}px system-ui, sans-serif`;
            ctx.fillText(String(score), W / 2, 90 * S);
            drawPauseButton();
            if (paused)
                drawPauseOverlay();
        }
        else if (state === 0 /* State.Menu */) {
            title('TAP BOUNCE', W / 2, H * 0.34);
            subtitle('Tap to start', W / 2, H * 0.34 + 60 * S);
            hint('Tap / Space to hop · roll under floating spikes', W / 2, H * 0.34 + 100 * S);
            if (best > 0)
                subtitle('Best  ' + best, W / 2, H * 0.34 + 150 * S);
        }
        else if (state === 2 /* State.Over */) {
            // dim veil
            ctx.fillStyle = 'rgba(10,10,25,0.55)';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#ffffff';
            title('GAME OVER', W / 2, H * 0.32);
            ctx.font = `700 ${72 * S}px system-ui, sans-serif`;
            ctx.fillText(String(score), W / 2, H * 0.32 + 96 * S);
            const isNew = score >= best && score > 0;
            subtitle(isNew ? '★ New Best!' : 'Best  ' + best, W / 2, H * 0.32 + 150 * S);
            if (overTimer >= RESTART_LOCKOUT) {
                const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
                ctx.globalAlpha = pulse;
                subtitle('Tap to retry', W / 2, H * 0.32 + 210 * S);
                ctx.globalAlpha = 1;
            }
        }
        // Mute toggle is available in every state, so draw it last (on top).
        drawMuteButton();
    }
    function drawPauseButton() {
        // faint rounded background
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(btn.x, btn.y, btn.w, btn.h, 10 * S);
        ctx.fill();
        // two bars
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const barW = btn.w * 0.16;
        const barH = btn.h * 0.46;
        const cy = btn.y + btn.h / 2 - barH / 2;
        const cx = btn.x + btn.w / 2;
        roundRect(cx - barW * 1.4, cy, barW, barH, barW * 0.4);
        ctx.fill();
        roundRect(cx + barW * 0.4, cy, barW, barH, barW * 0.4);
        ctx.fill();
    }
    function drawMuteButton() {
        // faint rounded background
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(muteBtn.x, muteBtn.y, muteBtn.w, muteBtn.h, 10 * S);
        ctx.fill();
        const cx = muteBtn.x + muteBtn.w * 0.42;
        const cy = muteBtn.y + muteBtn.h / 2;
        const u = muteBtn.w;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(2, 2.2 * S);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        // speaker body + cone
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.16, cy - u * 0.08);
        ctx.lineTo(cx - u * 0.05, cy - u * 0.08);
        ctx.lineTo(cx + u * 0.08, cy - u * 0.2);
        ctx.lineTo(cx + u * 0.08, cy + u * 0.2);
        ctx.lineTo(cx - u * 0.05, cy + u * 0.08);
        ctx.lineTo(cx - u * 0.16, cy + u * 0.08);
        ctx.closePath();
        ctx.fill();
        if (muted) {
            // slash across the speaker
            ctx.beginPath();
            ctx.moveTo(cx - u * 0.04, cy - u * 0.22);
            ctx.lineTo(cx + u * 0.3, cy + u * 0.22);
            ctx.stroke();
        }
        else {
            // two sound-wave arcs
            ctx.beginPath();
            ctx.arc(cx + u * 0.05, cy, u * 0.16, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx + u * 0.05, cy, u * 0.27, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();
        }
    }
    function drawPauseOverlay() {
        ctx.fillStyle = 'rgba(10,10,25,0.6)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffffff';
        title('PAUSED', W / 2, H * 0.42);
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
        ctx.globalAlpha = pulse;
        subtitle('Tap to resume', W / 2, H * 0.42 + 60 * S);
        ctx.globalAlpha = 1;
    }
    function title(text, x, y) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.min(64 * S, W * 0.13)}px system-ui, sans-serif`;
        ctx.fillText(text, x, y);
    }
    function subtitle(text, x, y) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = `600 ${28 * S}px system-ui, sans-serif`;
        ctx.fillText(text, x, y);
    }
    function hint(text, x, y) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `500 ${20 * S}px system-ui, sans-serif`;
        ctx.fillText(text, x, y);
    }
    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    // ---------------------------------------------------------------------------
    // Main loop (delta-time, clamped)
    // ---------------------------------------------------------------------------
    let lastTime = performance.now();
    function frame(now) {
        let dt = (now - lastTime) / 1000;
        lastTime = now;
        if (dt > 1 / 20)
            dt = 1 / 20; // clamp big gaps (tab switch, lag)
        update(dt);
        render();
        requestAnimationFrame(frame);
    }
    // ---------------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------------
    resize();
    resetRun();
    requestAnimationFrame(frame);
})();
