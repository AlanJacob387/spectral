// src/ui.js — draw only. Reads state, never changes it.
//
//   initUI()
//   drawFrame(frames, fps)   frames = [{ slot, id, hands:{right,left}, audio, ev }]
//   toggleVoices()

import { HAND_CONNECTIONS, tracking } from './tracking.js';

const TRAIL = 6;
const COLORS = {
    drift: '#8fd3ff', haunt: '#c9a6ff', knock: '#ffb27a', wail: '#9effc9',
    wisp: '#b8f2ff', dim: 'rgba(217,220,230,0.35)',
};
const PLAYER_TINT = ['#b8f2ff', '#ffd7a8'];   // slot 0 cyan, slot 1 amber

let canvas, ctx;
let lanes = [];           // per slot: { root, hud:{}, cards:{} }
let vanishEl, voicesEl;
const trails = new Map(); // `${id}:${hand}` → [landmarks...]

export function initUI() {
    canvas = document.getElementById('overlay');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    vanishEl = document.getElementById('vanish');
    voicesEl = document.getElementById('voices');

    lanes = [0, 1].map(slot => {
        const root = document.querySelector(`.lane[data-slot="${slot}"]`);
        const hud = {};
        root.querySelectorAll('[data-hud]').forEach(el => { hud[el.dataset.hud] = el; });
        const cards = {};
        root.querySelectorAll('.voice-card').forEach(el => { cards[el.dataset.voice] = el; });
        return { root, hud, cards };
    });
    document.getElementById('hud-fps').textContent = '0';
}

export function toggleVoices() { voicesEl.classList.toggle('hidden'); }

export function drawFrame(frames, fps) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const seen = new Set();

    for (const f of frames) {
        const { slot, id, hands, audio, ev } = f;
        const st = audio.state;
        const tint = COLORS[st.instrument] || COLORS.wisp;
        const ptint = PLAYER_TINT[slot];

        for (const key of ['Right', 'Left']) {
            const h = key === 'Right' ? hands.right : hands.left;
            const tk = `${id}:${key}`;
            seen.add(tk);
            let tr = trails.get(tk);
            if (!tr) { tr = []; trails.set(tk, tr); }
            if (h) { tr.push(h.landmarks); if (tr.length > TRAIL) tr.shift(); } else tr.length = 0;

            tr.forEach((lm, i) => {
                const a = ((i + 1) / tr.length) * (i === tr.length - 1 ? 1 : 0.35);
                drawHand(lm, W, H, key === 'Right' ? tint : ptint, a, key === 'Right' && h?.closed);
            });

            if (h && key === 'Right' && h.closed && st.playing) {
                const [px, py] = toScreen(h.x, h.y, W, H);
                const r = 40 + 30 * h.velocityNorm;
                const g = ctx.createRadialGradient(px, py, 0, px, py, r);
                g.addColorStop(0, hexA(tint, 0.45)); g.addColorStop(1, hexA(tint, 0));
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
            }

            if (h && !h.closed && h.fingersStable > 0 && (key === 'Left' || h.fingersStable <= 3)) {
                ctx.font = '500 14px "IBM Plex Mono", monospace';
                ctx.fillStyle = ptint; ctx.textAlign = 'center';
                const [bx, by] = toScreen(h.x, h.y, W, H);
                ctx.fillText(String(h.fingersStable), bx, by - 60);
            }
        }

        // player label near the hands
        const anchor = hands.right || hands.left;
        if (anchor) {
            const [ax, ay] = toScreen(anchor.x, anchor.y, W, H);
            ctx.font = '400 11px "IBM Plex Mono", monospace';
            ctx.fillStyle = hexA(ptint, 0.7); ctx.textAlign = 'center';
            ctx.fillText(`P${slot + 1}`, ax, ay + 70);
        }

        // lane UI
        const lane = lanes[slot];
        lane.root.classList.add('live');
        for (const [name, el] of Object.entries(lane.cards)) el.classList.toggle('active', name === st.instrument);
        if (ev.triggered) pulse(lane.cards[st.instrument]);
        if (ev.vanished) { vanishEl.classList.remove('flash'); void vanishEl.offsetWidth; vanishEl.classList.add('flash'); }

        lane.hud.instrument.textContent = st.instrument;
        lane.hud.instrument.className = st.instrument;
        lane.hud.octave.textContent = ['deep', 'mid', 'shrill'][st.octave + 1];
        lane.hud.note.textContent = st.playing ? st.lastNoteName : '—';
        lane.hud.mode.textContent = st.chord === 1 ? 'single' : st.mode;
        lane.hud.arp.textContent = st.arp ? 'wandering' : 'still';
        lane.hud.sustain.textContent = st.sustain ? 'held' : 'off';
        lane.hud.hands.textContent = [hands.left && 'L', hands.right && 'R'].filter(Boolean).join(' + ') || 'none';
    }

    // lanes with no player this frame
    const liveSlots = new Set(frames.map(f => f.slot));
    lanes.forEach((lane, slot) => { if (!liveSlots.has(slot)) lane.root.classList.remove('live'); });

    // drop trails of hands/players no longer present
    for (const k of [...trails.keys()]) if (!seen.has(k)) trails.delete(k);

    document.getElementById('hud-fps').textContent = Math.round(fps);
}

// ------------------------------------------------------------------
function drawHand(lm, W, H, color, alpha, bold) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = bold ? 2.5 : 1.5; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = bold ? 12 : 6;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
        const [ax, ay] = toScreen(1 - lm[a].x, lm[a].y, W, H);
        const [bx, by] = toScreen(1 - lm[b].x, lm[b].y, W, H);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
    for (const p of lm) {
        const [x, y] = toScreen(1 - p.x, p.y, W, H);
        ctx.beginPath(); ctx.arc(x, y, bold ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function toScreen(nx, ny, W, H) {
    const vw = tracking.videoWidth, vh = tracking.videoHeight;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    return [(W - dw) / 2 + nx * dw, (H - dh) / 2 + ny * dh];
}

function pulse(el) { if (!el) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }