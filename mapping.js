// src/mapping.js — the ONLY place gesture state becomes sound.
//
//   RIGHT hand = play       LEFT hand = choose & shape
//   ─────────────────       ──────────────────────────
//   height    → pitch       fingers 1–4 → voice (drift/haunt/knock/wail)
//   fist      → note on     height      → filter (dark ↔ bright)
//   open      → release     left–right  → octave (deep ↔ shrill)
//   speed     → velocity    pinch       → arpeggio on/off
//   left–right→ pan         fist        → sustain
//
//   BOTH: distance apart → reverb + volume
//         two fists, close together → vanish (silence)
//
// Public API:
//   applyMapping(hands, nowMs) → events { triggered, vanished, voiceChanged }

import * as audio from './audio.js';
import { handsDistance } from './gesture.js';

const VOICE_BY_FINGERS = { 1: 'drift', 2: 'haunt', 3: 'knock', 4: 'wail' };
const VANISH_DIST = 0.16;        // palms this close (normalized) + both fists = vanish
const VANISH_COOLDOWN_MS = 900;
const WAIL_RETRIGGER_MS = 40;    // how often to update the glide pitch

const m = {
    rightWasClosed: false,
    leftWasClosed: false,
    leftWasPinch: false,
    lastVanish: 0,
    lastWail: 0,
    lastVoice: 'drift',
};

export function applyMapping(hands, nowMs) {
    const { right, left } = hands;
    const ev = { triggered: false, vanished: false, voiceChanged: false };

    // ---------- LEFT: choose & shape ----------
    if (left) {
        const f = left.fingersStable;
        if (!left.closed && VOICE_BY_FINGERS[f] && VOICE_BY_FINGERS[f] !== audio.state.instrument) {
            audio.setInstrument(VOICE_BY_FINGERS[f]);
            ev.voiceChanged = true;
        }

        audio.setFilter(expMap(left.yUp, 200, 8000));

        const oct = left.x < 0.33 ? -1 : left.x > 0.66 ? 1 : 0;
        if (oct !== audio.state.octave) audio.setOctave(oct);

        if (left.pinch !== m.leftWasPinch) {
            m.leftWasPinch = left.pinch;
            if (left.pinch) audio.setArp(!audio.state.arp);   // toggle on each new pinch
        }

        if (left.closed !== m.leftWasClosed) {
            m.leftWasClosed = left.closed;
            audio.setSustain(left.closed);
        }
    } else if (m.leftWasClosed) {
        m.leftWasClosed = false;
        audio.setSustain(false);
    }

    // ---------- BOTH: space + vanish ----------
    const d = handsDistance(right, left);
    if (d != null) {
        audio.setReverb(lerp(0.15, 0.85, clamp01((d - 0.1) / 0.6)));
        audio.setVolume(lerp(8, 12, clamp01((d - 0.1) / 0.6)));

        if (right.closed && left.closed && d < VANISH_DIST && nowMs - m.lastVanish > VANISH_COOLDOWN_MS) {
            m.lastVanish = nowMs;
            audio.releaseAll();
            m.rightWasClosed = true;     // don't retrigger until the fist opens again
            ev.vanished = true;
            return ev;
        }
    }

    // ---------- RIGHT: play ----------
    if (right) {
        audio.setPan(lerp(-0.8, 0.8, right.x));

        const isWail = audio.state.instrument === 'wail';

        if (right.closed && !m.rightWasClosed) {
            m.rightWasClosed = true;
            audio.trigger(right.yUp, 0.35 + 0.65 * right.velocityNorm);
            ev.triggered = true;
            m.lastWail = nowMs;
        } else if (right.closed && isWail && nowMs - m.lastWail > WAIL_RETRIGGER_MS) {
            audio.trigger(right.yUp, 0.8);     // glide
            m.lastWail = nowMs;
        } else if (right.closed && audio.state.arp) {
            audio.trigger(right.yUp, 0.8);     // retarget the arpeggio while fist held
        } else if (!right.closed && m.rightWasClosed) {
            m.rightWasClosed = false;
            audio.release();
        }
    } else if (m.rightWasClosed) {
        m.rightWasClosed = false;
        audio.release();
    }

    return ev;
}

// ------------------------------------------------------------------
function expMap(t, lo, hi) { return lo * Math.pow(hi / lo, clamp01(t)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }