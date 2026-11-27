import { U } from './shaders.js'
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-500.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-400-italic.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-800.css'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { ENGINE, detectWebGPU } from './gfx/engine.js'
import { gpuQuality } from './platform.js'
import { CSM } from './gfx/tsl-common.js'
import { initGpuShadows, renderGpuShadows } from './gfx/shadows.js'
import { cullGpuTrees, setGpuDistances, GT } from './gfx/gputrees.js'
import { createPost } from './gfx/post.js'
import { ringMaterial, beaconMaterial } from './gfx/materials.js'
import { PLATFORM, deviceLabel } from './platform.js'
import { D, loadAll, heightAt, neighborhoodAt, toLatLon } from './data.js'
import { initTerrain, updateTerrain, setCanopy, setTreeFar } from './world/terrain.js'
import { initShadows, renderShadows, SH, shadowScene } from './world/shadow.js'
import { initBuildings, updateBuildings, setBuildings, BLD, buildingWarmup, insideBuilding } from './world/buildings.js'
import { initSky, followSky, setPreset, tickSky, PRESETS, PRESET_ORDER } from './world/sky.js'
import { initRoads, updateRoads } from './world/roads.js'
import { makeAtlases } from './world/textures.js'
import { labRow } from './world/lab.js'
import { initTrees, updateTrees, pick, setHighlight, setTreeHighlight, setDistances, setMonth, T, forEachInRadius, buildCanopyTexture, treeStats } from './world/trees.js'
import { P, initPlayer, updatePlayer, teleport, toggleFly, heading } from './player.js'
import { startAudio, setAudioEnv, toggleMute, isMuted, setMusic, getMusic } from './audio.js'
import { $, esc, fmt, toast, bearingWord } from './ui/common.js'
import { openCard, closeCard, cardOpen, setTrackHandler, setWalkHandler, setFlyHandler } from './ui/card.js'
import { initMaps, drawMinimap, openBigMap, closeBigMap, track, setNhLookup, setMapFilter, centerMapOn, mapIsOpen } from './ui/maps.js'
import { initJournal, renderJournal, initSearch, getCatalogue } from './ui/panels.js'

// ---------- renderer ----------
// WebGPU where the browser has it (desktop Chrome/Edge, Android Chrome, Safari 26+ on Mac/iPhone/iPad);
// otherwise the original WebGL 2 engine.
let canvas = $('#c')
let renderer = null, post = null
const gpuFound = await detectWebGPU()
if (gpuFound) {
  try {
    ENGINE.q = gpuQuality(gpuFound.info)
    for (const k of ['taa', 'gtao', 'bloom']) if (new URLSearchParams(location.search).get(k) === '0') ENGINE.q[k] = false
    const r = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false })
    await r.init()
    if (!r.backend || !r.backend.isWebGPUBackend) throw new Error('WebGPU backend unavailable')
    renderer = r
    r.onDeviceLost = (info) => {
      // the GPU went away (driver reset, memory pressure on a phone): reload on the WebGL engine
      console.warn('WebGPU device lost', info)
      const u = new URL(location.href); u.searchParams.set('engine', 'gl'); location.replace(u)
    }
    Object.assign(ENGINE, { gpu: true, name: 'WebGPU', info: gpuFound.info })
    document.documentElement.classList.add('engine-webgpu')
  } catch (e) {
    console.warn('WebGPU init failed, using WebGL 2', e)
    const fresh = canvas.cloneNode(); canvas.replaceWith(fresh); canvas = fresh
  }
}
if (!renderer) {
  if (!PLATFORM.webgl2) {
    $('#t-status').textContent = 'This browser can’t run Canopy: it needs WebGL 2 or WebGPU (Safari 15+, Chrome, Firefox or Edge). On an iPhone or iPad, update iOS.'
    throw new Error('No WebGL2 / WebGPU')
  }
  renderer = new THREE.WebGLRenderer({ canvas, antialias: PLATFORM.aa, powerPreference: 'high-performance', stencil: false })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
}
const PR = ENGINE.gpu ? { max: ENGINE.q.prMax, min: ENGINE.q.prMin } : { max: PLATFORM.prMax, min: PLATFORM.prMin }
let pixelRatio = PR.max
renderer.setPixelRatio(pixelRatio)
renderer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 12000)
if (ENGINE.gpu) { camera.coordinateSystem = THREE.WebGPUCoordinateSystem; camera.updateProjectionMatrix() }
renderer.autoClear = true
if (ENGINE.gpu) {
  // cascades must exist before any material is built (they're baked into the shaders)
  CSM.taps = ENGINE.q.taps
  initGpuShadows(ENGINE.q.shadows)
}
// size from the canvas itself (fixed, inset 0): follows rotation and iOS toolbars, ignores the on-screen keyboard
function fit() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
}
addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 250))
window.visualViewport?.addEventListener('resize', fit)
const isTouch = PLATFORM.touch
if (isTouch) document.body.classList.add('touch')
// a touch device that also has a mouse or trackpad (iPad with keyboard, touchscreen laptop): drag to look, no pointer lock
// Mouse: a free, always-visible cursor by default (drag to look, click a tree, WASD to move) — like a map app.
// "Captured" mouse-look (pointer lock, cursor hidden) is a setting for people who want the game feel.
let lookMode = (() => { try { return localStorage.getItem('canopy.look') || 'free' } catch (e) { return 'free' } })()
P.noLock = isTouch || lookMode === 'free'
document.body.classList.toggle('free-look', P.noLock)
function setLookMode(m) {
  lookMode = m; try { localStorage.setItem('canopy.look', m) } catch (e) { }
  P.noLock = isTouch || m === 'free'
  document.body.classList.toggle('free-look', P.noLock)
  if (P.noLock) document.exitPointerLock?.()
  onLockChange(false)
}

const qs = new URLSearchParams(location.search)
const START = { lat: 37.75795, lon: -122.42562, yaw: 0.04 } // Dolores Street near 20th, looking north up the palm median
let state = 'title', overlay = null

function lock() {
  if (isTouch || P.noLock) return
  try {
    const r = canvas.requestPointerLock?.()
    if (r && r.catch) r.catch(() => { P.noLock = true; onLockChange(false) })
  } catch (e) { P.noLock = true; onLockChange(false) }
}

// ---------- boot ----------
async function boot() {
  setPreset(qs.get('sky') && PRESETS[qs.get('sky')] ? qs.get('sky') : 'day', true)
  initSky(scene)
  await loadAll(p => { $('#t-prog').style.width = (p * 80) + '%' })
  $('#t-status').textContent = 'Planting trees…'
  await new Promise(r => setTimeout(r, 30))
  initTerrain(scene); initRoads(scene)
  if (qs.get('month')) T.month = +qs.get('month')
  if (qs.get('bld') === '0') BLD.on = false
  initTrees(scene, renderer, await makeAtlases(renderer))
  if (!ENGINE.gpu) { initShadows(renderer, PLATFORM.shadow); SH.extent = PLATFORM.shadowExtent }
  else post = createPost(renderer, scene, camera, ENGINE.q)
  BLD.radius = PLATFORM.bldRadius
  initBuildings(scene)
  setCanopy(buildCanopyTexture())
  initPlayer(camera, canvas, { onLockChange })
  initMaps({
    catalogue: () => getCatalogue(),
    onSpecies: sp => { const e = getCatalogue().find(e => e.sps.includes(sp)); if (e) trackEntry(e, true) },
    onLandmarks: () => trackLandmarks(true),
    onClearFilter: () => stopTracking(),
    onPin: i => { openCard({ i }); },
  }); setNhLookup(neighborhoodAt)
  setWalkHandler(i => walkToTree(i)); setFlyHandler(i => flyAboveTree(i))
  initJournal(); initSearch(onSearchPick); setTrackHandler(sp => { const e = getCatalogue().find(e => e.sps.includes(sp)); if (e) trackEntry(e, mapIsOpen()) })
  buildCompass(); initSettings(); bindUI()
  // title camera: hovering above the start, looking west into the light
  const sx = (START.lon - D.world.lon0) * D.world.mlon, sy = (START.lat - D.world.lat0) * D.world.mlat
  P.x = sx; P.y = sy; P.z = heightAt(sx, sy) + 1.7; P.yaw = START.yaw
  if (qs.get('x')) { P.x = +qs.get('x'); P.y = +qs.get('y'); P.yaw = +(qs.get('yaw') || 0) }
  if (qs.has('lab')) labRow()
  streamAround(true)
  if (ENGINE.gpu) {
    // compile every pipeline now, behind the title card, so nothing pops in later
    $('#t-status').textContent = 'Preparing the GPU…'
    const ax = P.x, az = -P.y, ay = heightAt(P.x, P.y) + 30
    const warm = [buildingWarmup(ax, ay, az)]
    placeRing(0); warm.push(selRing)
    for (const w of warm) { if (!w.parent) scene.add(w); w.visible = true }
    camera.position.set(ax, ay, az + 10); camera.lookAt(ax, ay, az); camera.updateMatrixWorld()
    U.uCamPos.value.copy(camera.position)
    cullGpuTrees(renderer, camera)
    try { await renderer.compileAsync(scene, camera) } catch (e) { console.warn(e) }
    scene.remove(warm[0]); selRing.visible = false
  }
  $('#t-prog').style.width = '100%'; { const nS = D.species.reduce((a, s) => a + s.n, 0); $('#t-status').textContent = `${fmt(nS)} street trees + ${fmt(D.trees.n - nS)} approximate park trees · ${fmt(getCatalogue().length)} species` }
  $('#t-walk').disabled = false; $('#t-fly').disabled = false; $('#t-map').disabled = false
  $('#t-walk').onclick = () => enter('walk'); $('#t-fly').onclick = () => enter('fly'); $('#t-map').onclick = () => { enter('walk'); openOverlay('bigmap') }
  if (qs.has('play')) enter(qs.get('play') === 'fly' ? 'fly' : 'walk')
  loop()
}

function enter(mode) {
  if (state !== 'title') return
  startAudio()
  state = 'play'
  $('#title').classList.add('out'); setTimeout(() => $('#title').classList.add('hidden'), 1300)
  $('#hud').classList.remove('hidden')
  P.enabled = true
  P.pitch = -0.04
  teleport(P.x, P.y)
  if (mode === 'fly') { toggleFly('fly'); P.z = heightAt(P.x, P.y) + 120; P.pitch = -0.35 }
  lock()
  $('#hint').innerHTML = isTouch ? 'Left thumb to walk (push to the outer ring to run) · drag to look · tap a tree' : 'Point at a tree and <kbd>Click</kbd> to identify it<br><kbd>M</kbd> map · <kbd>J</kbd> journal · <kbd>/</kbd> search · <kbd>F</kbd> fly · <kbd>H</kbd> help'
  setTimeout(() => { $('#hint').style.opacity = 0.8 }, 14000)
  if (isTouch) setTimeout(() => toast('Left thumb walks (push to the outer ring to run) · drag to look · tap a tree'), 1600)
}

// ---------- streaming ----------
let lastStream = [1e9, 1e9]
const dist = { near: 420, far: 1150, chunks: 2 }
function streamAround(force) {
  if (!force && Math.hypot(P.x - lastStream[0], P.y - lastStream[1]) < 25) return
  lastStream = [P.x, P.y]
  const r = P.mode === 'fly' ? dist.chunks + 1 : dist.chunks
  updateTerrain(P.x, P.y, r)
  updateRoads(P.x, P.y, r)
  updateTrees(P.x, P.y, force)
}

// ---------- picking ----------
const ray = new THREE.Raycaster()
let hoverI = -1, lastHover = 0, selRing
function pickAtScreen(sx, sy) {
  const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const maxD = P.mode === 'fly' ? 600 : 180
  return pick(ray.ray.origin, ray.ray.direction, maxD)
}
function inspect(hit) {
  if (!hit) return
  openCard({ i: hit.i })
  placeRing(hit.i)
}
function placeRing(i) {
  if (!selRing) {
    const g = new THREE.RingGeometry(0.9, 1.0, 48); g.rotateX(-Math.PI / 2)
    const m = ENGINE.gpu ? ringMaterial() : new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; varying vec2 vU; void main(){ gl_FragColor = vec4(vec3(1.0,0.75,0.35) * (0.55 + 0.45*sin(uTime*3.0)), 1.0); }',
    })
    selRing = new THREE.Mesh(g, m); scene.add(selRing)
  }
  const r = Math.max(1.2, T.W[i] * 0.55)
  selRing.position.set(T.px[i], T.py[i] + 0.35, T.pz[i]); selRing.scale.set(r, 1, r); selRing.visible = true
}
addEventListener('cardclose', () => { if (selRing) selRing.visible = false })

canvas.addEventListener('mousedown', e => {
  if (state !== 'play' || overlay) return
  if (!P.locked) { if (!P.noLock) lock(); return }
  if (e.button === 0) {
    const hit = pickAtScreen(innerWidth / 2, innerHeight / 2)
    if (hit) inspect(hit)
  }
})
canvas.addEventListener('tap', e => { if (state === 'play' && !overlay) inspect(pickAtScreen(e.detail.x, e.detail.y)) })

function onLockChange(locked) {
  if (state !== 'play') return
  $('#resume').textContent = P.noLock ? 'Drag to look · click a tree · WASD to walk · Esc for the map' : 'Click to look around · Esc frees the mouse'
  $('#resume').classList.toggle('hidden', locked || !!overlay || isTouch || (P.noLock && P.hasLooked))
}

// ---------- overlays ----------
function openOverlay(name) {
  if (overlay === name) { closeOverlay(); return }
  closeOverlay(true)
  overlay = name
  document.exitPointerLock?.()
  P.enabled = false; P.keys.clear()
  $('#' + name).classList.remove('hidden')
  $('#resume').classList.add('hidden')
  if (name === 'bigmap') openBigMap()
  if (name === 'journal') renderJournal()
  if (name === 'search') { const i = $('#s-input'); i.value = ''; i.dispatchEvent(new Event('input')); setTimeout(() => i.focus(), 30) }
  if (name === 'settings') syncSettings()
}
function closeOverlay(silent) {
  if (!overlay) return
  $('#' + overlay).classList.add('hidden')
  if (overlay === 'bigmap') closeBigMap()
  overlay = null
  P.enabled = state === 'play'
  if (!silent && !isTouch) $('#resume').classList.remove('hidden')
}

function travel(x, y) {
  closeOverlay(true)
  $('#fade').classList.add('on')
  setTimeout(() => {
    teleport(x, y)
    streamAround(true)
    setTimeout(() => $('#fade').classList.remove('on'), 120)
    if (!isTouch) $('#resume').classList.remove('hidden')
  }, 480)
}

// ---------- tracking ----------
let beacons
function trackEntry(e, keepMap) {
  if (!keepMap) closeOverlay(true)
  if (!e) return
  setMapFilter({ kind: 'species', sps: new Set(e.sps), name: e.name, c: e.c })
  track.entry = e
  setHighlight(e.sps)
  const set = new Set(e.sps), pts = []
  for (let i = 0; i < D.trees.n; i++) if (set.has(D.trees.sp[i])) pts.push(D.trees.x[i] * 0.5, D.trees.y[i] * 0.5)
  track.pts = new Float32Array(pts)
  $('#tracking').classList.remove('hidden')
  streamAround(true)
  updateTracking(true)
  toast(`Tracking <b>${esc(e.name)}</b> · ${fmt(pts.length / 2)} trees lit across the city`, e.c)
  if (!isTouch && !overlay) $('#resume').classList.remove('hidden')
}
function trackLandmarks(keepMap) {
  if (!keepMap) closeOverlay(true)
  setMapFilter({ kind: 'landmark' })
  const pts = []
  for (let i = 0; i < D.trees.n; i++) if (D.trees.flags[i] & 2) pts.push(D.trees.x[i] * 0.5, D.trees.y[i] * 0.5)
  track.entry = { name: 'Landmark trees', c: '#d9663a', sps: [] }
  setTreeHighlight(2)
  track.pts = new Float32Array(pts)
  $('#tracking').classList.remove('hidden')
  streamAround(true); updateTracking(true)
  toast(`Tracking <b>${fmt(pts.length / 2)} Landmark trees</b>, designated by the Board of Supervisors for their age, size, history or beauty`, '#d9663a')
  if (!isTouch && !overlay) $('#resume').classList.remove('hidden')
}
function stopTracking() {
  setMapFilter(null)
  track.entry = null; track.pts = null; setHighlight([]); $('#tracking').classList.add('hidden'); $('#compass-track').style.display = 'none'
  if (beacons) beacons.count = 0
  streamAround(true)
}
let nearestXY = null
function updateTracking() {
  if (!track.pts) return
  let best = 1e18, bx = 0, by = 0
  const p = track.pts
  const near = []
  for (let k = 0; k < p.length; k += 2) {
    const dx = p[k] - P.x, dy = p[k + 1] - P.y, d = dx * dx + dy * dy
    if (d < best) { best = d; bx = p[k]; by = p[k + 1] }
    if (d < 1500 * 1500) near.push(d, p[k], p[k + 1])
  }
  nearestXY = [bx, by]
  const d = Math.sqrt(best), brg = (Math.atan2(bx - P.x, by - P.y) * 180 / Math.PI + 360) % 360
  $('#tr-text').innerHTML = `<b>${esc(track.entry.name)}</b> · nearest ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} ${bearingWord(brg)}`
  // compass marker
  let rel = brg - heading(); rel = ((rel + 540) % 360) - 180
  const cm = $('#compass-track'), cw = $('#compass').clientWidth
  if (Math.abs(rel) < 80) { cm.style.display = 'block'; cm.style.left = (cw / 2 + rel / 80 * cw / 2) + 'px' } else cm.style.display = 'none'
  // light beams over nearby matches
  if (!beacons) {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true); g.translate(0, 0.5, 0)
    const m = ENGINE.gpu ? beaconMaterial() : new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; varying float vY; void main(){ float a = (1.0 - vY) * (0.35 + 0.15 * sin(uTime * 2.0 + vY * 6.0)); gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * a, 1.0); }',
    })
    beacons = new THREE.InstancedMesh(g, m, 160); beacons.frustumCulled = false; scene.add(beacons)
  }
  const idx = []
  for (let k = 0; k < near.length; k += 3) idx.push(k)
  idx.sort((a, b) => near[a] - near[b])
  const M = new THREE.Matrix4(); let n = 0
  for (const k of idx.slice(0, 160)) {
    const x = near[k + 1], y = near[k + 2], dd = Math.sqrt(near[k])
    if (dd < 25) continue
    const w = 0.8 + dd / 300
    M.makeScale(w, 90, w); M.setPosition(x, heightAt(x, y) + 2, -y); beacons.setMatrixAt(n++, M)
  }
  beacons.count = n; beacons.instanceMatrix.needsUpdate = true
}
// on wide screens the card covers the right side: turn so the tree sits in the middle of what's left
function cardYawOffset() {
  if (innerWidth <= 760) return 0
  const cardW = 400, hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)
  return Math.atan((cardW / 2) / (innerWidth / 2) * Math.tan(hfov / 2))
}
// Stand far enough back to see the whole tree, from the side with the clearest view of it
function walkToTree(i) {
  closeCard()
  const x = D.trees.x[i] * 0.5, y = D.trees.y[i] * 0.5
  const H = T.H[i], W = T.W[i]
  // frame trunk to crown top in ~70% of the 58° view, with room for the crown's width
  const d = Math.min(70, Math.max(12, H * 1.15 + W * 0.45))
  const occluders = (sx, sy) => {
    // how many other trees stand between us and it (along the sight line, within ~3 m of it)
    let n = 0
    const lx = x - sx, ly = y - sy, L2 = lx * lx + ly * ly
    forEachInRadius((sx + x) / 2, (sy + y) / 2, d / 2 + 4, j => {
      if (j === i) return
      const jx = T.px[j], jy = -T.pz[j]
      const t = ((jx - sx) * lx + (jy - sy) * ly) / L2
      if (t < 0.05 || t > 0.9) return
      const px = sx + lx * t - jx, py = sy + ly * t - jy
      if (px * px + py * py < (T.W[j] * 0.5 + 0.8) ** 2) n += T.H[j] > 3 ? 1 : 0.3
    })
    return n
  }
  let best = null, bestScore = 1e9
  for (const dd of [d, d * 0.7, d * 1.3, d * 1.7, Math.max(7, d * 0.4)]) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, tx = x + Math.cos(a) * dd, ty = y + Math.sin(a) * dd
    const g = heightAt(tx, ty)
    if (g < 0.4 || insideBuilding(tx, ty)) continue
    // prefer clear sight lines, standing level with the tree, and the intended distance
    const score = occluders(tx, ty) * 10 + Math.abs(g - heightAt(x, y)) * 0.6 + Math.abs(dd - d) * 0.05
    if (score < bestScore) { bestScore = score; best = [tx, ty] }
  }
  if (!best) best = [x + d * 0.7, y - d * 0.7]
  if (P.mode === 'fly') toggleFly('walk')
  travel(best[0], best[1])
  setTimeout(() => {
    const dist = Math.hypot(x - P.x, y - P.y), g0 = heightAt(x, y), eye = P.z
    P.yaw = Math.atan2(-(x - P.x), y - P.y) - cardYawOffset()
    P.pitch = Math.atan2(g0 + H * 0.5 - eye, dist)
    placeRing(i); openCard({ i })
  }, 520)
}
// hover high above a tree, looking down at it from the south-west, with the card open
function flyAboveTree(i) {
  closeCard()
  const x = D.trees.x[i] * 0.5, y = D.trees.y[i] * 0.5
  const g = heightAt(x, y), H = T.H[i], W = T.W[i]
  const back = 34 + W * 0.8, up = 38 + H * 0.9
  const px = x - back * 0.6, py = y - back * 0.8
  if (P.mode !== 'fly') toggleFly('fly')
  travel(px, py)
  setTimeout(() => {
    P.x = px; P.y = py; P.z = Math.max(heightAt(px, py) + 8, g + H + up)
    P.yaw = Math.atan2(-(x - P.x), y - P.y) - cardYawOffset()
    P.pitch = -Math.atan2(P.z - (g + H * 0.55), Math.hypot(x - P.x, y - P.y))
    P.vx = P.vy = P.vz = 0
    placeRing(i); openCard({ i })
  }, 520)
}
function goToNearest() {
  if (!nearestXY) return
  const [x, y] = nearestXY
  const a = Math.atan2(P.y - y, P.x - x)
  const tx = x + Math.cos(a) * 9, ty = y + Math.sin(a) * 9
  travel(heightAt(tx, ty) > 0.4 ? tx : x + 4, heightAt(tx, ty) > 0.4 ? ty : y)
  setTimeout(() => { P.yaw = Math.atan2(-(x - P.x), y - P.y); P.pitch = 0.12 }, 500)
}
function onSearchPick(e) { if (!e) { closeOverlay(); return } trackEntry(e) }

// ---------- compass ----------
function buildCompass() {
  const strip = $('#compass-strip'); let h = ''
  const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
  for (let k = -1; k <= 1; k++) for (let d = 0; d < 360; d += 15) {
    const pos = (d + k * 360) * 4
    h += labels[d] !== undefined ? `<span class="${d % 90 === 0 ? 'c' : ''}" style="left:${pos}px">${labels[d]}</span>` : `<span class="t" style="left:${pos}px"></span>`
  }
  strip.innerHTML = h
}
function updateCompass() {
  const cw = $('#compass').clientWidth
  $('#compass-strip').style.transform = `translateX(${cw / 2 - heading() * 4}px)`
}

// ---------- settings ----------
const SEASONS = [['Now', 0], ['Spring', 4], ['Summer', 7], ['Autumn', 11], ['Winter', 1]]
const DISTS = [['Short', 160, 600, 1, 45], ['Near', 240, 800, 1, 70], ['Medium', 320, 1150, 2, 100], ['Far', 480, 1700, 3, 150]]
let curPreset = PRESETS[qs.get('sky')] ? qs.get('sky') : 'day', curSeason = 0, curDist = PLATFORM.dist
function initSettings() {
  applyDist()
  $('#set-device').textContent = ENGINE.gpu ? deviceLabel().replace(/ · .*/, '') + ' · WebGPU · ' + ENGINE.q.level : deviceLabel() + ' · WebGL 2'
  if (isTouch) $('#set-sens-label').textContent = 'Look sensitivity'
  $('#set-sky').innerHTML = PRESET_ORDER.map(k => `<button data-k="${k}">${PRESETS[k].label}</button>`).join('')
  $('#set-season').innerHTML = SEASONS.map(([n], k) => `<button data-k="${k}">${n}</button>`).join('')
  $('#set-dist').innerHTML = DISTS.map(([n], k) => `<button data-k="${k}">${n}</button>`).join('')
  $('#set-sky').onclick = e => { const b = e.target.closest('button'); if (b) { curPreset = b.dataset.k; setPreset(curPreset); syncSettings() } }
  $('#set-season').onclick = e => { const b = e.target.closest('button'); if (b) { curSeason = +b.dataset.k; setMonth(SEASONS[curSeason][1] || new Date().getMonth() + 1); streamAround(true); syncSettings() } }
  $('#set-dist').onclick = e => { const b = e.target.closest('button'); if (b) { curDist = +b.dataset.k; applyDist(); syncSettings() } }
  $('#set-sens').oninput = e => { P.sens = +e.target.value }
  $('#set-look').innerHTML = '<button data-k="free">Free cursor</button><button data-k="lock">Captured</button>'
  $('#set-look').onclick = e => { const b = e.target.closest('button'); if (b) { setLookMode(b.dataset.k); syncSettings() } }
  $('#set-music').innerHTML = '<button data-k="lounge">Noir lounge</button><button data-k="score">Ambient score</button><button data-k="off">Off</button>'
  $('#set-music').onclick = e => { const b = e.target.closest('button'); if (b) { setMusic(b.dataset.k); syncSettings() } }
  $('#set-bld').innerHTML = '<button data-k="1">Show</button><button data-k="0">Hide</button>'
  $('#set-bld').onclick = e => { const b = e.target.closest('button'); if (b) { setBuildings(b.dataset.k === '1'); updateBuildings(P.x, P.y); syncSettings() } }
}
function applyDist() {
  const d = DISTS[curDist]; dist.near = d[1]; dist.far = d[2]; dist.chunks = d[3]; setDistances(d[1], d[2], d[4]); setTreeFar(d[2])
  if (ENGINE.gpu) {
    // GPU culling: the presets scale the tier's (much larger) radii
    const k = [0.4, 0.6, 0.8, 1][curDist], t = ENGINE.q.trees
    setGpuDistances(t.hiR * k, t.midR * k, t.farR * k); setTreeFar(t.farR * k)
    dist.chunks = Math.max(d[3], Math.ceil(t.midR * k / 500))
  }
  streamAround(true)
}
function syncSettings() {
  document.querySelectorAll('#set-sky button').forEach(b => b.classList.toggle('on', b.dataset.k === curPreset))
  document.querySelectorAll('#set-season button').forEach(b => b.classList.toggle('on', +b.dataset.k === curSeason))
  document.querySelectorAll('#set-dist button').forEach(b => b.classList.toggle('on', +b.dataset.k === curDist))
  document.querySelectorAll('#set-look button').forEach(b => b.classList.toggle('on', b.dataset.k === lookMode))
  document.querySelectorAll('#set-music button').forEach(b => b.classList.toggle('on', b.dataset.k === getMusic()))
  document.querySelectorAll('#set-bld button').forEach(b => b.classList.toggle('on', (b.dataset.k === '1') === BLD.on))
}
function cycleSky() {
  curPreset = PRESET_ORDER[(PRESET_ORDER.indexOf(curPreset) + 1) % PRESET_ORDER.length]
  setPreset(curPreset); toast(PRESETS[curPreset].label)
}

// ---------- keys & buttons ----------
function bindUI() {
  addEventListener('keydown', e => {
    if (state !== 'play') return
    const typing = e.target && e.target.tagName === 'INPUT'
    if (e.key === 'Escape') {
      // one press does one obvious thing: close what's open, otherwise bring up the map
      if (overlay) closeOverlay()
      else if (typing) e.target.blur()
      else if (cardOpen()) closeCard()
      else openOverlay('bigmap')
      return
    }
    if (typing) return
    if (e.code === 'KeyM') { e.preventDefault(); openOverlay('bigmap') }
    else if (e.code === 'KeyJ') openOverlay('journal')
    else if (e.key === '/' || (e.code === 'KeyK' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); openOverlay('search') }
    else if (e.code === 'KeyT' && !overlay) cycleSky()
    else if (e.code === 'KeyH') openOverlay('help')
    else if (e.code === 'KeyX' && cardOpen()) closeCard()
    else if (e.code === 'KeyG' && track.pts && !overlay) goToNearest()
  })
  $('#tools').onclick = e => {
    const b = e.target.closest('button'); if (!b) return
    const a = b.dataset.act
    if (a === 'map') openOverlay('bigmap'); if (a === 'journal') openOverlay('journal'); if (a === 'search') openOverlay('search')
    if (a === 'settings') openOverlay('settings'); if (a === 'help') openOverlay('help'); if (a === 'sky') cycleSky()
    if (a === 'sound') { const m = toggleMute(); b.classList.toggle('muted-on', m) }
  }
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeOverlay())
  $('#minimap').onclick = () => openOverlay('bigmap')
  $('#tr-x').onclick = stopTracking
  $('#tr-go').onclick = goToNearest
  $('#resume').onclick = () => lock()
  addEventListener('modechange', e => { $('#mode-pill').classList.toggle('hidden', e.detail !== 'fly'); streamAround(true) })
  // clicking the dim backdrop of an overlay closes it
  for (const id of ['journal', 'settings', 'help', 'search']) $('#' + id).addEventListener('mousedown', e => { if (e.target.id === id) closeOverlay() })
}

// ---------- HUD refresh ----------
let tSlow = 0, tMini = 0
function slowHud() {
  const nh = neighborhoodAt(P.x, P.y)
  $('#where-nh').textContent = nh || (heightAt(P.x, P.y) < 0.3 ? 'Over the water' : 'San Francisco')
  const [lat, lon] = toLatLon(P.x, P.y)
  const g = heightAt(P.x, P.y)
  $('#where-sub').textContent = `${lat.toFixed(4)}° N  ${Math.abs(lon).toFixed(4)}° W  ·  ${Math.round(Math.max(0, g))} m${P.mode === 'fly' ? '  ·  alt ' + Math.round(P.z - Math.max(0, g)) + ' m' : ''}`
  // audio environment
  let shore = 0
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (heightAt(P.x + Math.cos(a) * 220, P.y + Math.sin(a) * 220) < 0) shore++ }
  let dens = 0; forEachInRadius(P.x, P.y, 60, i => { const dx = T.px[i] - P.x, dy = -T.pz[i] - P.y; if (dx * dx + dy * dy < 3600) dens++ })
  setAudioEnv({ altitude: P.z - Math.max(0, g), shore: shore / 8, density: dens, preset: curPreset })
  updateTracking()
}

// ---------- loop ----------
const clock = new THREE.Clock()
let titleT = 0
// Adaptive resolution: every two seconds, nudge the pixel ratio to hold ~45-60 fps; if even the lowest
// resolution can't keep up, shorten the draw distance once.
const perf = { t: 0, frames: 0, slow: 0, steppedDist: false }
function adapt(dt) {
  if (document.hidden || state !== 'play' || overlay) { perf.t = 0; perf.frames = 0; return }
  perf.t += dt; perf.frames++
  if (perf.t < 2) return
  const fps = perf.frames / perf.t
  perf.t = 0; perf.frames = 0
  let pr = pixelRatio
  if (fps < 40) pr = Math.max(PR.min, pr - (fps < 25 ? 0.2 : 0.1))
  else if (fps > 57) pr = Math.min(PR.max, pr + 0.05)
  if (Math.abs(pr - pixelRatio) > 0.01) { pixelRatio = pr; renderer.setPixelRatio(pr); fit() }
  if (fps < 24 && pixelRatio <= PR.min + 0.01) {
    if (++perf.slow >= 2 && perf.steps < 2 && curDist > 0) { perf.steps = (perf.steps || 0) + 1; perf.slow = 0; curDist--; applyDist(); syncSettings(); toast('Draw distance shortened to keep things smooth') }
  } else perf.slow = 0
}

function loop() {
  requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.25)
  adapt(dt)
  U.uTime.value += dt
  tickSky(dt)
  if (state === 'title') {
    updateBuildings(P.x, P.y)
    titleT += dt
    const sx = P.x, sy = P.y
    const ang = 0.9 + Math.sin(titleT * 0.05) * 0.5
    camera.position.set(sx + Math.cos(ang) * 30, heightAt(sx, sy) + 38 + Math.sin(titleT * 0.1) * 4, -(sy + Math.sin(ang) * 30))
    camera.rotation.set(-0.16, Math.PI / 2 + 0.25 + Math.sin(titleT * 0.05) * 0.15, 0, 'YXZ')
  } else {
    updatePlayer(dt, camera)
    streamAround(false)
    updateBuildings(P.x, P.y)
    // hover pick
    if (!isTouch && U.uTime.value - lastHover > 0.12 && (P.locked || (P.noLock && P.mouse)) && !overlay) {
      lastHover = U.uTime.value
      const [mx, my] = P.locked ? [innerWidth / 2, innerHeight / 2] : P.mouse
      const hit = pickAtScreen(mx, my)
      const hv = $('#hover')
      if (P.locked) { hv.style.left = '50%'; hv.style.top = 'calc(50% + 18px)' } else { hv.style.left = mx + 'px'; hv.style.top = (my + 22) + 'px' }
      const ni = hit ? hit.i : -1
      if (ni !== hoverI) {
        hoverI = ni
        const h = $('#hover')
        if (ni >= 0) {
          const info = T.info[D.trees.sp[ni]]
          h.innerHTML = `${esc(info.name)}<small>${Math.round(hit.t)} m · click to inspect</small>`
          h.classList.add('on'); $('#crosshair').classList.add('on'); document.body.classList.add('over-tree')
        } else { h.classList.remove('on'); $('#crosshair').classList.remove('on'); document.body.classList.remove('over-tree') }
      }
    }
    updateCompass()
    tSlow += dt; if (tSlow > 0.5) { tSlow = 0; slowHud() }
    tMini += dt; if (tMini > 0.08) { tMini = 0; drawMinimap() }
  }
  U.uCamPos.value.copy(camera.position)
  followSky(camera)
  camera.updateMatrixWorld()
  if (ENGINE.gpu) {
    cullGpuTrees(renderer, camera)
    renderGpuShadows(renderer, camera, shadowScene)
    if (qs.get('post') === '0') renderer.render(scene, camera); else post.render()
  } else {
    renderShadows(renderer, camera)
    renderer.render(scene, camera)
  }
}

boot().catch(err => { console.error(err); $('#t-status').textContent = 'Something went wrong loading the city: ' + err.message })

// headless capture of the WebGPU frame (canvas presentation isn't capturable in automated browsers)
async function capture() {
  const w = renderer.domElement.width, h = renderer.domElement.height
  const rt = new THREE.RenderTarget(w, h)
  renderer.setRenderTarget(rt)
  if (ENGINE.gpu) { cullGpuTrees(renderer, camera); renderGpuShadows(renderer, camera, shadowScene); renderer.setRenderTarget(rt); qs.get('post') === '0' ? renderer.render(scene, camera) : post.render() }
  else renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const id = c.getContext('2d').createImageData(w, h)
  id.data.set(px.length === w * h * 4 ? px : new Uint8Array(px.buffer, 0, w * h * 4))
  c.getContext('2d').putImageData(id, 0, 0)
  rt.dispose()
  return c.toDataURL('image/png')
}

// small debugging handle (used by automated checks)
window.canopy = { scene, capture, ENGINE, GT, treeStats, renderer, centerMapOn, P, D, T, travel, openCard, pickCenter: () => pickAtScreen(innerWidth / 2, innerHeight / 2), inspectCenter: () => inspect(pickAtScreen(innerWidth / 2, innerHeight / 2)), openOverlay, trackEntry, getCatalogue, setPreset }
