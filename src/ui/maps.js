import { D, heightAt } from '../data.js'
import { P } from '../player.js'
import { T, forEachInRadius } from '../world/trees.js'
import { roadPack, ROAD_TYPES } from '../world/roads.js'
import { $, esc, fmt } from './common.js'

// ---------------- shared ----------------
let img, W, H, S
export const track = { entry: null, pts: null, nearest: -1 }
const ll = (lat, lon) => [(lon - D.world.lon0) * D.world.mlon, (lat - D.world.lat0) * D.world.mlat]
export const PLACES = [
  ['Dolores Park', 'Palms, lawns and a skyline view', 37.7596, -122.4269],
  ['The Panhandle', 'A long ribbon of old eucalyptus and elms', 37.7726, -122.4440],
  ['Golden Gate Park', 'Conservatory of Flowers', 37.7717, -122.4596],
  ['Stow Lake', 'Deep in Golden Gate Park', 37.7699, -122.4769],
  ['The Presidio', 'Cypress and pine forest', 37.7989, -122.4662],
  ['Lands End', 'Windswept cypress over the Golden Gate', 37.7830, -122.5050],
  ['Ocean Beach', 'Dunes at the edge of the Sunset', 37.7600, -122.5100],
  ['Mount Sutro', 'The cloud forest of blue gums', 37.7581, -122.4553],
  ['Twin Peaks', 'The whole city at your feet', 37.7525, -122.4476],
  ['Alamo Square', 'Above the Painted Ladies', 37.7764, -122.4346],
  ['Japantown', 'Flowering cherries', 37.7853, -122.4294],
  ['Washington Square', 'North Beach', 37.8008, -122.4103],
  ['The Embarcadero', 'Canary Island palms by the Ferry Building', 37.7956, -122.3935],
  ['Bernal Heights', 'A bare hilltop with a view', 37.7430, -122.4146],
  ['McLaren Park', 'Eucalyptus groves in the southeast', 37.7180, -122.4200],
  ['Lake Merced', 'Cypress shores', 37.7250, -122.4930],
]

let cb = {}
let nhAt = () => null
export function setNhLookup(fn) { nhAt = fn }

// ---------------- the tree map ----------------
// filter: null (all) | {kind:'species', sps:Set, name, c} | {kind:'landmark'}
const M = { pad: new Set(), cx: 0, cy: 0, z: 0.08, filter: null, dirty: true, open: false, pins: [], clusters: [], hover: -1, anim: null }
let roads = null // decoded [{t, xs: Float32Array, ys, x0,y0,x1,y1}]

export function initMaps(callbacks) {
  cb = callbacks
  img = new Image(); img.src = 'data/map.jpg'
  const w = D.world; W = w.gnx * w.gres; H = w.gny * w.gres
  img.onload = () => { S = img.width / W; M.dirty = true }
  // sidebar lists
  $('#bm-places').innerHTML = PLACES.map(([n, d], k) => `<button data-k="${k}">${esc(n)}<small>${esc(d)}</small></button>`).join('')
  $('#bm-places').onclick = e => { const b = e.target.closest('button'); if (!b) return; const [, , lat, lon] = PLACES[+b.dataset.k]; const [x, y] = ll(lat, lon); flyTo(x, y, 1.4) }
  // search
  const inp = $('#bm-q')
  inp.oninput = () => renderResults(inp.value)
  inp.onkeydown = e => {
    if (e.key === 'Enter') { const f = $('#bm-results .bmr'); if (f) f.click() }
    if (e.key === 'Escape') { inp.value = ''; renderResults('') ; e.stopPropagation() }
  }
  $('#bm-results').onclick = e => {
    const r = e.target.closest('.bmr'); if (!r) return
    const k = r.dataset
    if (k.type === 'species') cb.onSpecies(+k.i)
    if (k.type === 'street') { const st = D.streets[k.name]; const p = k.block ? st.b[k.block] : st.c; flyTo(p[0], p[1], k.block ? 3.2 : 1.1) }
    if (k.type === 'nh') { const n = D.nh.find(n => n.name === k.name); flyTo(n.c[0], n.c[1], 0.6) }
    if (k.type === 'place') { const [, , lat, lon] = PLACES[+k.i]; const [x, y] = ll(lat, lon); flyTo(x, y, 1.4) }
    if (k.type === 'landmark') cb.onLandmarks()
    inp.value = ''; renderResults('')
  }
  $('#bm-clear').onclick = () => cb.onClearFilter()
  renderResults('')
  // canvas interaction
  const cv = $('#bm')
  let drag = null
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: M.cx, cy: M.cy, moved: 0 }; cv.setPointerCapture(e.pointerId) })
  cv.addEventListener('pointermove', e => {
    if (drag) {
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      M.cx = drag.cx - (e.clientX - drag.x) / M.z; M.cy = drag.cy + (e.clientY - drag.y) / M.z; M.anim = null; M.dirty = true
    }
    hoverAt(e.clientX, e.clientY)
  })
  cv.addEventListener('pointerup', e => {
    if (drag && drag.moved < 6) clickAt(e.clientX, e.clientY)
    drag = null
  })
  cv.addEventListener('wheel', e => {
    e.preventDefault()
    const [x, y] = s2w(e.clientX, e.clientY)
    M.z = clampZ(M.z * Math.exp(-e.deltaY * 0.0018)); M.anim = null
    const [x2, y2] = s2w(e.clientX, e.clientY)
    M.cx += x - x2; M.cy += y - y2; M.dirty = true
  }, { passive: false })
  // pinch zoom
  const touches = new Map(); let pinch0 = null
  cv.addEventListener('touchstart', e => { for (const t of e.changedTouches) touches.set(t.identifier, [t.clientX, t.clientY]); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: M.z }; drag = null } }, { passive: true })
  cv.addEventListener('touchmove', e => { for (const t of e.changedTouches) touches.set(t.identifier, [t.clientX, t.clientY]); if (pinch0 && touches.size === 2) { const [a, b] = [...touches.values()]; M.z = clampZ(pinch0.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0.d); M.dirty = true } }, { passive: true })
  cv.addEventListener('touchend', e => { for (const t of e.changedTouches) touches.delete(t.identifier); if (touches.size < 2) pinch0 = null })
  document.querySelectorAll('#bm-pad [data-k]').forEach(b => {
    const code = b.dataset.k
    const on = e => { e.preventDefault(); M.pad.add(code); b.classList.add('on') }, off = () => { M.pad.delete(code); b.classList.remove('on') }
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off)
  })
  $('#bm-zin').onclick = () => zoomBy(2); $('#bm-zout').onclick = () => zoomBy(0.5); $('#bm-me').onclick = () => flyTo(P.x, P.y, Math.max(M.z, 1.2))
  addEventListener('resize', () => { if (M.open) sizeCanvas() })
  // decode every road once for crisp street lines when zoomed in
  roadPack().then(buf => { roads = decodeRoads(buf); M.dirty = true })
}

function decodeRoads(buf) {
  const out = [], dv = new DataView(buf)
  for (const [cx, cy, off, len] of D.roadIndex.chunks) {
    let o = off; const n = dv.getUint32(o, true); o += 4; const ox = cx * 500, oy = cy * 500
    for (let r = 0; r < n; r++) {
      const t = dv.getUint8(o), w = dv.getUint8(o + 1) / 4, np = dv.getUint16(o + 2, true); o += 4
      const xs = new Float32Array(np), ys = new Float32Array(np)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
      for (let k = 0; k < np; k++) { xs[k] = ox + dv.getInt16(o, true) / 10; ys[k] = oy + dv.getInt16(o + 2, true) / 10; o += 4; x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k]) }
      out.push({ t: ROAD_TYPES[t], w, xs, ys, x0, y0, x1, y1 })
    }
  }
  return out
}

const clampZ = z => Math.min(14, Math.max(0.035, z))
const side = () => innerWidth > 760 ? 330 : 0
function s2w(sx, sy) { const r = $('#bm').getBoundingClientRect(); const sd = side(); return [M.cx + (sx - r.left - sd - (r.width - sd) / 2) / M.z, M.cy - (sy - r.top - r.height / 2) / M.z] }
function w2s(x, y) { const sd = side(); return [sd + (innerWidth - sd) / 2 + (x - M.cx) * M.z, innerHeight / 2 - (y - M.cy) * M.z] }
function zoomBy(k) { flyTo(M.cx, M.cy, clampZ(M.z * k)) }
export function flyTo(x, y, z) { M.anim = { x0: M.cx, y0: M.cy, z0: M.z, x1: x, y1: y, z1: clampZ(z), t0: performance.now() } }

function sizeCanvas() { const cv = $('#bm'); cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; M.dirty = true }
export function openBigMap() {
  sizeCanvas()
  if (!M.seen) { M.cx = P.x; M.cy = P.y; M.z = Math.min(innerWidth, innerHeight) / 5200; M.seen = true }
  M.open = true; M.dirty = true; updateFilterUI(); tick()
}
export function closeBigMap() { M.open = false }
export function mapIsOpen() { return M.open }
export function setMapFilter(f) { M.filter = f; M.dirty = true; updateFilterUI() }
export function centerMapOn(x, y, z) { M.cx = x; M.cy = y; if (z) M.z = z; M.seen = true; M.dirty = true }

function tick() {
  if (!M.open) return
  requestAnimationFrame(tick)
  if (M.anim) {
    const a = M.anim; const t = Math.min(1, (performance.now() - a.t0) / 650); a.t = t; const k = t * t * (3 - 2 * t)
    const lz = Math.log(a.z0) + (Math.log(a.z1) - Math.log(a.z0)) * k
    M.cx = a.x0 + (a.x1 - a.x0) * k; M.cy = a.y0 + (a.y1 - a.y0) * k; M.z = Math.exp(lz); M.dirty = true
    if (a.t >= 1) M.anim = null
  }
  // pan with WASD / arrow keys or the on-screen pad; Q/E or -/= zoom
  const now = performance.now(), dt = Math.min(0.05, (now - (M.lastT || now)) / 1000); M.lastT = now
  const k = P.keys, typing = document.activeElement && document.activeElement.tagName === 'INPUT'
  if (!typing || M.pad.size) {
    const has = c => (!typing && k.has(c)) || M.pad.has(c)
    const dx = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0)
    const dy = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0)
    const dz = (has('KeyE') || has('Equal') ? 1 : 0) - (has('KeyQ') || has('Minus') ? 1 : 0)
    if (dx || dy || dz) {
      const sp = 520 * dt / M.z * (has('ShiftLeft') ? 2.5 : 1)
      M.cx += dx * sp; M.cy += dy * sp; if (dz) M.z = clampZ(M.z * Math.exp(dz * 1.6 * dt)); M.anim = null; M.dirty = true
    }
  }
  if (M.dirty) { M.dirty = false; draw() }
}

function passes(i) {
  const f = M.filter
  if (!f) return true
  if (f.kind === 'species') return f.sps.has(D.trees.sp[i])
  if (f.kind === 'landmark') return (D.trees.flags[i] & 2) !== 0
  return true
}

// relief: hillshade of the 10 m terrain, multiplied over the base map so hills read at city scale
let shadeCv = null
function hillshade() {
  if (shadeCv) return shadeCv
  const w = D.world, nx = w.gnx, ny = w.gny, Hh = D.H, cv = document.createElement('canvas')
  cv.width = nx; cv.height = ny
  const g = cv.getContext('2d'), id = g.createImageData(nx, ny)
  const lx = -0.5, ly = 0.5, lz = 0.71   // light from the north-west, 45° up
  const ex = 2.2 / (2 * w.gres)           // vertical exaggeration
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const at = (rr, cc) => Hh[Math.min(ny - 1, Math.max(0, rr)) * nx + Math.min(nx - 1, Math.max(0, cc))]
    const h = at(r, c)
    const dx = (at(r, c + 1) - at(r, c - 1)) * ex, dy = (at(r + 1, c) - at(r - 1, c)) * ex
    const l = Math.hypot(dx, dy, 1)
    const lam = (-dx * lx - dy * ly + lz) / l
    let v = h <= 0.2 ? 255 : Math.max(110, Math.min(255, 150 + (lam - 0.71) * 260 + 95))
    const o = ((ny - 1 - r) * nx + c) * 4   // canvas row 0 = north
    id.data[o] = v; id.data[o + 1] = v * 0.985; id.data[o + 2] = v * 0.96; id.data[o + 3] = 255
  }
  g.putImageData(id, 0, 0)
  return (shadeCv = cv)
}
// trees per hectare → colour (yellow-green ramp; empty land stays clear)
const RAMP = [[3, [255, 247, 188]], [8, [226, 240, 160]], [15, [178, 222, 137]], [25, [120, 198, 121]], [40, [49, 163, 84]], [70, [0, 104, 55]], [130, [0, 60, 36]]]
function rampAt(d) {
  if (d <= RAMP[0][0]) return RAMP[0][1]
  for (let k = 1; k < RAMP.length; k++) if (d <= RAMP[k][0]) {
    const [d0, c0] = RAMP[k - 1], [d1, c1] = RAMP[k], t = Math.log(d / d0) / Math.log(d1 / d0)
    return c0.map((v, j) => v + (c1[j] - v) * t)
  }
  return RAMP[RAMP.length - 1][1]
}
const PIN_Z = 1.25
function draw() {
  const cv = $('#bm'), c = cv.getContext('2d'), dpr = devicePixelRatio, w = D.world
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.fillStyle = '#5f8c96'; c.fillRect(0, 0, innerWidth, innerHeight)
  const [ix, iy] = w2s(w.gx0, w.gy0 + H)
  if (S) { c.imageSmoothingEnabled = true; c.drawImage(img, ix, iy, W * M.z, H * M.z) }
  if (D.H && M.z < 1.6) {
    c.save(); c.globalCompositeOperation = 'multiply'; c.globalAlpha = M.z < 0.6 ? 0.85 : 0.85 * (1.6 - M.z)
    c.drawImage(hillshade(), ix, iy, W * M.z, H * M.z); c.restore()
  }
  // view bounds in world
  const [vx0, vy1] = s2w(side(), 0), [vx1, vy0] = s2w(innerWidth, innerHeight)
  // crisp streets when zoomed in
  if (roads && M.z > 0.35) {
    const a = Math.min(1, (M.z - 0.35) / 0.4)
    const styleOf = t => /motorway|trunk|primary|secondary/.test(t) ? ['#fff6e6', 1.3] : /tertiary|residential|unclassified|living|service/.test(t) ? ['#fbf3e3', 1] : ['#b8946a', 0.5]
    c.lineCap = 'round'; c.lineJoin = 'round'
    for (const pass of [0, 1]) for (const r of roads) {
      if (r.x1 < vx0 || r.x0 > vx1 || r.y1 < vy0 || r.y0 > vy1) continue
      const [col, k] = styleOf(r.t)
      const lw = Math.max(1, r.w * M.z * k)
      c.globalAlpha = a
      c.strokeStyle = pass === 0 ? 'rgba(120,100,80,.35)' : col
      c.lineWidth = pass === 0 ? lw + 2 : lw
      if (pass === 0 && r.t.match(/path|footway|track|cycleway|steps/)) continue
      c.beginPath()
      for (let k2 = 0; k2 < r.xs.length; k2++) { const [sx, sy] = w2s(r.xs[k2], r.ys[k2]); k2 ? c.lineTo(sx, sy) : c.moveTo(sx, sy) }
      c.stroke()
    }
    c.globalAlpha = 1
  }
  // street names at high zoom
  if (M.z > 2.2 && D.streets) {
    c.font = '600 12px "Noto Sans", sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(70,58,46,.8)'
    for (const [name, st] of Object.entries(D.streets)) for (const [b, p] of Object.entries(st.b)) {
      if (p[0] < vx0 || p[0] > vx1 || p[1] < vy0 || p[1] > vy1) continue
      const [sx, sy] = w2s(p[0], p[1]); c.fillText(`${b} ${name}`, sx, sy)
    }
  }
  // neighborhood names at mid zoom
  if (M.z > 0.12 && M.z < 1.6) {
    c.font = `600 ${Math.min(16, 10 + M.z * 6)}px Manrope, sans-serif`; c.textAlign = 'center'; c.fillStyle = 'rgba(60,48,38,.7)'
    for (const n of D.nh) if (n.area > 90000 / M.z) { const [sx, sy] = w2s(n.c[0], n.c[1]); c.fillText(n.name, sx, sy - 30) }
  }
  // trees: clusters or pins
  M.pins = []; M.clusters = []
  const tr = D.trees, n = tr.n
  let visible = 0
  // decide: pins when zoomed in, or when a filter leaves few enough trees in view
  let pinMode = M.z >= PIN_Z
  if (!pinMode && M.filter) {
    let k = 0
    for (let i = 0; i < n && k <= 2500; i++) { const x = tr.x[i] * 0.5, y = tr.y[i] * 0.5; if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1 && passes(i)) k++ }
    pinMode = k <= 2500
  }
  M.pinMode = pinMode
  const DOT_Z = 0.22
  if (!pinMode && M.z < DOT_Z) {
    // World-anchored hexagons: the grid is fixed to the city, so it stays put while you pan and only
    // re-tiles at discrete zoom steps. Shade = how many trees; tint = the street's dominant species.
    const R = Math.pow(2, Math.round(Math.log2(11 / M.z)))   // hex radius in metres (≈11 px on screen)
    const SQ3 = Math.sqrt(3), cells = new Map()
    let maxN = 1
    for (let i = 0; i < n; i++) {
      const x = tr.x[i] * 0.5, y = tr.y[i] * 0.5
      if (x < vx0 - R * 2 || x > vx1 + R * 2 || y < vy0 - R * 2 || y > vy1 + R * 2) continue
      if (!passes(i)) continue
      if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) visible++
      // axial hex coords (pointy-top), cube rounding
      const qf = (SQ3 / 3 * x - y / 3) / R, rf = (2 / 3 * y) / R, sf = -qf - rf
      let q = Math.round(qf), r = Math.round(rf); const s3 = Math.round(sf)
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s3 - sf)
      if (dq > dr && dq > ds) q = -r - s3; else if (dr > ds) r = -q - s3
      const key = q * 100003 + r
      let e = cells.get(key); if (!e) { e = { q, r, n: 0, sp: new Map(), lm: 0 }; cells.set(key, e) }
      e.n++; if (tr.flags[i] & 2) e.lm++
      const s_ = tr.sp[i]; e.sp.set(s_, (e.sp.get(s_) || 0) + 1)
      if (e.n > maxN) maxN = e.n
    }
    const hex2rgb = h => { const v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255] }
    const fc = M.filter ? hex2rgb(M.filter.c || '#d9663a') : null
    const rad = R * M.z, inset = Math.max(0.4, rad * 0.05)
    const haArea = 2.598 * R * R / 1e4
    for (const e of cells.values()) {
      const cx = R * SQ3 * (e.q + e.r / 2), cy = R * 1.5 * e.r
      const [sx, sy] = w2s(cx, cy)
      let top = -1, tn = 0; for (const [sp, k] of e.sp) if (k > tn) { tn = k; top = sp }
      const dens = e.n / haArea
      if (!M.filter && dens < 3) continue
      let col, a
      if (fc) { const t = Math.min(1, Math.log(1 + e.n) / Math.log(1 + maxN)); col = fc; a = 0.25 + 0.65 * t }
      else { col = rampAt(dens); a = Math.min(0.9, 0.1 + 0.8 * Math.log(dens / 3) / Math.log(25)) }
      c.beginPath()
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const px = sx + (rad - inset) * Math.cos(a), py = sy + (rad - inset) * Math.sin(a); k ? c.lineTo(px, py) : c.moveTo(px, py) }
      c.closePath()
      c.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`; c.fill()
      if (e.lm) { c.fillStyle = '#d9663a'; c.beginPath(); c.arc(sx, sy, Math.max(1.6, rad * 0.16), 0, 7); c.fill() }
      M.clusters.push({ sx, sy, r: rad, x: cx, y: cy, n: e.n, top, nsp: e.sp.size, dens })
    }
    if (!M.filter) legend(c)
  } else if (!pinMode) {
    // individual trees as dots, coloured by species
    const rr = Math.max(1.1, Math.min(3.4, M.z * 2.4))
    for (let i = 0; i < n; i++) {
      const x = tr.x[i] * 0.5, y = tr.y[i] * 0.5
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue
      if (!passes(i)) continue
      visible++
      const [sx, sy] = w2s(x, y)
      c.fillStyle = M.filter ? (M.filter.c || '#d9663a') : T.info[tr.sp[i]].c
      c.globalAlpha = (tr.flags[i] & 1) ? 0.6 : 0.95
      if (rr < 1.8) c.fillRect(sx - rr, sy - rr, rr * 2, rr * 2)
      else { c.beginPath(); c.arc(sx, sy, rr, 0, 6.2832); c.fill() }
    }
    c.globalAlpha = 1
  } else {
    const order = []
    for (let i = 0; i < n; i++) {
      const x = tr.x[i] * 0.5, y = tr.y[i] * 0.5
      if (x < vx0 - 5 || x > vx1 + 5 || y < vy0 - 5 || y > vy1 + 20) continue
      if (!passes(i)) continue
      order.push(i)
    }
    visible = order.length
    order.sort((a, b) => tr.y[b] - tr.y[a]) // draw north-to-south so pins overlap naturally
    const big = M.z > 3.5, s = big ? 1 : Math.max(0.62, Math.min(1, 0.62 + (M.z - PIN_Z) * 0.2))
    for (const i of order) {
      const [sx, sy] = w2s(tr.x[i] * 0.5, tr.y[i] * 0.5)
      const info = T.info[tr.sp[i]]
      pin(c, sx, sy, info.c, s, (tr.flags[i] & 2) !== 0, (tr.flags[i] & 1) !== 0, i === M.hover)
      M.pins.push([sx, sy - 16 * s, i])
      if (big && M.z > 6) { c.font = '500 11px "Noto Sans", sans-serif'; c.textAlign = 'left'; c.fillStyle = 'rgba(40,32,26,.85)'; c.fillText(info.name, sx + 9, sy - 14) }
    }
  }
  // you are here
  const [px, py] = w2s(P.x, P.y)
  arrow(c, px, py, P.yaw, 11)
  $('#bm-count').textContent = `${fmt(visible)} ${M.filter ? 'matching ' : ''}trees in view` + (!M.pinMode ? ' · zoom in to see individual trees' : '')
}

function legend(c) {
  const x = side() + 18, y = innerHeight - 58, w = 210
  c.fillStyle = 'rgba(250,244,232,.92)'; c.beginPath(); c.roundRect(x - 10, y - 24, w + 20, 54, 10); c.fill()
  for (let k = 0; k < w; k++) { const d = Math.exp(Math.log(3) + (Math.log(130) - Math.log(3)) * k / w); const col = rampAt(d); c.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; c.fillRect(x + k, y, 1, 10) }
  c.fillStyle = 'rgba(40,32,26,.85)'; c.font = '600 11px "Noto Sans", sans-serif'; c.textAlign = 'left'; c.fillText('Trees per hectare', x, y - 8)
  c.font = '500 10px "Noto Sans", sans-serif'
  for (const d of [3, 10, 30, 100]) { const k = Math.log(d / 3) / Math.log(130 / 3) * w; c.textAlign = 'center'; c.fillText(d, x + k, y + 22) }
}
function pin(c, x, y, colr, s, landmark, approx, hover) {
  const h = 18 * s * (hover ? 1.25 : 1), r = 6.2 * s * (hover ? 1.25 : 1)
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x, y, r * 0.8, r * 0.3, 0, 0, 7); c.fill()
  c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x - r * 0.4, y - h * 0.45, x - r * 1.05, y - h * 0.62, x - r, y - h + r); c.arc(x, y - h + r, r, Math.PI, 0); c.bezierCurveTo(x + r * 1.05, y - h * 0.62, x + r * 0.4, y - h * 0.45, x, y)
  c.fillStyle = colr; c.fill(); c.lineWidth = 1.4; c.strokeStyle = landmark ? '#d9663a' : (approx ? 'rgba(255,255,255,.55)' : '#fffaf0'); c.stroke()
  c.fillStyle = landmark ? '#ffd36a' : '#fffaf0'; c.beginPath(); c.arc(x, y - h + r, r * 0.38, 0, 7); c.fill()
}
function arrow(c, x, y, yaw, s) {
  c.save(); c.translate(x, y); c.rotate(-yaw)
  c.fillStyle = '#d9663a'; c.strokeStyle = '#fff8ec'; c.lineWidth = 2.5
  c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.7, s * 0.8); c.lineTo(0, s * 0.35); c.lineTo(-s * 0.7, s * 0.8); c.closePath(); c.stroke(); c.fill()
  c.restore()
}

function hitPin(sx, sy) {
  let best = -1, bd = 14 * 14
  for (let k = M.pins.length - 1; k >= 0; k--) { const [x, y, i] = M.pins[k]; const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i } }
  return best
}
function hitCluster(sx, sy) { for (const cl of M.clusters) if ((cl.sx - sx) ** 2 + (cl.sy - sy) ** 2 < cl.r * cl.r * 0.8) return cl; return null }
function hoverAt(sx, sy) {
  const tip = $('#bm-tip')
  const i = M.pinMode ? hitPin(sx, sy) : -1
  if (i !== M.hover) { M.hover = i; M.dirty = true }
  let text = ''
  if (i >= 0) text = T.info[D.trees.sp[i]].name + ((D.trees.flags[i] & 2) ? ' · Landmark' : '')
  else { const cl = !M.pinMode ? hitCluster(sx, sy) : null; if (cl) text = `${fmt(cl.n)} trees (${Math.round(cl.dens)} per hectare) · ${cl.nsp} species · mostly ${T.info[cl.top].name}`; else { const [x, y] = s2w(sx, sy); text = nhAt(x, y) || '' } }
  if (text) { tip.style.display = 'block'; tip.style.left = (sx + 14) + 'px'; tip.style.top = (sy + 10) + 'px'; tip.textContent = text } else tip.style.display = 'none'
  $('#bm').style.cursor = i >= 0 || (!M.pinMode && hitCluster(sx, sy)) ? 'pointer' : 'grab'
}
function clickAt(sx, sy) {
  if (!M.pinMode) {
    const cl = hitCluster(sx, sy)
    if (cl) { flyTo(cl.x, cl.y, Math.max(M.z * 3, 0.6)); return }
    const [x, y] = s2w(sx, sy); flyTo(x, y, M.z * 2); return
  }
  const i = hitPin(sx, sy)
  if (i >= 0) cb.onPin(i)
}

// ---------------- search ----------------
function renderResults(q) {
  q = q.trim().toLowerCase()
  const out = []
  if (!q) {
    out.push(`<div class="bmr hint" data-type="landmark"><span class="sw" style="background:#d9663a"></span><div><b>★ Landmark trees</b><i>The city's legally protected trees</i></div></div>`)
    $('#bm-results').innerHTML = out.join(''); return
  }
  const m = q.match(/^(\d+)\s+(.+)$/) || q.match(/^(.+?)\s+(\d+)$/)
  let num = null, sq = q
  if (m) { if (/^\d+$/.test(m[1])) { num = +m[1]; sq = m[2] } else { num = +m[2]; sq = m[1] } }
  // streets
  const streets = Object.keys(D.streets).filter(s => s.toLowerCase().startsWith(sq) || s.toLowerCase().includes(' ' + sq) || s.toLowerCase().includes(sq)).sort((a, b) => D.streets[b].n - D.streets[a].n).slice(0, 5)
  for (const s of streets) {
    const st = D.streets[s]; let block = ''
    if (num !== null) { const b = String(Math.floor(num / 100) * 100); if (st.b[b]) block = b }
    out.push(`<div class="bmr" data-type="street" data-name="${esc(s)}" data-block="${block}"><span class="ic">⌖</span><div><b>${block ? esc(block + ' block of ') : ''}${esc(s)}</b><i>${fmt(st.n)} street trees</i></div></div>`)
  }
  // species
  const cat = cb.catalogue().filter(e => !e.unknown && (e.name.toLowerCase().includes(q) || e.sci.toLowerCase().includes(q))).slice(0, 7)
  for (const e of cat) out.push(`<div class="bmr" data-type="species" data-i="${e.sps[0]}"><span class="sw" style="background:${e.c}"></span><div><b>${esc(e.name)}</b><i>${esc(e.sci)} · ${e.n ? fmt(e.n) : 'park stands'}</i></div></div>`)
  // neighborhoods & places
  for (const n of D.nh.filter(n => n.name.toLowerCase().includes(q)).slice(0, 4)) out.push(`<div class="bmr" data-type="nh" data-name="${esc(n.name)}"><span class="ic">◎</span><div><b>${esc(n.name)}</b><i>Neighborhood</i></div></div>`)
  PLACES.forEach((p, k) => { if (p[0].toLowerCase().includes(q)) out.push(`<div class="bmr" data-type="place" data-i="${k}"><span class="ic">✦</span><div><b>${esc(p[0])}</b><i>${esc(p[1])}</i></div></div>`) })
  if ('landmark'.startsWith(q) || q.startsWith('landmark')) out.unshift(`<div class="bmr" data-type="landmark"><span class="sw" style="background:#d9663a"></span><div><b>★ Landmark trees</b><i>The city's legally protected trees</i></div></div>`)
  $('#bm-results').innerHTML = out.join('') || '<p class="muted" style="padding:6px 4px;font-size:13px">Nothing by that name. Try a species, a street (“600 Dolores”), or a neighborhood.</p>'
}
function updateFilterUI() {
  const f = M.filter, el = $('#bm-filterbox')
  if (!f) { el.classList.add('hidden'); return }
  el.classList.remove('hidden')
  $('#bm-filtername').innerHTML = f.kind === 'landmark' ? '★ Landmark trees' : `<span class="sw" style="background:${f.c}"></span>${esc(f.name)}`
}

// ---------------- minimap (heading-up) ----------------
export function drawMinimap() {
  const cv = $('#mm'); if (!cv) return
  const c = cv.getContext('2d'), Rr = cv.width / 2, w = D.world
  const span = P.mode === 'fly' ? 2400 : 700
  const z = cv.width / span
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.fillStyle = '#5f8c96'; c.fillRect(0, 0, cv.width, cv.height)
  c.save(); c.translate(Rr, Rr); c.rotate(P.yaw)
  if (S) {
    const px = (P.x - w.gx0) * S, py = (w.gy0 + H - P.y) * S
    const k = z / S
    c.scale(k, k); c.drawImage(img, -px, -py)
    c.setTransform(1, 0, 0, 1, 0, 0); c.translate(Rr, Rr); c.rotate(P.yaw)
  }
  forEachInRadius(P.x, P.y, span * 0.75, i => {
    const dx = T.px[i] - P.x, dy = -T.pz[i] - P.y
    const hi = (T.hiMask[D.trees.sp[i]] | T.hiTree[i]) === 1
    if (!hi && P.mode === 'fly') return
    c.fillStyle = hi ? '#ffbe3c' : `rgb(${T.col[i * 3] * 200 | 0},${T.col[i * 3 + 1] * 200 | 0},${T.col[i * 3 + 2] * 200 | 0})`
    c.beginPath(); c.arc(dx * z, -dy * z, hi ? 4.5 : Math.max(1.6, T.W[i] * z * 0.4), 0, 7); c.fill()
  })
  c.restore()
  arrow(c, Rr, Rr, 0, 13)
  const nEl = document.querySelector('.mm-n')
  if (nEl) { const f = 0.84 * 50; nEl.style.left = (50 + Math.sin(P.yaw) * f) + '%'; nEl.style.top = (50 - Math.cos(P.yaw) * f) + '%' }
}
