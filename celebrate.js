/* ═════════════════════════════════════════════════════════
   BLACK TREE — celebratory sound + confetti effects, shared by any page
   that wants to mark a moment: a small chime for a Savings/Charity
   deposit, a bigger trumpet-style fanfare + confetti for hitting a goal
   or paying off a debt. Pure Web Audio (synthesized tones, no audio
   files) so it works fully offline like everything else here, and no
   DOM markup is required beyond calling these from the page's own script.
   ═════════════════════════════════════════════════════════ */

/** A light two-note "ding" — frequent enough (every Savings/Charity entry) that it should stay quick and unobtrusive, not a big moment. */
function btPlayDepositChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    [784, 988].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.start(start); osc.stop(start + 0.3);
    });
  } catch (e) { /* Web Audio unavailable — saving still succeeds silently */ }
}

/** The original three-note achievement chime — kept for anywhere already using it. */
function btPlayChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    [660, 880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.start(start); osc.stop(start + 0.4);
    });
  } catch (e) {}
}

/** A short brass-ish "ta-da" for finishing a goal or settling a debt — a sawtooth oscillator (brighter/buzzier than sine) playing a rising C-E-G-C arpeggio, each note overlapping slightly into the next like a real fanfare phrase, with a longer sustained final note. */
function btPlayFanfare() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const notes = [
      { freq: 261.63, start: 0, dur: 0.16 },   // C4
      { freq: 329.63, start: 0.14, dur: 0.16 }, // E4
      { freq: 392.00, start: 0.28, dur: 0.16 }, // G4
      { freq: 523.25, start: 0.42, dur: 0.55 }  // C5, held
    ];
    notes.forEach((n) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = "sawtooth"; osc.frequency.value = n.freq;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass"; lowpass.frequency.value = 2200;
      osc.connect(lowpass); lowpass.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + n.start;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);
      osc.start(start); osc.stop(start + n.dur + 0.02);
    });
  } catch (e) {}
}

/** A short confetti burst across the whole screen. */
function btFireConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#C29133", "#E3B85C", "#3F7A4E", "#221E1F", "#B3413A"];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.3,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3,
    size: 5 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3
  }));
  let frame = 0;
  (function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (frame < 110) requestAnimationFrame(tick); else canvas.remove();
  })();
}

/** The full "you did it" moment — fanfare + confetti together, for a goal reached or a debt settled. */
function btCelebrateAchievement() {
  btPlayFanfare();
  btFireConfetti();
}
