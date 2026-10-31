// Shared, hands-free calibration for the instrument and standalone gaze test.
const GUIDE_SCALE = 0.65;
const GUIDE_X = 0.38; // Position in the mirrored camera preview.
const GUIDE_EYE_Y = (238 + (202 - 238) * GUIDE_SCALE) / 480;
export async function runCalibration(wg) {
    await wg.clearData();
    wg.removeMouseEventListeners();
    const tracker = wg.getTracker();
    const original = tracker.getEyePatches;
    let observation = null, sequence = 0;
    // getPositions alone can retain a lost face. Observe actual successful eye
    // extraction so alignment and training never advance on stale landmarks.
    tracker.getEyePatches = async function (...args) {
        const eyes = await original.apply(this, args);
        observation = { eyes, time: performance.now(), sequence: ++sequence };
        return eyes;
    };
    const panel = document.createElement('section');
    panel.className = 'ghost-calibration';
    panel.setAttribute('aria-label', 'Hands-free gaze calibration');
    panel.innerHTML = `
        <div class="ghost-instructions"><p class="ghost-title">Take your place, wandering spirit</p>
        <p class="ghost-message" role="status">Fit your face inside the outline. Line up your eyes with the guides.</p></div>
        <div class="ghost-preview"><video autoplay muted playsinline></video>
        <svg viewBox="0 0 640 480" preserveAspectRatio="none" aria-hidden="true">
          <g transform="translate(${GUIDE_X * 640} 238) scale(${GUIDE_SCALE}) translate(-320 -238)">
          <ellipse cx="320" cy="238" rx="128" ry="180" />
          <path d="M227 202 Q256 179 285 202 Q256 225 227 202 M355 202 Q384 179 413 202 Q384 225 355 202" />
          <circle cx="256" cy="202" r="7"/><circle cx="384" cy="202" r="7"/>
          </g>
        </svg></div>
        <div class="ghost-light" hidden><span></span></div>
        <p class="ghost-progress"></p>`;
    document.body.append(panel);
    const video = panel.querySelector('video');
    const source = document.getElementById(wg.params.videoElementId);
    video.srcObject = source.srcObject;
    const message = panel.querySelector('.ghost-message');
    const progress = panel.querySelector('.ghost-progress');
    const light = panel.querySelector('.ghost-light');
    const positions = [[.5,.5],[.1,.15],[.5,.15],[.9,.15],[.9,.5],[.9,.85],[.5,.85],[.1,.85],[.1,.5]];
    let frame, alignedSince = null, stage = 'align', index = 0;
    let settleSince = null, samples = 0, lastSample = 0, usedSequence = -1;
    const size = [innerWidth, innerHeight];
    try {
        await video.play();
        await new Promise((resolve, reject) => {
            function tick(now) {
                try {
                    if (innerWidth !== size[0] || innerHeight !== size[1]) {
                        throw new Error('Window size changed during calibration. Start calibration again.');
                    }
                    const fresh = observation?.eyes && now - observation.time < 500 && !document.hidden;
                    if (stage === 'align') {
                        const eyes = observation?.eyes;
                        const centers = fresh ? [eyes.left, eyes.right].map(e => ({
                            x: (e.imagex + e.width / 2) / source.videoWidth,
                            y: (e.imagey + e.height / 2) / source.videoHeight,
                        })) : [];
                        const midX = centers.length ? (centers[0].x + centers[1].x) / 2 : 0;
                        const midY = centers.length ? (centers[0].y + centers[1].y) / 2 : 0;
                        const spacing = centers.length ? Math.abs(centers[0].x - centers[1].x) : 0;
                        // Mirror camera x and scale tolerances with the drawn guide.
                        const aligned = fresh &&
                            Math.abs((1 - midX) - GUIDE_X) < .09 * GUIDE_SCALE &&
                            Math.abs(midY - GUIDE_EYE_Y) < .1 * GUIDE_SCALE &&
                            spacing > .12 * GUIDE_SCALE && spacing < .32 * GUIDE_SCALE;
                        panel.classList.toggle('aligned', !!aligned);
                        if (!aligned) alignedSince = null;
                        else alignedSince ??= now;
                        progress.textContent = aligned ? 'Hold your position…' : 'Move closer, farther, or sideways until the outline glows green.';
                        if (alignedSince !== null && now - alignedSince >= 1500) {
                            stage = 'targets';
                            panel.classList.add('following');
                            panel.querySelector('.ghost-title').textContent = 'Follow the light';
                            light.hidden = false;
                        }
                    } else {
                        const [nx, ny] = positions[index];
                        light.style.left = `${nx * 100}%`;
                        light.style.top = `${ny * 100}%`;
                        progress.textContent = `Light ${index + 1} of 9 · ${samples} / 5 samples`;
                        message.textContent = fresh ? 'Look at the bright center. Keep your head still; the light will move on its own.' : 'Waiting for your eyes… Keep your face visible.';
                        if (!fresh) settleSince = null;
                        else {
                            settleSince ??= now;
                            if (now - settleSince >= 1000 && now - lastSample >= 200 && observation.sequence !== usedSequence) {
                                // Train against the known target, never our own gaze prediction.
                                wg.recordScreenPosition(nx * innerWidth, ny * innerHeight, 'click');
                                usedSequence = observation.sequence;
                                lastSample = now;
                                samples++;
                                if (samples === 5) {
                                    index++;
                                    samples = 0;
                                    settleSince = null;
                                    if (index === positions.length) { resolve(); return; }
                                }
                            }
                        }
                    }
                    frame = requestAnimationFrame(tick);
                } catch (error) { reject(error); }
            }
            frame = requestAnimationFrame(tick);
        });
    } finally {
        cancelAnimationFrame(frame);
        tracker.getEyePatches = original;
        wg.removeMouseEventListeners();
        video.srcObject = null;
        panel.remove();
    }
}
