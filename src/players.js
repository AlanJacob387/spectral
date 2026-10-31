// src/players.js — groups raw hands into players and keeps identities stable
// as people enter, leave, or shuffle.
//
//   assignPlayers(hands, nowMs) → [{ id, slot, hands: [rawHand...], cx }]
//
// Rules:
//   • 1–2 hands on screen → one player, wherever they stand.
//   • 3–4 hands → split by the largest horizontal gap into two groups.
//   • Groups are matched to existing players by nearest centre-x, so a player
//     keeps their id (voice, mode, held notes) while they move around.
//   • A player unseen for LEAVE_MS is dropped; `onLeave(id)` fires so audio can release.
//   • slot (0 or 1) is the stable UI/audio lane; ids are monotonically increasing.

const MAX_PLAYERS = 2;
const LEAVE_MS = 1200;
const MIN_SPLIT_GAP = 0.18;   // normalized x gap required to call it two people

let nextId = 1;
const players = new Map();    // id → { id, slot, cx, lastSeen }
let onLeaveCb = () => {};

export function onLeave(cb) { onLeaveCb = cb; }

export function assignPlayers(hands, nowMs) {
    const groups = groupHands(hands);

    // match groups → existing players by nearest centre
    const unmatched = new Set(players.keys());
    const result = [];
    const claimed = new Set();

    // greedy: closest pairs first
    const pairs = [];
    for (const g of groups) for (const p of players.values()) pairs.push([Math.abs(g.cx - p.cx), g, p]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, g, p] of pairs) {
        if (claimed.has(g) || !unmatched.has(p.id)) continue;
        claimed.add(g); unmatched.delete(p.id);
        p.cx = lerp(p.cx, g.cx, 0.3); p.lastSeen = nowMs;
        result.push({ id: p.id, slot: p.slot, hands: g.hands, cx: p.cx });
    }

    // new players for unclaimed groups (if a slot is free)
    for (const g of groups) {
        if (claimed.has(g)) continue;
        const slot = freeSlot();
        if (slot == null) continue;
        const p = { id: nextId++, slot, cx: g.cx, lastSeen: nowMs };
        players.set(p.id, p);
        result.push({ id: p.id, slot, hands: g.hands, cx: p.cx });
    }

    // expire
    for (const id of unmatched) {
        const p = players.get(id);
        if (nowMs - p.lastSeen > LEAVE_MS) { players.delete(id); onLeaveCb(id, p.slot); }
    }

    return result.sort((a, b) => a.slot - b.slot);
}

export function activePlayers() {
    return [...players.values()].sort((a, b) => a.slot - b.slot);
}

// ------------------------------------------------------------------
function groupHands(hands) {
    if (!hands.length) return [];
    const withX = hands.map(h => ({ h, x: 1 - palmX(h.landmarks) })); // mirrored
    withX.sort((a, b) => a.x - b.x);

    if (withX.length <= 2) return [mkGroup(withX)];

    // largest gap splits into two
    let bestI = -1, bestGap = 0;
    for (let i = 1; i < withX.length; i++) {
        const gap = withX[i].x - withX[i - 1].x;
        if (gap > bestGap) { bestGap = gap; bestI = i; }
    }
    if (bestGap < MIN_SPLIT_GAP) {
        // all bunched together: treat the two most-separated as one player, ignore extras
        return [mkGroup(withX.slice(0, 2))];
    }
    const a = withX.slice(0, bestI), b = withX.slice(bestI);
    return [mkGroup(a.slice(-2)), mkGroup(b.slice(0, 2))];
}

function mkGroup(list) {
    return { hands: list.map(e => e.h), cx: list.reduce((s, e) => s + e.x, 0) / list.length };
}

function palmX(lm) {
    return (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
}

function freeSlot() {
    const used = new Set([...players.values()].map(p => p.slot));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s;
    return null;
}

function lerp(a, b, t) { return a + (b - a) * t; }