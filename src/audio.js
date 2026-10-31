// src/audio.js — Spectral audio engine (Tone.js, loaded globally in index.html)
//
// Shared: master chain (compressor → makeup → limiter), transport, reverb, delay.
// Per player: four voices + filter + panner + own state (voice, mode, chord, octave…).
//
// Public API:
//   startAudio()                 → Promise (call from a user gesture)
//   getPlayer(slot)              → PlayerAudio (created on demand; slot 0 or 1)
//   releasePlayer(slot)          → hard-stop + keep instance for reuse
//   setMasterVolume(db)
//   nextKey()                    → cycles the shared key (all players)
//   shared                       { started, key }
//
// PlayerAudio:
//   state   { instrument, octave, chord, mode, sustain, arp, lastNoteName, playing }
//   setInstrument(name) 'drift'|'haunt'|'knock'|'wail'
//   setOctave(-1|0|1)  setChord(1..4)  setMode('minor'|'major')
//   setSustain(bool)   setArp(bool)
//   setFilter(hz)      setPan(-1..1)   setReverb(wet01)  setVolume(db)
//   trigger(y01, vel)  release()       releaseAll()

export const VOICES = ['drift', 'haunt', 'knock', 'wail'];

const SCALES = {
    minor: [0, 3, 5, 7, 10],
    major: [0, 2, 4, 7, 9],
};
const KEYS = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];
const KEY_ROOT_MIDI = { C: 48, D: 50, Eb: 51, F: 53, G: 55, A: 57, Bb: 58 };
const CHORDS = {
    minor: { 1: [0], 2: [0, 7], 3: [0, 3, 7], 4: [0, 3, 7, 10] },
    major: { 1: [0], 2: [0, 7], 3: [0, 4, 7], 4: [0, 4, 7, 11] },
};

const BPM = 84;
const QUANT = '16n';
const MAX_VOICES = 6;

export const shared = { started: false, key: 'C' };

let master, reverb, delay;
const players = new Map();   // slot → PlayerAudio

// ------------------------------------------------------------------
export async function startAudio() {
    if (shared.started) return;
    await Tone.start();

    const limiter = new Tone.Limiter(-0.5).toDestination();
    const makeup = new Tone.Gain(3.5).connect(limiter);
    const comp = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.01, release: 0.2 }).connect(makeup);
    master = new Tone.Volume(8).connect(comp);
    reverb = new Tone.Reverb({ decay: 6, preDelay: 0.03, wet: 0.45 }).connect(master);
    delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.28, wet: 0.18 }).connect(reverb);

    Tone.Transport.bpm.value = BPM;
    Tone.Transport.start();
    await reverb.generate();
    shared.started = true;
}

export function getPlayer(slot) {
    if (!players.has(slot)) players.set(slot, createPlayer(slot));
    return players.get(slot);
}

export function releasePlayer(slot) {
    players.get(slot)?.releaseAll();
}

export function setMasterVolume(db) { master?.volume.rampTo(clamp(db, -40, 12), 0.1); }

export function nextKey() {
    shared.key = KEYS[(KEYS.indexOf(shared.key) + 1) % KEYS.length];
    for (const p of players.values()) p._onKeyChange();
    return shared.key;
}

// shared reverb amount: take the max of what players ask for
const reverbAsk = new Map();
function updateReverb() {
    if (!reverb) return;
    const wet = Math.max(0.15, ...reverbAsk.values());
    reverb.wet.rampTo(wet, 0.15);
}

// ------------------------------------------------------------------
function createPlayer(slot) {
    const state = {
        slot,
        instrument: 'drift',
        octave: 0,
        chord: 3,
        mode: 'minor',
        sustain: false,
        arp: false,
        lastNote: null,
        lastNoteName: '—',
        playing: false,
    };

    // per-player chain → shared delay
    const vol = new Tone.Volume(0).connect(delay);
    const panner = new Tone.Panner(0).connect(vol);
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 4500, rolloff: -12, Q: 0.8 }).connect(panner);

    const voices = {
        drift: new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: MAX_VOICES, volume: 6,
            oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
            envelope: { attack: 0.6, decay: 0.4, sustain: 0.9, release: 3.0 },
        }).connect(filter),
        haunt: new Tone.PolySynth(Tone.FMSynth, {
            maxPolyphony: MAX_VOICES, volume: 4,
            harmonicity: 3.01, modulationIndex: 8,
            oscillator: { type: 'sine' }, modulation: { type: 'sine' },
            envelope: { attack: 0.01, decay: 1.4, sustain: 0.15, release: 2.2 },
            modulationEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.05, release: 1 },
        }).connect(filter),
        knock: new Tone.PolySynth(Tone.MembraneSynth, {
            maxPolyphony: MAX_VOICES, volume: 8,
            pitchDecay: 0.015, octaves: 1.5,
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.22, sustain: 0.0, release: 0.3 },
        }).connect(filter),
        wail: new Tone.MonoSynth({
            volume: 6,
            oscillator: { type: 'sine' },
            filter: { type: 'lowpass', Q: 2, frequency: 2000 },
            envelope: { attack: 0.25, decay: 0.2, sustain: 1, release: 1.6 },
            filterEnvelope: { attack: 0.3, decay: 0.3, sustain: 0.6, release: 1.2, baseFrequency: 300, octaves: 3 },
            portamento: 0.12,
        }).connect(filter),
    };
    voices.wail.releaseAll = () => voices.wail.triggerRelease();

    let arpPattern = null;
    let heldNotes = [];
    let arpNotes = [];
    let wailOn = false;

    const voice = () => voices[state.instrument];

    function noteFromY(y01) {
        const scale = SCALES[state.mode];
        const steps = scale.length * 2 + 1;
        const idx = Math.round(clamp(y01, 0, 1) * (steps - 1));
        const oct = Math.floor(idx / scale.length);
        const deg = scale[idx % scale.length];
        return KEY_ROOT_MIDI[shared.key] + state.octave * 12 + oct * 12 + deg;
    }

    function chordNotes(rootMidi) {
        const type = state.instrument === 'knock' ? 1 : state.chord;
        return CHORDS[state.mode][type].map(iv => Tone.Frequency(rootMidi + iv, 'midi').toNote());
    }

    function releaseHeld() {
        if (wailOn) { voices.wail.triggerRelease(Tone.now()); wailOn = false; }
        if (!heldNotes.length) return;
        voice().triggerRelease(heldNotes, Tone.now());
        heldNotes = [];
    }

    function rebuildArp() {
        stopArp();
        if (!arpNotes.length) arpNotes = chordNotes(state.lastNote ?? noteFromY(0.5));
        arpPattern = new Tone.Pattern(
            (time, note) => voice().triggerAttackRelease(note, '16n', time, 0.7),
            arpNotes, 'upDown'
        );
        arpPattern.interval = '16n';
        arpPattern.start(Tone.Transport.nextSubdivision(QUANT));
    }

    function stopArp() {
        if (!arpPattern) return;
        arpPattern.stop(); arpPattern.dispose(); arpPattern = null;
    }

    function playCue() {
        const root = KEY_ROOT_MIDI[shared.key] + 12 + state.octave * 12;
        const notes = CHORDS[state.mode][state.chord === 1 ? 1 : 3].map(iv => Tone.Frequency(root + iv, 'midi').toNote());
        const cue = (state.instrument === 'wail' || state.instrument === 'knock') ? voices.haunt : voice();
        cue.triggerAttackRelease(notes, '8n', Tone.now(), 0.9);
    }

    const api = {
        state,

        setInstrument(name) {
            if (!voices[name] || name === state.instrument) return;
            api.releaseAll({ keepArp: state.arp });
            state.instrument = name;
            if (state.arp && name !== 'wail') rebuildArp();
        },
        setOctave(o) { state.octave = Math.max(-1, Math.min(1, o | 0)); },
        setChord(t) {
            t = Math.max(1, Math.min(4, t | 0));
            if (t === state.chord) return;
            state.chord = t;
            if (state.arp) rebuildArp();
            if (t === 1) playCue();
        },
        setMode(mode) {
            if ((mode !== 'minor' && mode !== 'major') || mode === state.mode) return;
            state.mode = mode;
            if (state.arp) rebuildArp();
            playCue();
        },
        setSustain(on) {
            state.sustain = !!on;
            if (!state.sustain && !state.playing) api.release(true);
        },
        setArp(on) {
            on = !!on && state.instrument !== 'wail';
            if (on === state.arp) return;
            state.arp = on;
            if (on) { releaseHeld(); rebuildArp(); } else stopArp();
        },
        setFilter(hz) { filter.frequency.rampTo(clamp(hz, 200, 8000), 0.08); },
        setPan(p)     { panner.pan.rampTo(clamp(p, -1, 1), 0.08); },
        setVolume(db) { vol.volume.rampTo(clamp(db, -40, 6), 0.1); },
        setReverb(wet){ reverbAsk.set(slot, clamp(wet, 0, 1)); updateReverb(); },

        trigger(y01, vel = 0.8) {
            if (!shared.started) return;
            const root = noteFromY(y01);
            state.lastNote = root;
            state.lastNoteName = Tone.Frequency(root, 'midi').toNote();
            state.playing = true;

            if (state.instrument === 'wail') {
                const freq = Tone.Frequency(root, 'midi').toFrequency();
                if (wailOn) voices.wail.setNote(freq, Tone.now());
                else { voices.wail.triggerAttack(freq, Tone.now(), clamp(vel, 0.2, 1)); wailOn = true; }
                return;
            }
            if (state.arp) {
                arpNotes = chordNotes(root);
                if (arpPattern) arpPattern.values = arpNotes;
                return;
            }
            const notes = chordNotes(root);
            const t = Tone.Transport.nextSubdivision(QUANT);
            if (heldNotes.length) voice().triggerRelease(heldNotes, t);
            voice().triggerAttack(notes, t, clamp(vel, 0.1, 1));
            heldNotes = notes;
        },

        release(force = false) {
            state.playing = false;
            if (state.sustain && !force) return;
            releaseHeld();
        },

        releaseAll({ keepArp = false } = {}) {
            state.playing = false;
            heldNotes = [];
            wailOn = false;
            Object.values(voices).forEach(v => v.releaseAll());
            if (!keepArp) { state.arp = false; stopArp(); }
            reverbAsk.delete(slot); updateReverb();
        },

        _onKeyChange() { if (state.arp) rebuildArp(); },
    };

    return api;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }