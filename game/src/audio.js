// Sound for SOLMAR: every effect is synthesised with WebAudio, no audio files.
// The engine is two detuned oscillators whose pitch follows the car's speed;
// the siren is one oscillator alternating between two tones while the police
// are after you. Everything is a no-op until the first key press or click
// (browsers will not start audio before a gesture) and while muted.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenHigh = false;
  let sirenFlip = 0;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      engineOsc.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(ctx.destination);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(ctx.destination);
      sirenOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (muted || !ensure()) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  function noise(dur, vol, low) {
    if (muted || !ensure()) return;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = low || 900;
      const gain = ctx.createGain();
      gain.gain.value = vol || 0.2;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  // Solmar Radio: three original stations, sequenced live with WebAudio.
  // Every note is synthesised here from simple diatonic patterns — no
  // samples, no borrowed melodies. 32 steps per loop, 0 means rest.
  const STATIONS = [
    {
      name: 'Coast FM',
      bpm: 84,
      bass: [110, 0, 0, 0, 0, 0, 0, 0, 87.31, 0, 0, 0, 0, 0, 0, 0, 130.81, 0, 0, 0, 0, 0, 0, 0, 98, 0, 0, 0, 0, 0, 0, 0],
      lead: [440, 0, 523.25, 0, 659.25, 0, 0, 523.25, 0, 440, 0, 0, 392, 0, 0, 0, 523.25, 0, 659.25, 0, 783.99, 0, 659.25, 0, 587.33, 0, 523.25, 0, 0, 0, 0, 0],
      hat: [0, 1, 0, 1, 0, 1, 0, 1],
    },
    {
      name: 'Sunset Drive',
      bpm: 116,
      bass: [55, 0, 55, 0, 65.41, 0, 55, 0, 82.41, 0, 55, 0, 65.41, 0, 73.42, 0, 55, 0, 55, 0, 65.41, 0, 55, 0, 98, 0, 82.41, 0, 73.42, 0, 65.41, 0],
      lead: [0, 0, 440, 0, 0, 523.25, 0, 0, 659.25, 0, 0, 0, 523.25, 0, 440, 0, 0, 0, 440, 0, 0, 523.25, 0, 0, 587.33, 0, 659.25, 0, 783.99, 0, 0, 0],
      hat: [0, 1, 0, 1, 0, 1, 0, 1],
    },
    {
      name: 'Night Cruise',
      bpm: 100,
      bass: [73.42, 0, 0, 0, 0, 0, 87.31, 0, 0, 0, 0, 0, 55, 0, 0, 0, 65.41, 0, 0, 0, 0, 0, 87.31, 0, 0, 0, 73.42, 0, 0, 0, 0, 0],
      lead: [0, 0, 0, 587.33, 0, 0, 698.46, 0, 0, 587.33, 0, 0, 0, 523.25, 0, 0, 0, 0, 0, 587.33, 0, 0, 880, 0, 0, 698.46, 0, 587.33, 0, 0, 0, 0],
      hat: [0, 1, 0, 0, 0, 1, 0, 0],
    },
  ];
  let radioGain = null;
  let radioTimer = null;
  let radioIdx = 0;
  let radioStep = 0;
  let radioNextT = 0;

  function radioVoice(freq, t, dur, type, vol) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(radioGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function radioHat(t, vol) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(radioGain);
    src.start(t);
  }

  function scheduleRadio() {
    if (!ctx || !radioGain) return;
    const st = STATIONS[radioIdx];
    const stepDur = 60 / st.bpm / 4;
    // After a long suspension the clock jumps: never schedule a burst of
    // stale notes — skip ahead to just after "now".
    if (radioNextT < ctx.currentTime - 0.05) radioNextT = ctx.currentTime + 0.05;
    try {
      while (radioNextT < ctx.currentTime + 0.15) {
        const s = radioStep % 32;
        const b = st.bass[s];
        if (b) radioVoice(b, radioNextT, stepDur * 1.8, 'triangle', 0.10);
        const l = st.lead[s];
        if (l) radioVoice(l, radioNextT, stepDur * 2.2, 'sine', 0.055);
        if (st.hat[s % 8]) radioHat(radioNextT, 0.03);
        radioStep += 1;
        radioNextT += stepDur;
      }
    } catch {
      // The radio never stops the game.
    }
  }

  function radioStart() {
    if (radioTimer || !ensure()) return;
    try {
      radioGain = ctx.createGain();
      radioGain.gain.value = muted ? 0 : 0.06;
      radioGain.connect(ctx.destination);
      radioNextT = ctx.currentTime + 0.1;
      radioStep = 0;
      radioTimer = setInterval(() => {
        try { scheduleRadio(); } catch { /* radio never stops the game */ }
      }, 30);
    } catch {
      radioTimer = null;
    }
  }

  function radioNext() {
    if (!radioTimer) {
      radioStart();
      return STATIONS[radioIdx].name;
    }
    radioIdx = (radioIdx + 1) % STATIONS.length;
    return STATIONS[radioIdx].name;
  }

  return {
    resume,
    setMuted(value) {
      muted = !!value;
      if (engineGain) engineGain.gain.value = 0;
      if (sirenGain) sirenGain.gain.value = 0;
      if (radioGain) radioGain.gain.value = muted ? 0 : 0.06;
    },
    isMuted() {
      return muted;
    },
    engine(speedRatio, driving) {
      if (muted || !ensure() || ctx.state !== 'running') return;
      const target = driving ? 0.03 + 0.05 * speedRatio : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(52 + 130 * speedRatio, ctx.currentTime, 0.08);
    },
    siren(on, dt) {
      if (muted || !ensure() || ctx.state !== 'running') return;
      sirenGain.gain.setTargetAtTime(on ? 0.035 : 0, ctx.currentTime, 0.1);
      if (!on) return;
      sirenFlip += dt;
      if (sirenFlip > 0.42) {
        sirenFlip = 0;
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setValueAtTime(sirenHigh ? 950 : 700, ctx.currentTime);
      }
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.12);
      setTimeout(() => tone(990, 0.12, 'sine', 0.12), 70);
    },
    crash(hard) {
      noise(0.22, hard ? 0.35 : 0.18, 500);
      tone(70, 0.25, 'sine', 0.25, 38);
    },
    shot() {
      noise(0.12, 0.3, 2400);
    },
    shotgun() {
      noise(0.28, 0.45, 900);
      tone(90, 0.22, 'sine', 0.3, 45);
    },
    rocket() {
      noise(0.5, 0.3, 1600);
      tone(160, 0.5, 'sawtooth', 0.14, 420);
    },
    explosion() {
      noise(0.6, 0.5, 420);
      tone(70, 0.55, 'sine', 0.4, 30);
    },
    punch() {
      noise(0.08, 0.2, 700);
    },
    jingle() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((freq, i) => setTimeout(() => tone(freq, 0.16, 'triangle', 0.14), i * 95));
    },
    busted() {
      tone(392, 0.3, 'triangle', 0.14, 311);
      setTimeout(() => tone(311, 0.45, 'triangle', 0.14, 233), 280);
    },
    radioStart,
    radioNext,
    radioName() {
      return STATIONS[radioIdx].name;
    },
  };
}
