// src/tracking.js — webcam + MediaPipe HandLandmarker
//
// Public API:
//   initTracking(videoEl, onStatus?)  → Promise<void>   (call after a user gesture)
//   detect(nowMs)                     → { hands, ts }
//
//   hands: [{ handedness: 'Left'|'Right', score, landmarks: [{x,y,z} × 21] }]
//          handedness is already flipped to match the MIRRORED on-screen view,
//          i.e. 'Right' = the hand on the user's right side.
//
// Landmarks are normalized 0..1 in the raw camera frame (x NOT mirrored).
// Callers mirror x themselves when drawing: xMirror = 1 - x.

const VIDEO_W = 640;
const VIDEO_H = 480;

let video = null;
let handRuntime = null;
let runtimeFrame = null;
let lastVideoTime = -1;
let lastResult = { hands: [], ts: 0 };

export const tracking = {
    ready: false,
    videoWidth: VIDEO_W,
    videoHeight: VIDEO_H,
};

// ------------------------------------------------------------------
export async function initTracking(videoEl, onStatus = () => {}, sharedStream = null) {
    video = videoEl;

    onStatus('Opening the eye…');
    const stream = sharedStream ?? await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H }, facingMode: 'user' },
        audio: false,
    });
    const metadata = new Promise(res => {
        video.onloadedmetadata = res;
    });
    video.srcObject = stream;
    await metadata;
    await video.play();
    tracking.videoWidth = video.videoWidth || VIDEO_W;
    tracking.videoHeight = video.videoHeight || VIDEO_H;

    onStatus('Summoning the model…');
    // The legacy FaceMesh loader and Tasks Vision both use Emscripten globals.
    // A separate same-origin window prevents either loader reading the other's Module.
    runtimeFrame?.remove();
    const frame = document.createElement('iframe');
    frame.title = 'Hand tracking runtime';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Keep a rendered video surface for Safari, without exposing another preview.
    frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0;';
    frame.src = new URL('./hand-runtime.html', import.meta.url).href;
    runtimeFrame = frame;
    try {
        await new Promise((resolve, reject) => {
            frame.onload = resolve;
            frame.onerror = () => reject(new Error('Could not load the hand tracking runtime.'));
            document.body.append(frame);
        });
        const ready = frame.contentWindow.handRuntimeReady;
        if (!ready) throw new Error('Hand tracking runtime is missing. Reload the page.');
        const { runtime, error } = await ready;
        if (error) throw error;
        await runtime.initialize(stream);
        handRuntime = runtime;
    } catch (error) {
        frame.remove();
        runtimeFrame = null;
        throw error;
    }

    tracking.ready = true;
    onStatus('Present.');
}

// ------------------------------------------------------------------
/** Run detection for the current video frame. Safe to call every rAF. */
export function detect(nowMs) {
    if (!tracking.ready || !video || video.readyState < 2) return lastResult;

    // VIDEO mode needs strictly increasing timestamps and a new frame
    if (video.currentTime === lastVideoTime) return lastResult;
    lastVideoTime = video.currentTime;

    const hr = handRuntime.detect(nowMs);
    const hands = [];
    for (let i = 0; i < hr.landmarks.length; i++) {
        const cat = hr.handednesses?.[i]?.[0] ?? hr.handedness?.[i]?.[0];
        const rawLabel = cat?.categoryName ?? 'Right';
        hands.push({
            // MediaPipe already assumes a mirrored selfie view: 'Left' = the user's left hand
            handedness: rawLabel === 'Left' ? 'Left' : 'Right',
            score: cat?.score ?? 0,
            landmarks: hr.landmarks[i],
        });
    }

    lastResult = { hands, ts: nowMs };
    return lastResult;
}

// ------------------------------------------------------------------
export const HAND = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

export const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17],
];