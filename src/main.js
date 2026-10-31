// src/main.js — wires everything: tracking → players → gesture → mapping → ui

import * as audio from './audio.js';
import { createPalmHold } from './launch-gesture.js';
import { initGazePointer, drawGazePointer } from './gaze-pointer.js';
import { initGaze, calibrateGaze, updateGaze, gaze } from './gaze.js';
import { initTracking, detect } from './tracking.js';
import { assignPlayers, onLeave } from './players.js';
import { analyzeHands, forgetPlayer } from './gesture.js';
import { applyMapping, forgetMapping } from './mapping.js';
import { initUI, drawFrame, toggleVoices } from './ui.js';

const $ = id => document.getElementById(id);
const overlay = $('start-overlay');
const launchProgress = $('launch-progress');
const retryBtn = $('retry-camera');
let waitingForPalm = false;
let startingCalibration = false;
let cameraStarting = false;
let palmHold = createPalmHold();
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

// Camera tracking starts on load. A vision gesture is not a browser audio
// activation, so audio unlock runs independently and never blocks calibration.
function unlockSound() {
    Tone.start().catch(console.error);
    audio.startAudio().then(() => {
        $('audio-unlock').hidden = true;
    }).catch(err => {
        console.error(err);
        $('audio-unlock').textContent = 'Sound could not start. Tap here or press a key to retry.';
    });
}
window.addEventListener('pointerdown', unlockSound);
window.addEventListener('keydown', unlockSound);

async function prepareLaunch() {
    if (cameraStarting || waitingForPalm || running) return;
    cameraStarting = true;
    retryBtn.hidden = true;
    try {
        const stream = await initGaze(setStatus);
        // WebKit permits Web Audio while this document is actively capturing.
        // Try after camera startup, without making calibration wait on audio.
        unlockSound();
        await initTracking(video, setStatus, stream);
        initUI();
        initGazePointer();
        palmHold = createPalmHold();
        waitingForPalm = true;
        setStatus('Raise either open palm and hold it for a moment to begin.');
        requestAnimationFrame(watchForPalm);
    } catch (err) {
        console.error(err);
        setStatus(err?.name === 'NotAllowedError'
            ? 'Allow camera access, then retry to summon your hands.'
            : `Could not start camera tracking: ${err?.message || err}`, true);
        retryBtn.hidden = false;
    } finally {
        cameraStarting = false;
    }
}

function watchForPalm(now) {
    if (!waitingForPalm) return;
    const result = detect(now);
    const hands = analyzeHands(result.hands, now, 'launch');
    const open = !document.hidden && now - result.ts < 250 &&
        [hands.left, hands.right].some(h => h && !h.closed && h.fingersUp === 4);
    const progress = palmHold(open, now);
    launchProgress.value = progress;
    setStatus(open ? `Hold your palm open… ${Math.round(progress * 100)}%`
        : 'Raise either open palm and hold it for a moment to begin.');
    if (progress >= 1) {
        waitingForPalm = false;
        forgetPlayer('launch');
        startCalibration();
        return;
    }
    requestAnimationFrame(watchForPalm);
}

async function startCalibration() {
    if (startingCalibration) return;
    startingCalibration = true;
    try {
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
        setStatus(`Calibration could not finish: ${err?.message || err}. Retry to start again.`, true);
        retryBtn.hidden = false;
    } finally {
        startingCalibration = false;
    }
}
retryBtn.addEventListener('click', prepareLaunch);
prepareLaunch();

function loop(now) {
    if (!running) return;
    const dt = now - lastT; lastT = now;
    fps = fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;

    const pan = updateGaze(now, window.innerWidth);
    drawGazePointer(gaze, now);
    // Apply to both lanes even while a sustained note has no visible hands.
    if (audio.shared.started) {
        for (const slot of [0, 1]) audio.getPlayer(slot).setPan(pan);
    }
    $('hud-gaze').textContent = gaze.calibrating ? 'calibrating'
        : gaze.tracking ? 'tracking' : 'lost · centering';
    $('hud-pan').textContent = pan.toFixed(2);
    if (gaze.calibrating || !audio.shared.started) {
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