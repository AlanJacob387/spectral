// Require a sustained open hand; a missed/old frame resets the hold.
export function createPalmHold(durationMs = 1200) {
    let since = null, previous = null;
    return (open, now) => {
        if (!open || (previous !== null && now - previous > 250)) since = null;
        previous = now;
        if (!open) return 0;
        since ??= now;
        return Math.min(1, Math.max(0, (now - since) / durationMs));
    };
}
