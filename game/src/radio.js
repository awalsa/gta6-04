// radio.js — Worker E (ISLA BRASA 3D)
// In-car radio: 3 stations (latin / hip-hop / rock), each a small WebAudio
// sequenced loop synthesised from oscillators + filtered noise — no audio
// files, works offline. Plays ONLY while the player is driving, respects
// the mute toggle (M) via S.audio.isMuted(), and never throws: if a
// station fails to initialise it falls back silently to the next station.
// audio.js exposes no context/bus, so radio owns its own AudioContext;
// while the radio plays it pauses the ambient music (S.audio.stopMusic)
// and resumes it when the radio stops.
//
// API: createRadio(S) -> { nextStation(), setStation(i), currentStation(),
//   updateRadio(S, dt), isPlaying() }. Standalone updateRadio(S, dt)
// delegates to S.radio (main.js can call either).
import { RADIO_STATIONS } from './config.js';

const NOTE = (root, semis) => root * Math.pow(2, semis / 12);

export function createRadio(S) {
  const stations = (S && S.config && Array.isArray(S.config.RADIO_STATIONS) && S.config.RADIO_STATIONS.length)
    ? S.config.RADIO_STATIONS : RADIO_STATIONS;
  let idx = 0;
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let playing = false;
  let musicPausedByRadio = false;
  let retryAt = 0;
  let failed = new Set();

  function muted() {
    try { return !!(S && S.audio && typeof S.audio.isMuted === 'function' && S.audio.isMuted()); } catch { return false; }
  }
  function inCar() {
    const p = S && S.player;
    return !!(p && (p.car || p.inCar || p.currentCar));
  }
  function currentStation() { return stations[idx] || stations[0]; }

  function ensureCtx() {
    try {
      if (!ctx) {
        const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.4;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    } catch { return false; }
  }

  function tone(freq, dur, type, vol, when) {
    if (!ctx || !master) return;
    try {
      const t0 = ctx.currentTime + Math.max(0, when);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(Math.max(1, freq), t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch { /* never throw from audio */ }
  }

  function noiseHit(dur, vol, filterFreq, when) {
    if (!ctx || !master || !noiseBuf) return;
    try {
      const t0 = ctx.currentTime + Math.max(0, when);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.05);
    } catch { /* never throw from audio */ }
  }

  function kick(when) {
    if (!ctx || !master) return;
    try {
      const t0 = ctx.currentTime + Math.max(0, when);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t0);
      osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.12);
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + 0.2);
    } catch { /* never throw from audio */ }
  }

  // One 8th-note step of the current station's loop.
  function scheduleStep(st, s, when) {
    const bar = Math.floor(s / 16) % 4;
    const inBar = s % 16;
    const rootShift = (st.roots && st.roots[bar]) || 0;
    const scale = st.scale || [0, 3, 5, 7, 10];
    const root = NOTE(st.root || 110, rootShift);
    // Bass line on the station's syncopated steps.
    if ((st.bass || []).includes(inBar)) {
      tone(root, 0.22, st.wave || 'triangle', 0.24, when);
      tone(root / 2, 0.22, 'sine', 0.12, when);
    }
    // Lead / arp: scale degree per step (-1 = rest).
    const deg = (st.lead && st.lead[inBar] != null) ? st.lead[inBar] : -1;
    if (deg >= 0) {
      const semis = scale[deg % scale.length] + 12 * Math.floor(deg / scale.length);
      tone(NOTE(st.root || 110, rootShift + semis) * 2, 0.16, st.leadWave || 'sine', 0.07, when);
    }
    // Rock: power-chord chug (root + fifth) on every 8th note.
    if (st.drums === 'rock') {
      tone(root * 2, 0.12, 'square', 0.05, when);
      tone(root * 3, 0.12, 'square', 0.04, when);
    }
    // Drums.
    if (st.drums === 'latin') {
      if (inBar % 4 === 0) kick(when);
      if (inBar % 2 === 1) noiseHit(0.03, 0.05, 7000, when);
      if (inBar === 4 || inBar === 12) noiseHit(0.06, 0.1, 2500, when);
    } else if (st.drums === 'boom-bap') {
      if (inBar === 0 || inBar === 7 || inBar === 10) kick(when);
      if (inBar === 4 || inBar === 12) noiseHit(0.12, 0.22, 1800, when);
      if (inBar % 2 === 1) noiseHit(0.02, 0.03, 8000, when);
    } else { // rock
      if (inBar % 4 === 0) kick(when);
      if (inBar === 4 || inBar === 12) noiseHit(0.1, 0.16, 2000, when);
      if (inBar % 2 === 0) noiseHit(0.03, 0.05, 6000, when);
    }
  }

  function startScheduler() {
    if (timer || !ctx) return;
    try {
      step = 0;
      nextTime = ctx.currentTime + 0.1;
      timer = setInterval(() => {
        try {
          if (!ctx) return;
          const st = currentStation();
          const stepDur = 60 / (st.tempo || 120) / 2;
          while (nextTime < ctx.currentTime + 0.25) {
            scheduleStep(st, step, Math.max(0, nextTime - ctx.currentTime));
            step = (step + 1) % 64;
            nextTime += stepDur;
          }
        } catch { /* scheduler hiccup: keep looping */ }
      }, 100);
    } catch { timer = null; }
  }

  function stopScheduler() {
    try { if (timer) clearInterval(timer); } catch { /* ignore */ }
    timer = null;
  }

  // Start playback, falling back silently to the next station if this
  // station's audio fails to initialise; if all fail, retry in 2s.
  function start() {
    if (playing) return true;
    for (let attempt = 0; attempt < stations.length; attempt++) {
      try {
        if (!ensureCtx()) throw new Error('no AudioContext');
        if (ctx.state === 'suspended') throw new Error('context suspended');
        startScheduler();
        if (!timer) throw new Error('scheduler failed');
        playing = true;
        failed.delete(idx);
        try {
          if (S && S.audio && typeof S.audio.stopMusic === 'function') {
            S.audio.stopMusic();
            musicPausedByRadio = true;
          }
        } catch { /* ambient music is optional */ }
        return true;
      } catch {
        failed.add(idx);
        idx = (idx + 1) % stations.length;
      }
    }
    retryAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 2000;
    return false;
  }

  function stop() {
    if (!playing && !timer) return;
    playing = false;
    stopScheduler();
    if (musicPausedByRadio) {
      musicPausedByRadio = false;
      try { if (S && S.audio && typeof S.audio.startMusic === 'function') S.audio.startMusic(); } catch { /* ignore */ }
    }
  }

  function restart() {
    const wasPlaying = playing;
    stop();
    if (wasPlaying) start();
  }

  const api = {
    nextStation() {
      idx = (idx + 1) % stations.length;
      restart();
      try { if (S && S.audio) S.audio.playSfx('click'); } catch { /* ignore */ }
      return currentStation();
    },
    setStation(i) {
      const n = ((Math.floor(i) % stations.length) + stations.length) % stations.length;
      idx = n;
      restart();
      return currentStation();
    },
    currentStation,
    isPlaying() { return playing; },
    updateRadio(_S, _dt) {
      try {
        const want = inCar() && !muted() && !(S && S.paused);
        if (want && !playing) {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (now >= retryAt) start();
        } else if (!want && playing) {
          stop();
        }
      } catch { /* radio must never break the game loop */ }
    },
  };
  return api;
}

export function updateRadio(S, dt) {
  try { if (S && S.radio && typeof S.radio.updateRadio === 'function') S.radio.updateRadio(S, dt); } catch { /* ignore */ }
}

export default createRadio;
