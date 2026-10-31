import { runCalibration } from './gaze-calibration.js';
// One calibrated gaze controls the stereo pan of both player lanes.
const ASSETS = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';
const LOST_MS = 500;
const SMOOTH_MS = 120;
export const gaze = { calibrated: false, calibrating: false, tracking: false, pan: 0, x: null, y: null };
let wg, stream, sample = null, lastUpdate = null;

export function gazeXToPan(x, width) {
    if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
    return 2 * Math.min(1, Math.max(0, x / width)) - 1;
}

export async function initGaze(onStatus) {
    if (stream) return stream;
    wg = window.webgazer;
    if (!wg?.begin) throw new Error('WebGazer could not load. Reload the page and try again.');
    onStatus('Opening the eye and loading gaze tracking…');
    wg.params.faceMeshSolutionPath = ASSETS;
    wg.saveDataAcrossSessions(false);
    wg.showVideoPreview(false);
    wg.showPredictionPoints(false);
    wg.setGazeListener(data => {
        // Missing predictions age out after LOST_MS; brief blinks do not snap pan.
        if (data && Number.isFinite(data.x)) sample = { x: data.x, y: data.y, ts: performance.now() };
    });
    await wg.begin();
    wg.removeMouseEventListeners();
    stream = document.getElementById(wg.params.videoElementId)?.srcObject;
    if (!stream) throw new Error('Gaze camera stream is unavailable.');
    return stream;
}

export async function calibrateGaze() {
    if (gaze.calibrating) return;
    gaze.calibrating = true;
    gaze.calibrated = false;
    gaze.pan = 0;
    sample = null;
    lastUpdate = null;
    try {
        await runCalibration(wg);
        gaze.calibrated = true;
        sample = null;
    } finally {
        gaze.calibrating = false;
    }
}

export function updateGaze(now, width) {
    gaze.tracking = (gaze.calibrated || gaze.calibrating) &&
        sample !== null && now - sample.ts <= LOST_MS;
    gaze.x = gaze.tracking ? sample.x : null;
    gaze.y = gaze.tracking && Number.isFinite(sample.y) ? sample.y : null;
    const target = gaze.tracking && !gaze.calibrating ? gazeXToPan(sample.x, width) : 0;
    const dt = lastUpdate === null ? 0 : Math.max(0, now - lastUpdate);
    lastUpdate = now;
    // Frame-rate-independent exponential smoothing: ~63% of a change in 120 ms.
    gaze.pan += (target - gaze.pan) * (1 - Math.exp(-dt / SMOOTH_MS));
    return gaze.pan;
}
