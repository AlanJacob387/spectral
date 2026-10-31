// src/gesture.js - pure hand-feature extraction. Landmarks in, gesture state out.
// No audio, no DOM. Keeps per-hand history for smoothing, hysteresis and velocity.
//
// Public API:
//   analyzeHands(hands, nowMs, playerId?) -> { right: HandState|null, left: HandState|null }
//   handsDistance(right, left)            -> 0..1 | null
//   forgetPlayer(playerId)

import { HAND } from './tracking.js';

const EMA_POS = 0.35;
const EMA_VEL = 0.25;
const CLOSE_ON = 0.80;
const CLOSE_OFF = 0.95;
const PINCH_ON = 0.30;
const PINCH_OFF = 0.45;
const LOST_MS = 300;
const FINGER_HOLD_MS = 180;

const hist = new Map();   // `${playerId}:${handedness}` -> history

function histFor(playerId, label) {
    const k = `${playerId}:${label}`;
    if (!hist.has(k)) hist.set(k, newHist());
    return hist.get(k);
}

export function forgetPlayer(playerId) {
    for (const k of [...hist.keys()]) if (k.startsWith(`${playerId}:`)) hist.delete(k);
}

function newHist() {
    return {
        x: null, y: null, prevY: null, prevT: 0, vel: 0,
        closed: false, pinch: false, lastSeen: 0,
        fingersStable: 0, fingersCandidate: 0, fingersSince: 0,
    };
}

export function analyzeHands(hands, nowMs, playerId = 0) {
    const out = { right: null, left: null };

    for (const h of hands) {
        const label = h.handedness === 'Right' ? 'Right' : 'Left';
        const s = histFor(playerId, label);
        if (nowMs - s.lastSeen > LOST_MS) Object.assign(s, newHist());
        s.lastSeen = nowMs;

        const lm = h.landmarks;
        const palm = palmCenter(lm);
        const pw = dist(lm[HAND.WRIST], lm[HAND.MIDDLE_MCP]) || 1e-3;

        const rx = 1 - palm.x;
        const ry = palm.y;

        s.x = s.x == null ? rx : lerp(s.x, rx, EMA_POS);
        s.y = s.y == null ? ry : lerp(s.y, ry, EMA_POS);

        if (s.prevY != null && s.prevT) {
            const dt = Math.max((nowMs - s.prevT) / 1000, 1e-3);
            s.vel = lerp(s.vel, Math.abs(s.y - s.prevY) / dt, EMA_VEL);
        }
        s.prevY = s.y;
        s.prevT = nowMs;

        const wrist = lm[HAND.WRIST];
        const pairs = [
            [HAND.INDEX_TIP, HAND.INDEX_PIP],
            [HAND.MIDDLE_TIP, HAND.MIDDLE_PIP],
            [HAND.RING_TIP, HAND.RING_PIP],
            [HAND.PINKY_TIP, HAND.PINKY_PIP],
        ];
        const extended = pairs.map(([t, p]) => dist(lm[t], wrist) > dist(lm[p], wrist) * 1.12);
        const fingersUp = extended.filter(Boolean).length;

        const tips = [HAND.INDEX_TIP, HAND.MIDDLE_TIP, HAND.RING_TIP, HAND.PINKY_TIP];
        const openness = tips.reduce((a, i) => a + dist(lm[i], palm), 0) / tips.length / pw;

        if (s.closed && (fingersUp > 0 || openness > CLOSE_OFF)) s.closed = false;
        else if (!s.closed && fingersUp === 0 && openness < CLOSE_ON) s.closed = true;

        const pinchRatio = dist(lm[HAND.THUMB_TIP], lm[HAND.INDEX_TIP]) / pw;
        if (s.pinch && pinchRatio > PINCH_OFF) s.pinch = false;
        else if (!s.pinch && pinchRatio < PINCH_ON) s.pinch = true;

        if (fingersUp !== s.fingersCandidate) {
            s.fingersCandidate = fingersUp;
            s.fingersSince = nowMs;
        } else if (fingersUp !== s.fingersStable && nowMs - s.fingersSince >= FINGER_HOLD_MS) {
            s.fingersStable = fingersUp;
        }

        const state = {
            x: s.x, y: s.y, yUp: 1 - s.y,
            closed: s.closed,
            pinch: s.pinch,
            fingersUp,
            fingersStable: s.fingersStable,
            velocity: s.vel,
            velocityNorm: clamp01(s.vel / 2.5),
            openness: clamp01((openness - 0.55) / 0.65),
            landmarks: lm,
            handedness: label,
        };

        if (label === 'Right') out.right = state;
        else out.left = state;
    }

    return out;
}

export function handsDistance(right, left) {
    if (!right || !left) return null;
    return clamp01(Math.hypot(right.x - left.x, right.y - left.y));
}

function palmCenter(lm) {
    const ids = [HAND.WRIST, HAND.INDEX_MCP, HAND.MIDDLE_MCP, HAND.RING_MCP, HAND.PINKY_MCP];
    let x = 0, y = 0, z = 0;
    for (const i of ids) { x += lm[i].x; y += lm[i].y; z += lm[i].z; }
        return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
    }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp01(v) { return Math.min(1, Math.max(0, v)); }