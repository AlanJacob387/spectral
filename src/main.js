// src/main.js — wires everything: tracking → gesture → mapping → ui

import * as audio from './audio.js';
import { initTracking, detect } from './tracking.js';
import { analyzeHands } from './gesture.js';
import { applyMapping } from './mapping.js';
import { initUI, drawFrame, toggleVoices } from './ui.js';

const $ = id => document.getElementById(id);
const overlay = $('start-overlay');
const startBtn = $('start-btn');
const statusEl = $('status');
const video = $('webcam');

let running = false;
let fps = 0, lastT = 0;

startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
        setStatus('Waking the voices…');
        await audio.startAudio();
        await initTracking(video, setStatus);
        initUI();
        overlay.classList.add('hidden');
        running = true;
        lastT = performance.now();
        requestAnimationFrame(loop);
    } catch (err) {
        console.error(err);
        setStatus(err?.name === 'NotAllowedError'
            ? 'The eye was refused. Allow the camera and try again.'
            : `Something went wrong: ${err?.message || err}`, true);
        startBtn.disabled = false;
    }
});

function loop(now) {
    if (!running) return;
    const dt = now - lastT; lastT = now;
    fps = fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;

    const { hands } = detect(now);
    const h = analyzeHands(hands, now); window.spectral.hands = h;
    const ev = applyMapping(h, now);
    drawFrame(h, ev, fps);

    requestAnimationFrame(loop);
}

// keyboard
window.addEventListener('keydown', e => {
    if (!running) return;
    if (e.code === 'Space') { e.preventDefault(); audio.releaseAll(); }
    else if (e.key === 'k' || e.key === 'K') audio.nextKey();
    else if (e.key === 'v' || e.key === 'V') toggleVoices();
});

function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
}

// expose for console poking
window.spectral = { audio };