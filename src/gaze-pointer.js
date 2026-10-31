// Screen-space gaze visualization; never uses the mirrored webcam transform.
const TRAIL_MS = 450;
let canvas, ctx, previousTime = null, point = null;
let trail = [];
let reducedMotion;

export function initGazePointer() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'gaze-pointer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    ctx = canvas.getContext('2d');
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        trail = [];
        point = null;
    };
    resize();
    window.addEventListener('resize', resize);
}

export function drawGazePointer(gaze, now) {
    if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);
    const dt = previousTime === null ? 0 : Math.max(0, now - previousTime);
    previousTime = now;
    const visible = gaze.tracking && Number.isFinite(gaze.x) && Number.isFinite(gaze.y);
    if (visible) {
        const x = Math.min(W - 10, Math.max(10, gaze.x));
        const y = Math.min(H - 10, Math.max(10, gaze.y));
        const alpha = 1 - Math.exp(-dt / 120);
        point = point ? { x: point.x + (x - point.x) * alpha, y: point.y + (y - point.y) * alpha } : { x, y };
        trail.push({ ...point, time: now });
    } else point = null;
    trail = trail.filter(p => now - p.time < TRAIL_MS).slice(-60);
    if (reducedMotion.matches) trail = [];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#8fd3ff';
    ctx.shadowBlur = 12;
    for (let i = 1; i < trail.length; i++) {
        const life = 1 - (now - trail[i].time) / TRAIL_MS;
        ctx.strokeStyle = `rgba(143,211,255,${life * life * 0.55})`;
        ctx.lineWidth = 1 + 4 * life;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
    }
    if (visible) {
        const { x, y } = point;
        const pulse = reducedMotion.matches ? 0 : Math.sin(now / 550) * 1.5;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 32);
        halo.addColorStop(0, 'rgba(184,242,255,0.4)');
        halo.addColorStop(0.4, 'rgba(143,211,255,0.13)');
        halo.addColorStop(1, 'rgba(143,211,255,0)');
        ctx.shadowBlur = 0;
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 15;
        ctx.strokeStyle = 'rgba(184,242,255,0.8)';
        ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.arc(x, y, 10 + pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#effcff';
        ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}
