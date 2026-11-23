// audio.js — WebAudio sound manager for ISLA BRASA 3D (Worker A).
// Everything is synthesised with oscillators / filtered noise — no audio
// files, so it works offline. Every public method is a no-op (never throws)
// when WebAudio is missing, the context is suspended, or initAudio() has
// not run yet (e.g. before the first user gesture).
//
// API (created by createAudioManager(), stored on S.audio by main.js):
//   initAudio()            — create/resume the AudioContext (call on gesture)
//   setMuted(bool) / isMuted() / toggleMuted() -> bool
//   playSfx(name)          — 'gunshot' | 'punch' | 'pickup' | 'purchase' |
//                            'cash' | 'mission-complete' | 'click' |
//                            'footstep' | 'hurt'
//   startMusic() / stopMusic() — looping bassline + arp sequencer
//   setEngineLevel(0..1)   — engine hum pitch/volume follows car speed
//   setSiren(bool)         — police two-tone siren loop while wanted > 0

const MUTE_KEY = 'isla-brasa-muted';

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function storeMuted(m) {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
}

export function createAudioManager() {
  let ctx = null;
  let master = null;   // master gain (mute lives here)
  let musicBus = null; // music gain
  let sfxBus = null;   // sfx gain
  let noiseBuf = null;
  let muted = readMuted();

  // Engine hum: saw + sub sine through a lowpass, gain follows speed.
  let engineOsc = null, engineSub = null, engineGain = null, engineFilter = null;
  // Police siren: triangle osc, frequency flips 700 <-> 950 Hz.
  let sirenOsc = null, sirenGain = null, sirenTimer = null, sirenHigh = false;

  // Music sequencer state.
  let musicTimer = null, musicStep = 0, nextNoteTime = 0;
  const BPM = 112;
  const STEP_DUR = 60 / BPM / 2; // 8th notes
  // Am — F — C — G, one chord per bar (4 bars = 64 steps).
  const BASS_ROOTS = [55.0, 43.65, 65.41, 49.0];
  const BASS_STEPS = [0, 3, 6, 8, 11, 14]; // syncopated hits inside a bar
  const ARP_SCALE = [220.0, 261.63, 329.63, 392.0, 440.0, 523.25, 659.25];
  const ARP_SEQ = [0, 2, 4, 6, 5, 4, 2, 3, 0, 2, 4, 5, 6, 5, 3, 1];

  function ensureNoise() {
    if (noiseBuf || !ctx) return;
    try {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch { noiseBuf = null; }
  }

  // One enveloped oscillator note. freqEnd glides the pitch (0 = no glide).
  function tone({ freq = 440, freqEnd = 0, dur = 0.15, type = 'sine', vol = 0.2, when = 0, bus = null, attack = 0.005 }) {
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(1, freq), t0);
      if (freqEnd > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(bus || sfxBus || master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch { /* never throw from audio */ }
  }

  // One enveloped burst of white noise through a lowpass filter.
  function noise({ dur = 0.1, vol = 0.2, filterFreq = 1200, when = 0 }) {
    if (!ctx) return;
    try {
      ensureNoise();
      if (!noiseBuf) return;
      const t0 = ctx.currentTime + when;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(sfxBus || master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch { /* never throw from audio */ }
  }

  function scheduleMusicStep(step, t0) {
    if (!ctx) return;
    const when = Math.max(0, t0 - ctx.currentTime);
    const bar = Math.floor(step / 16) % 4;
    const inBar = step % 16;
    // Bass on the syncopated pattern, short plucky notes.
    if (BASS_STEPS.includes(inBar)) {
      tone({ freq: BASS_ROOTS[bar], dur: 0.22, type: 'triangle', vol: 0.22, when, bus: musicBus });
      tone({ freq: BASS_ROOTS[bar] / 2, dur: 0.22, type: 'sine', vol: 0.14, when, bus: musicBus });
    }
    // Arp: one pentatonic note per 8th step, quiet and bright.
    const arpNote = ARP_SCALE[ARP_SEQ[inBar] % ARP_SCALE.length];
    tone({ freq: arpNote, dur: 0.18, type: 'sine', vol: 0.07, when, bus: musicBus });
    // Hat tick on the off-beats.
    if (inBar % 2 === 1) noise({ dur: 0.03, vol: 0.025, filterFreq: 6000, when });
  }

  const api = {
    initAudio() {
      if (ctx) {
        try { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch { /* ignore */ }
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return; // no WebAudio: stay a silent no-op manager
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
        musicBus = ctx.createGain();
        musicBus.gain.value = 0.5;
        musicBus.connect(master);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        sfxBus.connect(master);
        // Engine hum chain (gain 0 until a car moves).
        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 400;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 55;
        engineSub = ctx.createOscillator();
        engineSub.type = 'sine';
        engineSub.frequency.value = 28;
        engineOsc.connect(engineFilter);
        engineSub.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        engineSub.start();
        // Siren chain (gain 0 until wanted > 0).
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 750;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch { ctx = null; }
    },

    setMuted(m) {
      muted = !!m;
      storeMuted(muted);
      try { if (master) master.gain.value = muted ? 0 : 1; } catch { /* ignore */ }
      return muted;
    },
    isMuted() { return muted; },
    toggleMuted() { return api.setMuted(!muted); },

    playSfx(name) {
      if (!ctx || muted) return;
      try {
        switch (name) {
          case 'gunshot':
            noise({ dur: 0.12, vol: 0.5, filterFreq: 1800 });
            tone({ freq: 220, freqEnd: 55, dur: 0.1, type: 'square', vol: 0.22 });
            break;
          case 'punch':
            noise({ dur: 0.08, vol: 0.3, filterFreq: 500 });
            tone({ freq: 140, freqEnd: 60, dur: 0.09, type: 'sine', vol: 0.3 });
            break;
          case 'pickup':
            tone({ freq: 880, dur: 0.09, type: 'sine', vol: 0.22 });
            tone({ freq: 1318.5, dur: 0.14, type: 'sine', vol: 0.22, when: 0.08 });
            break;
          case 'purchase':
            tone({ freq: 1046.5, dur: 0.08, type: 'triangle', vol: 0.22 });
            tone({ freq: 1318.5, dur: 0.08, type: 'triangle', vol: 0.22, when: 0.07 });
            tone({ freq: 1568, dur: 0.16, type: 'triangle', vol: 0.22, when: 0.14 });
            break;
          case 'cash':
            tone({ freq: 1568, dur: 0.08, type: 'triangle', vol: 0.2 });
            tone({ freq: 1046.5, dur: 0.16, type: 'triangle', vol: 0.2, when: 0.07 });
            break;
          case 'mission-complete':
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
              tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.24, when: i * 0.12 }));
            break;
          case 'click':
            tone({ freq: 660, dur: 0.05, type: 'square', vol: 0.12 });
            break;
          case 'footstep':
            noise({ dur: 0.06, vol: 0.1, filterFreq: 400 });
            break;
          case 'hurt':
            tone({ freq: 110, freqEnd: 45, dur: 0.22, type: 'sine', vol: 0.35 });
            noise({ dur: 0.15, vol: 0.18, filterFreq: 300 });
            break;
          default:
            break;
        }
      } catch { /* never throw from audio */ }
    },

    startMusic() {
      if (!ctx || musicTimer) return;
      try {
        musicStep = 0;
        nextNoteTime = ctx.currentTime + 0.1;
        musicTimer = setInterval(() => {
          try {
            if (!ctx) return;
            while (nextNoteTime < ctx.currentTime + 0.25) {
              scheduleMusicStep(musicStep, nextNoteTime);
              musicStep = (musicStep + 1) % 64;
              nextNoteTime += STEP_DUR;
            }
          } catch { /* ignore scheduler hiccups */ }
        }, 100);
      } catch { /* ignore */ }
    },

    stopMusic() {
      try { if (musicTimer) clearInterval(musicTimer); } catch { /* ignore */ }
      musicTimer = null;
    },

    setEngineLevel(level) {
      if (!ctx || !engineOsc) return;
      try {
        const l = Math.max(0, Math.min(1, level || 0));
        const t = ctx.currentTime;
        engineGain.gain.setTargetAtTime(l * 0.12, t, 0.08);
        engineOsc.frequency.setTargetAtTime(50 + l * 140, t, 0.08);
        engineSub.frequency.setTargetAtTime(25 + l * 70, t, 0.08);
        engineFilter.frequency.setTargetAtTime(300 + l * 900, t, 0.1);
      } catch { /* ignore */ }
    },

    setSiren(on) {
      if (!ctx || !sirenOsc) return;
      try {
        const t = ctx.currentTime;
        if (on) {
          sirenGain.gain.setTargetAtTime(0.045, t, 0.2);
          if (!sirenTimer) {
            sirenTimer = setInterval(() => {
              try {
                sirenHigh = !sirenHigh;
                sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 700, ctx.currentTime, 0.05);
              } catch { /* ignore */ }
            }, 450);
          }
        } else {
          sirenGain.gain.setTargetAtTime(0, t, 0.15);
          if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
        }
      } catch { /* ignore */ }
    },
  };

  return api;
}

export default createAudioManager;
