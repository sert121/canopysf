// Generative ambient score. Pads glide through a slow progression; plucked-string phrases
// drift over them; wind, surf, birds and foghorns respond to where you are.
let ctx, master, music, sfx, verb, started = false, muted = false
// music: 'lounge' (a looping noir-jazz record), 'score' (the generative pads and plucks), or 'off'
let musicMode = (() => { try { return localStorage.getItem('canopy.music') || 'lounge' } catch (e) { return 'lounge' } })()
let lounge = null, loungeGain = null, loungeTone = null
const env = { altitude: 0, shore: 0, density: 0, preset: 'golden' }

const CHORDS = [
  [50, 57, 64, 66, 69],  // D add9
  [47, 54, 62, 66, 69],  // Bm7
  [43, 50, 59, 66, 71],  // G maj7
  [45, 52, 59, 64, 71],  // A sus2
  [43, 50, 57, 62, 66],  // G6/9-ish
  [50, 57, 62, 66, 73],  // D maj7
]
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81] // D major pentatonic, two octaves
const mtof = m => 440 * Math.pow(2, (m - 69) / 12)

function impulse(sec, decay) {
  const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) }
  return b
}
function noiseBuf(sec) {
  const len = ctx.sampleRate * sec, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0)
  let l = 0
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5 }
  return b
}
const ksCache = new Map()
function pluckBuf(midi) {
  if (ksCache.has(midi)) return ksCache.get(midi)
  const sr = ctx.sampleRate, f = mtof(midi), N = Math.round(sr / f), len = Math.floor(sr * 3.2)
  const b = ctx.createBuffer(1, len, sr), y = b.getChannelData(0)
  for (let i = 0; i < N; i++) y[i] = (Math.random() * 2 - 1) * 0.5
  for (let i = N + 1; i < len; i++) y[i] = 0.4985 * (y[i - N] + y[i - N - 1])
  // soften attack
  for (let i = 0; i < 200; i++) y[i] *= i / 200
  ksCache.set(midi, b); return b
}

let voices = [], padFilter, windGain, windFilter, surfGain, chordIdx = 0
export function startAudio() {
  if (started) { if (ctx.state === 'suspended') ctx.resume(); return }
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  started = true
  // iOS: play through the ringer switch where supported, and resume after calls, app switches and screen locks
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch (e) { }
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume() })
  const kick = () => { if (ctx.state !== 'running') ctx.resume() }
  addEventListener('touchend', kick, { passive: true }); addEventListener('pointerdown', kick, { passive: true })
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3
  master.connect(comp); comp.connect(ctx.destination)
  verb = ctx.createConvolver(); verb.buffer = impulse(5, 2.6)
  const verbGain = ctx.createGain(); verbGain.gain.value = 0.55; verb.connect(verbGain); verbGain.connect(master)
  music = ctx.createGain(); music.gain.value = 0.0; music.connect(master); music.connect(verb)
  sfx = ctx.createGain(); sfx.gain.value = 0.7; sfx.connect(master)
  // the lounge record: streamed through an <audio> element, looped (it starts and ends between two tunes,
  // so the loop lands on a natural pause), routed through WebAudio for fades and a little air filtering
  lounge = new Audio('audio/lounge.mp4'); lounge.loop = true; lounge.preload = 'auto'; lounge.setAttribute('playsinline', '')
  try {
    const src = ctx.createMediaElementSource(lounge)
    loungeTone = ctx.createBiquadFilter(); loungeTone.type = 'lowpass'; loungeTone.frequency.value = 18000; loungeTone.Q.value = 0.5
    loungeGain = ctx.createGain(); loungeGain.gain.value = 0
    src.connect(loungeTone); loungeTone.connect(loungeGain); loungeGain.connect(master)
  } catch (e) { loungeGain = null }
  document.addEventListener('visibilitychange', () => { if (!lounge) return; if (document.hidden) lounge.pause(); else if (musicMode === 'lounge') lounge.play().catch(() => {}) })
  applyMusic()

  // pads
  padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.4
  const padGain = ctx.createGain(); padGain.gain.value = 0.05
  padFilter.connect(padGain); padGain.connect(music)
  for (let v = 0; v < 5; v++) {
    const g = ctx.createGain(); g.gain.value = v === 0 ? 0.9 : 0.55
    const pan = ctx.createStereoPanner(); pan.pan.value = (v - 2) * 0.3
    const oscs = [ctx.createOscillator(), ctx.createOscillator()]
    oscs[0].type = 'triangle'; oscs[1].type = 'sawtooth'
    const sg = ctx.createGain(); sg.gain.value = 0.18
    oscs[0].connect(g); oscs[1].connect(sg); sg.connect(g)
    oscs[1].detune.value = 7 * (v % 2 ? 1 : -1)
    g.connect(pan); pan.connect(padFilter)
    for (const o of oscs) { o.frequency.value = mtof(CHORDS[0][v]); o.start() }
    voices.push(oscs)
  }
  // wind
  const nb = noiseBuf(6)
  const wind = ctx.createBufferSource(); wind.buffer = nb; wind.loop = true
  windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = 0.7
  windGain = ctx.createGain(); windGain.gain.value = 0.05
  wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(sfx); wind.start()
  // surf
  const surf = ctx.createBufferSource(); surf.buffer = nb; surf.loop = true; surf.playbackRate.value = 0.7
  const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 700
  surfGain = ctx.createGain(); surfGain.gain.value = 0
  surf.connect(sf); sf.connect(surfGain); surfGain.connect(sfx); surf.start()

  scheduleChord(); schedulePhrase(); scheduleBird(); scheduleHorn(); swell()
}

function scheduleChord() {
  chordIdx = (chordIdx + 1) % CHORDS.length
  const ch = CHORDS[chordIdx], t = ctx.currentTime
  voices.forEach((oscs, v) => oscs.forEach(o => o.frequency.setTargetAtTime(mtof(ch[v]), t, 1.6)))
  setTimeout(scheduleChord, 9000 + Math.random() * 4000)
}
function pluck(midi, when, vel = 0.25, pan = 0) {
  const s = ctx.createBufferSource(); s.buffer = pluckBuf(midi)
  const g = ctx.createGain(); g.gain.value = vel
  const p = ctx.createStereoPanner(); p.pan.value = pan
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600
  s.connect(f); f.connect(g); g.connect(p); p.connect(music); s.start(when)
}
function schedulePhrase() {
  const t = ctx.currentTime + 0.05
  const ch = CHORDS[chordIdx]
  const pool = SCALE.filter(m => ch.some(c => (m - c) % 12 === 0) || Math.random() < 0.35)
  const n = Math.random() < 0.3 ? 1 : 2 + Math.floor(Math.random() * 3)
  let start = Math.floor(Math.random() * pool.length)
  for (let k = 0; k < n; k++) {
    const idx = Math.max(0, Math.min(pool.length - 1, start + (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * 2)))
    start = idx
    pluck(pool[idx], t + k * (0.32 + Math.random() * 0.25), 0.18 + Math.random() * 0.1, (Math.random() - 0.5) * 0.8)
  }
  if (Math.random() < 0.25) pluck(ch[0] + 12, t + 0.01, 0.12, 0) // a low root now and then
  setTimeout(schedulePhrase, 2500 + Math.random() * 5000)
}
function chirp(when, pan) {
  const o = ctx.createOscillator(); o.type = 'sine'
  const g = ctx.createGain(); g.gain.value = 0
  const p = ctx.createStereoPanner(); p.pan.value = pan
  const f0 = 2600 + Math.random() * 2200
  o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.7), when + 0.12)
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.035, when + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, when + 0.16)
  o.connect(g); g.connect(p); p.connect(sfx); p.connect(verb); o.start(when); o.stop(when + 0.2)
}
function scheduleBird() {
  const p = Math.min(1, env.density / 60) * (env.preset === 'dusk' ? 0.3 : 1) * (env.altitude > 60 ? 0.2 : 1)
  if (Math.random() < p * 0.8) {
    const t = ctx.currentTime + 0.05, pan = (Math.random() - 0.5) * 1.6, n = 2 + Math.floor(Math.random() * 4)
    for (let k = 0; k < n; k++) chirp(t + k * (0.13 + Math.random() * 0.1), pan)
  }
  setTimeout(scheduleBird, 1800 + Math.random() * 3500)
}
function horn(when, f, dur) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
  const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.05, when + 0.3)
  g.gain.setValueAtTime(0.05, when + dur - 0.4); g.gain.linearRampToValueAtTime(0, when + dur)
  o.connect(lp); lp.connect(g); g.connect(verb); g.connect(sfx); o.start(when); o.stop(when + dur + 0.1)
}
function scheduleHorn() {
  if (env.preset === 'karl') { const t = ctx.currentTime + 0.1; horn(t, 174, 2.4); horn(t + 2.6, 146, 2.8) }
  setTimeout(scheduleHorn, 28000 + Math.random() * 25000)
}
function swell() {
  const t = ctx.currentTime
  const w = 0.025 + Math.min(0.2, (Number.isFinite(env.altitude) ? Math.max(0, env.altitude) : 0) / 900) + (env.preset === 'karl' ? 0.03 : 0)
  windGain.gain.setTargetAtTime(w * (0.6 + 0.4 * Math.random()), t, 2.5)
  const alt = Number.isFinite(env.altitude) ? Math.max(0, Math.min(1500, env.altitude)) : 0
  windFilter.frequency.setTargetAtTime(300 + Math.random() * 400 + alt * 0.4, t, 3)
  padFilter.frequency.setTargetAtTime(650 + Math.random() * 600, t, 4)
  surfGain.gain.setTargetAtTime(env.shore * (0.08 + 0.1 * Math.random()), t, 2)
  // up high, or in Karl the Fog, the record sounds further away
  if (loungeTone) loungeTone.frequency.setTargetAtTime(alt > 150 ? 4500 : env.preset === 'karl' ? 7000 : 18000, t, 2)
  setTimeout(swell, 3000)
}

function applyMusic() {
  if (!ctx) return
  const t = ctx.currentTime
  music.gain.setTargetAtTime(musicMode === 'score' ? 0.5 : 0, t, 1.2)
  if (loungeGain) loungeGain.gain.setTargetAtTime(musicMode === 'lounge' ? 0.42 : 0, t, 0.8)
  else if (lounge) lounge.volume = musicMode === 'lounge' ? 0.5 : 0
  if (lounge) {
    if (musicMode === 'lounge') lounge.play().catch(() => {})
    else setTimeout(() => { if (musicMode !== 'lounge') lounge.pause() }, 2500)
  }
}
export function setMusic(mode) { musicMode = mode; try { localStorage.setItem('canopy.music', mode) } catch (e) { } applyMusic() }
export function getMusic() { return musicMode }
export function setAudioEnv(e) { Object.assign(env, e) }
export function toggleMute() {
  muted = !muted
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.3)
  return muted
}
export function isMuted() { return muted }
