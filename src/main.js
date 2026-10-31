// src/main.js — wires everything: tracking → players → gesture → mapping → ui

import * as audio from './audio.js';
import { initGazePointer, drawGazePointer } from './gaze-pointer.js';
import { initGaze, calibrateGaze, updateGaze, gaze } from './gaze.js';
import { initTracking, detect } from './tracking.js';
import { assignPlayers, onLeave } from './players.js';
import { analyzeHands, forgetPlayer } from './gesture.js';
import { applyMapping, forgetMapping } from './mapping.js';
import { initUI, drawFrame, toggleVoices } from './ui.js';

const $ = id => document.getElementById(id);
const overlay = $('start-overlay');
const startBtn = $('start-btn');
const statusEl = $('status');
const video = $('webcam');

let running = false;
let fps = 0, lastT = 0;

// a player left → silence their lane, forget their gesture/mapping memory
onLeave((id, slot) => {
    audio.releasePlayer(slot);
    forgetPlayer(id);
    forgetMapping(id);
});

startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
        setStatus('Waking the voices…');
        await audio.startAudio();
        const stream = await initGaze(setStatus);
        await initTracking(video, setStatus, stream);
        initUI();
        initGazePointer();
        overlay.classList.add('hidden');
        running = true;
        lastT = performance.now();
        requestAnimationFrame(loop);
        await calibrateGaze();
        $('recalibrate-gaze').hidden = false;
    } catch (err) {
        running = false;
        console.error(err);
        overlay.classList.remove('hidden');
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

    const pan = updateGaze(now, window.innerWidth);
    drawGazePointer(gaze, now);
    // Apply to both lanes even while a sustained note has no visible hands.
    for (const slot of [0, 1]) audio.getPlayer(slot).setPan(pan);
    $('hud-gaze').textContent = gaze.calibrating ? 'calibrating'
        : gaze.tracking ? 'tracking' : 'lost · centering';
    $('hud-pan').textContent = pan.toFixed(2);
    if (gaze.calibrating) {
        requestAnimationFrame(loop);
        return;
    }

    const { hands } = detect(now);
    const players = assignPlayers(hands, now);

    const frames = players.map(p => {
        const h = analyzeHands(p.hands, now, p.id);
        const a = audio.getPlayer(p.slot);
        const ev = applyMapping(a, h, now, p.id);
        return { slot: p.slot, id: p.id, hands: h, audio: a, ev };
    });

    drawFrame(frames, fps);
    $('hud-key').textContent = audio.shared.key;
    window.spectral.frames = frames;

    requestAnimationFrame(loop);
}

window.addEventListener('keydown', e => {
    if (!running) return;
    if (e.code === 'Space') { e.preventDefault(); audio.releasePlayer(0); audio.releasePlayer(1); }
    else if (e.key === 'k' || e.key === 'K') audio.nextKey();
    else if (e.key === 'v' || e.key === 'V') toggleVoices();
});

function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
}

$('recalibrate-gaze').addEventListener('click', async () => {
    const button = $('recalibrate-gaze');
    button.disabled = true;
    audio.releasePlayer(0);
    audio.releasePlayer(1);
    try {
        await calibrateGaze();
    } catch (err) {
        console.error(err);
        $('hud-gaze').textContent = 'calibration failed';
    } finally {
        button.disabled = false;
    }
});

window.spectral = { audio, gaze };