// Loaded only inside hand-runtime.html, never in WebGazer's window.
import { FilesetResolver, HandLandmarker } from
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
let detector, video, lastTime = -1, lastResult = { landmarks: [], handednesses: [] };

export async function initialize(stream) {
    video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    document.body.append(video);
    const metadata = new Promise(resolve => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
    });
    // Reuse the existing camera; no second getUserMedia request.
    video.srcObject = stream;
    await metadata;
    await video.play();
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    detector = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 4,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
    });
}

export function detect(nowMs) {
    if (video.readyState < 2 || video.currentTime === lastTime) return lastResult;
    lastTime = video.currentTime;
    lastResult = detector.detectForVideo(video, nowMs);
    return lastResult;
}
