import type { ChessEmote } from '../types';

export type ChessSound = 'move-self' | 'move-opponent' | 'capture' | 'castle' | 'move-check' | 'promote' | 'game-start' | 'game-end' | 'illegal';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

const getCtx = () => {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 4;
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(comp).connect(ctx.destination);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 6);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
};

const wood = (c: AudioContext, at: number, pitch: number, level: number, decay = 1) => {
    const src = c.createBufferSource();
    src.buffer = noise;
    const out = c.createGain();
    out.gain.value = level;
    out.connect(master!);
    [
        [1, 18, 0.07, 1],
        [2.32, 22, 0.045, 0.55],
        [4.1, 26, 0.025, 0.3],
    ].forEach(([ratio, q, dur, gain]) => {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = pitch * ratio;
        bp.Q.value = q;
        const g = c.createGain();
        g.gain.setValueAtTime(gain * 9, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur * decay);
        src.connect(bp).connect(g).connect(out);
    });
    const thump = c.createOscillator();
    thump.frequency.setValueAtTime(pitch * 0.42, at);
    thump.frequency.exponentialRampToValueAtTime(pitch * 0.25, at + 0.05);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.5, at);
    tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06 * decay);
    thump.connect(tg).connect(out);
    src.start(at);
    src.stop(at + 0.2);
    thump.start(at);
    thump.stop(at + 0.1);
};

const chime = (c: AudioContext, at: number, freq: number, dur: number, level: number) => {
    [1, 2.01, 3.98].forEach((h, i) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.frequency.value = freq * h;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(level / (i * 2 + 1), at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur / (i + 1));
        osc.connect(g).connect(master!);
        osc.start(at);
        osc.stop(at + dur + 0.05);
    });
};

export const playChessSound = (name: ChessSound) => {
    try {
        const c = getCtx();
        if (!c) return;
        const t = c.currentTime + 0.01;
        if (name === 'move-self') wood(c, t, 520, 0.8);
        else if (name === 'move-opponent') wood(c, t, 470, 0.75);
        else if (name === 'capture') {
            wood(c, t, 430, 0.9, 1.2);
            wood(c, t + 0.028, 610, 0.65);
        } else if (name === 'castle') {
            wood(c, t, 520, 0.75);
            wood(c, t + 0.11, 470, 0.8);
        } else if (name === 'move-check') {
            wood(c, t, 500, 0.8);
            chime(c, t + 0.02, 1046, 0.35, 0.12);
        } else if (name === 'promote') {
            wood(c, t, 520, 0.75);
            chime(c, t + 0.05, 784, 0.25, 0.1);
            chime(c, t + 0.13, 1175, 0.4, 0.1);
        } else if (name === 'game-start') {
            chime(c, t, 659, 0.35, 0.13);
            chime(c, t + 0.11, 988, 0.6, 0.13);
        } else if (name === 'game-end') {
            chime(c, t, 988, 0.35, 0.13);
            chime(c, t + 0.12, 784, 0.35, 0.13);
            chime(c, t + 0.24, 523, 0.8, 0.13);
        } else if (name === 'illegal') {
            wood(c, t, 300, 0.6, 0.8);
            wood(c, t + 0.08, 300, 0.6, 0.8);
        }
    } catch {
        return;
    }
};

const emoteAudio = new Map<ChessEmote, HTMLAudioElement>();

export const playChessEmoteSound = (emote: ChessEmote) => {
    try {
        let audio = emoteAudio.get(emote);
        if (!audio) {
            audio = new Audio(`/sounds/chess/${emote}.mp3`);
            emoteAudio.set(emote, audio);
        }
        audio.currentTime = 0;
        void audio.play().catch(() => {});
    } catch {
        return;
    }
};

export const soundForMove = (flags: { capture?: boolean; castle?: boolean; promotion?: boolean; check?: boolean }, mine: boolean): ChessSound => {
    if (flags.check) return 'move-check';
    if (flags.promotion) return 'promote';
    if (flags.castle) return 'castle';
    if (flags.capture) return 'capture';
    return mine ? 'move-self' : 'move-opponent';
};
