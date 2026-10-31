// src/ui.js — draw only. Reads state, never changes it.
//
// Public API:
//   initUI()
//   drawFrame(hands, events, fps)   hands = { right, left } from gesture.js

import { HAND_CONNECTIONS, tracking } from './tracking.js';
import { state as audioState } from './audio.js';

const TRAIL = 6;                  // ghost afterimage frames per hand
const COLORS = {
    drift: '#8fd3ff', haunt: '#c9a6ff', knock: '#ffb27a', wail: '#9effc9',
    wisp: '#b8f2ff', dim: 'rgba(217,220,230,0.35)',
};

let canvas, ctx;
let hud = {};
let voiceCards = {};
let vanishEl, voicesEl;
const trails = { Right: [], Left: [] };

export function initUI() {
    canvas = document.getElementById('overlay');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    for (const id of ['instrument', 'octave', 'note', 'key', 'arp', 'sustain', 'hands', 'fps']) {
        hud[id] = document.getElementById(`hud-${id}`);
    }
    document.querySelectorAll('.voice-card').forEach(el => { voiceCards[el.dataset.voice] = el; });
    vanishEl = document.getElementById('vanish');
    voicesEl = document.getElementById('voices');
}

export function toggleVoices() {
    voicesEl.classList.toggle('hidden');
}

export function drawFrame(hands, ev, fps) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const tint = COLORS[audioState.instrument] || COLORS.wisp;

    for (const key of ['Right', 'Left']) {
        const h = key === 'Right' ? hands.right : hands.left;
        const tr = trails[key];
        if (h) { tr.push(h.landmarks); if (tr.length > TRAIL) tr.shift(); }
        else tr.length = 0;

        // afterimages (oldest → faintest)
        tr.forEach((lm, i) => {
            const a = ((i + 1) / tr.length) * (i === tr.length - 1 ? 1 : 0.35);
            drawHand(lm, W, H, key === 'Right' ? tint : COLORS.dim, a, key === 'Right' && h?.closed);
        });

        // palm glow when playing
        if (h && key === 'Right' && h.closed && audioState.playing) {
            const [px, py] = toScreen(h.x, h.y, W, H);
            const r = 40 + 30 * h.velocityNorm;
            const g = ctx.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, hexA(tint, 0.45));
            g.addColorStop(1, hexA(tint, 0));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        }

        // left-hand finger count badge
        if (h && key === 'Left' && !h.closed && h.fingersStable > 0) {
            ctx.font = '500 14px "IBM Plex Mono", monospace';
            ctx.fillStyle = COLORS.wisp;
            ctx.textAlign = 'center';
            const [bx, by] = toScreen(h.x, h.y, W, H);
            ctx.fillText(String(h.fingersStable), bx, by - 60);
        }
    }

    // ---- voice strip ----
    for (const [name, el] of Object.entries(voiceCards)) {
        el.classList.toggle('active', name === audioState.instrument);
    }
    if (ev.triggered) pulse(voiceCards[audioState.instrument]);
    if (ev.vanished) { vanishEl.classList.remove('flash'); void vanishEl.offsetWidth; vanishEl.classList.add('flash'); }

    // ---- HUD ----
    hud.instrument.textContent = audioState.instrument;
    hud.instrument.className = audioState.instrument;
    hud.octave.textContent = ['deep', 'mid', 'shrill'][audioState.octave + 1];
    hud.note.textContent = audioState.playing ? audioState.lastNoteName : '—';
    hud.key.textContent = audioState.key;
    hud.arp.textContent = audioState.arp ? 'wandering' : 'still';
    hud.sustain.textContent = audioState.sustain ? 'held' : 'off';
    hud.hands.textContent = [hands.left && 'L', hands.right && 'R'].filter(Boolean).join(' + ') || 'none';
    hud.fps.textContent = Math.round(fps);
}

// ------------------------------------------------------------------
function drawHand(lm, W, H, color, alpha, bold) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = bold ? 2.5 : 1.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = bold ? 12 : 6;

    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
        const [ax, ay] = toScreen(1 - lm[a].x, lm[a].y, W, H);
        const [bx, by] = toScreen(1 - lm[b].x, lm[b].y, W, H);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
    }
    ctx.stroke();

    for (const p of lm) {
        const [x, y] = toScreen(1 - p.x, p.y, W, H);
        ctx.beginPath();
        ctx.arc(x, y, bold ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Map mirrored-normalized video coords → screen px, matching CSS object-fit: cover. */
function toScreen(nx, ny, W, H) {
    const vw = tracking.videoWidth, vh = tracking.videoHeight;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    return [ox + nx * dw, oy + ny * dh];
}

function pulse(el) {
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}