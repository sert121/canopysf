import * as THREE from 'three'
import { D, heightAt } from '../data.js'
import { U, COMMON } from '../shaders.js'
import { MODELS, PALMS, MODEL_KEYS, modelFor } from './models.js'
import { growTree, growPalm, growRosette } from './treegen.js'
import { ENGINE } from '../gfx/engine.js'
import { initGpuTrees, refreshGpuTrees, refreshHighlights, GT } from '../gfx/gputrees.js'
import { resolve, seasonal } from '../info/index.js'
import { lookFor, LEAF } from '../info/looks.js'
import { makeAtlases } from './textures.js'
import { shadowScene } from './shadow.js'

export const T = {
  info: [],          // resolved info per species index
  model: null,       // Uint8 growth model per tree
  vari: null,        // Uint8 variant per tree
  TR: null,          // trunk radius (m) for collision / picking
  px: null, py: null, pz: null, H: null, W: null, rot: null, seed: null,
  col: null, trunk: null,
  grid: null, cellStart: null, cellSize: 100, ncx: 0, ncy: 0, gx0: 0, gy0: 0,
  hiMask: null, hiTree: null,
  month: new Date().getMonth() + 1,
  hiR: 100, nearR: 320, farR: 1150,
  leaf: null, bark: null, flw: null, state: null, looks: null,
}

const vert = /* glsl */`
${COMMON}
attribute float aPart; attribute float aShade;
attribute vec3 iPos; attribute vec3 iScale; attribute vec3 iColor; attribute vec3 iTrunk; attribute vec3 iMisc; attribute vec2 iTex; attribute vec3 iFlower;
varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec3 vTrunk; varying float vAO; varying float vHi; varying vec2 vUv; varying float vPart;
varying vec2 vTex; varying vec3 vFlower; varying float vState; varying float vSeed;
void main(){
  vec3 p = position;
  float c = cos(iScale.z), s = sin(iScale.z);
  float sway = 0.0;
  if (aPart > 0.5) {
    float ph = iMisc.x * 6.2831;
    sway = (sin(uTime * 1.05 + ph + p.y * 1.7) * 0.012 + sin(uTime * 2.9 + ph * 1.7 + p.x * 9.0) * 0.006) * smoothstep(0.2, 1.0, p.y);
  }
  vec3 sp = vec3(p.x * iScale.x, p.y * iScale.y, p.z * iScale.x);
  sp.x += sway * iScale.y; sp.z += sway * 0.5 * iScale.y;
  vec3 rp = vec3(c * sp.x - s * sp.z, sp.y, s * sp.x + c * sp.z);
  vW = iPos + rp;
  vec3 n = normalize(vec3(normal.x / iScale.x, normal.y / iScale.y, normal.z / iScale.x));
  vN = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
  vCol = iColor; vTrunk = iTrunk; vAO = aShade; vHi = iMisc.y; vState = iMisc.z; vSeed = iMisc.x;
  vUv = uv; vPart = aPart; vTex = iTex; vFlower = iFlower;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`
const frag = /* glsl */`
${COMMON}
uniform sampler2D uLeaf; uniform sampler2D uBark;
varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec3 vTrunk; varying float vAO; varying float vHi; varying vec2 vUv; varying float vPart;
varying vec2 vTex; varying vec3 vFlower; varying float vState; varying float vSeed;
vec2 tileUV(float t, vec2 uv){
  vec2 cell = vec2(mod(t, 4.0), floor(t / 4.0 + 0.001));
  return vec2((cell.x + 0.025 + uv.x * 0.95) / 4.0, 1.0 - (cell.y + 0.025 + (1.0 - uv.y) * 0.95) / 4.0);
}
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(uCamPos - vW);
  bool leaf = vPart > 0.5;
  bool core = vPart > 1.5;
  if (core && (vState > 1.5 || dot(n, v) < 0.0)) discard;
  // ragged silhouette for the inner foliage mass: never a smooth ball edge
  if (core && abs(dot(n, v)) < 0.28 + 0.42 * vnoise(vW.xz * 2.7 + vW.y * 3.1)) discard;
  if (!leaf && dot(n, v) < 0.0) n = -n;
  vec3 alb; float spec = 0.0; float trans = 0.0;
  if (!leaf) {
    if (vUv.x >= 0.0) {
      float bf = abs(vTex.y - 6.0) < 0.5 ? 3.0 : 1.0;
      vec2 buv = vec2(fract(vUv.x * 2.0 * bf), fract(vUv.y * 0.5 * bf));
      float b = texture2D(uBark, tileUV(vTex.y, buv)).r;
      float bx = texture2D(uBark, tileUV(vTex.y, buv + vec2(0.004, 0.0))).r - b;
      // fake bump from the bark pattern
      vec3 t = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + 1e-4);
      n = normalize(n - t * bx * 3.0);
      alb = lin(vTrunk) * (0.3 + 0.8 * b) * 0.45;
    } else alb = lin(vTrunk) * 0.45;
  } else if (core) {
    // inner foliage mass: deep, self-shadowed leaves seen through the gaps between clusters
    float nz = vnoise(vW.xz * 1.9 + vW.y * 2.3 + vSeed * 17.0) * 0.6 + vnoise(vW.xz * 5.3 - vW.y * 4.1) * 0.4;
    // leaf texture projected onto the mass so it reads as more foliage, not a smooth ball
    vec4 ct = texture2D(uLeaf, tileUV(vTex.x, fract(vec2(vW.x * 0.45 + vW.z * 0.31, vW.y * 0.45 - vW.z * 0.2))));
    float leafy = mix(0.35, 0.55 + 0.6 * ct.r, ct.a);
    alb = lin(vCol) * (0.5 + 0.4 * nz) * leafy * mix(0.6, 1.0, vAO) * 0.85;
    if (vState > 0.5 && vState < 1.5) alb = mix(alb, lin(vFlower) * 0.6, step(0.6, nz) * 0.6);
    trans = 0.35;
  } else if (vUv.x >= 0.0) {
    vec4 tx = texture2D(uLeaf, tileUV(vTex.x, vUv));
    if (tx.a < 0.4) discard;
    if (vState > 1.5 && vnoise(vW.xz * 0.9 + vW.y * 1.3 + vSeed * 40.0) < 0.82) discard;
    vec3 hue = mix(vec3(0.86, 1.04, 0.80), vec3(1.10, 0.98, 1.02), tx.b);
    alb = lin(vCol) * (0.3 + 0.85 * tx.r) * hue * mix(0.5, 1.0, vAO) * 0.78;
    if (vState > 0.5 && vState < 1.5 && tx.g > 0.5) alb = lin(vFlower) * (0.55 + 0.6 * tx.r);
    if (vState > 1.5) alb = mix(alb, lin(vTrunk), 0.4);
    spec = 0.03 + 0.05 * tx.r; trans = 1.0;
  } else {
    alb = lin(vCol) * 0.62; trans = 0.6;
    if (vState > 0.5 && vState < 1.5) alb = mix(alb, lin(vFlower), 0.5);
  }
  float sh = shadowAt(vW, leaf ? uSunDir : n);
  if (core) sh = 0.35 + 0.65 * sh;  // light leaks through the outer leaves
  vec3 c = lightIt(alb, n, core ? max(vAO, 0.75) : vAO, sh);
  if (leaf) {
    // light transmitted through thin leaves when backlit, and a soft sheen
    float back = pow(max(dot(-v, uSunDir), 0.0), 3.0);
    c += alb * lin(uSunColor) * uSunI * back * 0.32 * trans * (0.25 + 0.75 * sh);
    vec3 h = normalize(uSunDir + v);
    c += lin(uSunColor) * uSunI * spec * pow(max(dot(n, h), 0.0), 40.0) * sh;
  }
  c = fogIt(c, vW);
  if (vHi > 0.5) {
    float pulse = 0.55 + 0.45 * sin(uTime * 3.0);
    c = mix(c, vec3(1.0, 0.75, 0.25) * 1.6, 0.25 + 0.2 * pulse);
  }
  gl_FragColor = vec4(finish(c), 1.0);
}`
const depthFrag = /* glsl */`
uniform sampler2D uLeaf;
varying vec2 vUv; varying float vPart; varying vec2 vTex; varying float vState; varying vec3 vW; varying float vSeed;
${'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }'}
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
void main(){
  if (vPart > 1.5 && vState > 1.5) discard;
  if (vPart > 0.5 && vPart < 1.5 && vUv.x >= 0.0) {
    vec2 cell = vec2(mod(vTex.x, 4.0), floor(vTex.x / 4.0 + 0.001));
    vec2 uv = vec2((cell.x + 0.025 + vUv.x * 0.95) / 4.0, 1.0 - (cell.y + 0.025 + (1.0 - vUv.y) * 0.95) / 4.0);
    if (texture2D(uLeaf, uv).a < 0.4) discard;
    if (vState > 1.5 && vn(vW.xz * 0.9 + vW.y * 1.3 + vSeed * 40.0) < 0.82) discard;
  }
  gl_FragColor = vec4(1.0);
}`

const groups = [] // per model: { hi: [L x VAR], mid: [L x VAR], lo: [L] }, L = {mesh, smesh, geo, cap, base}
const VAR = 3
const LODS = ['hi', 'mid', 'lo']
const LODLEVEL = { hi: 2, mid: 1, lo: 0 }
let material, depthMat, scene
export const MINFO = [] // per model: { ratio, corr: {hi, mid, lo}, pick: [centreFrac, halfFrac], trunk }

function makeInst(base, cap) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of ['position', 'normal', 'uv', 'aPart', 'aShade']) g.setAttribute(k, base.attributes[k])
  g.setIndex(base.index)
  const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a }
  g.setAttribute('iPos', mk(3)); g.setAttribute('iScale', mk(3)); g.setAttribute('iColor', mk(3)); g.setAttribute('iTrunk', mk(3)); g.setAttribute('iMisc', mk(3)); g.setAttribute('iTex', mk(2)); g.setAttribute('iFlower', mk(3))
  g.instanceCount = 0
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)
  return g
}

// a geometry drawing `base` with the instance attributes of `inst` (cheap shadow casters for mid-distance trees)
function shadowGeo(base, inst) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of ['position', 'normal', 'uv', 'aPart', 'aShade']) g.setAttribute(k, base.attributes[k])
  g.setIndex(base.index)
  for (const k of ['iPos', 'iScale', 'iColor', 'iTrunk', 'iMisc', 'iTex', 'iFlower']) g.setAttribute(k, inst.attributes[k])
  g.instanceCount = 0
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)
  return g
}

export function grow(key, seed, level) {
  const d = MODELS[key] || PALMS[key]
  return (d.palm ? growPalm : d.rosette ? growRosette : growTree)(d, seed, level)
}

function measure(geo) {
  const p = geo.attributes.position, part = geo.attributes.aPart
  let y0 = 1e9, y1 = -1e9, tr = 0
  for (let k = 0; k < p.count; k++) {
    if (part.getX(k) > 0.5) { y0 = Math.min(y0, p.getY(k)); y1 = Math.max(y1, p.getY(k)) }
    else if (p.getY(k) < 0.02) tr = Math.max(tr, Math.hypot(p.getX(k), p.getZ(k)))
  }
  if (y0 > y1) { y0 = 0.5; y1 = 1 }
  return { pick: [(y0 + y1) / 2, Math.max(0.08, (y1 - y0) / 2)], trunk: tr }
}

export function initTrees(sc, renderer, at) {
  scene = sc
  T.atlas = at
  const gpu = ENGINE.gpu
  if (!gpu) {
    material = new THREE.ShaderMaterial({ uniforms: { ...U, uLeaf: { value: at.leaf }, uBark: { value: at.bark } }, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide })
    depthMat = new THREE.ShaderMaterial({ uniforms: { ...U, uLeaf: { value: at.leaf } }, vertexShader: vert, fragmentShader: depthFrag, side: THREE.DoubleSide })
    T.material = material; T.depthMat = depthMat; material.userData.scene = sc
  }
  for (let m = 0; m < MODEL_KEYS.length; m++) {
    const key = MODEL_KEYS[m]
    const gr = {}, ratios = {}
    for (const lod of LODS) {
      gr[lod] = []
      const nv = lod === 'lo' ? 1 : VAR
      let rs = 0
      for (let v = 0; v < nv; v++) {
        const r = grow(key, v + 1, LODLEVEL[lod])
        rs += r.ratio
        if (lod === 'hi' && v === 0) Object.assign(ratios, measure(r.geo))
        if (gpu) { gr[lod].push({ base: r.geo, tris: r.tris, n: 0 }); continue }
        const cap = lod === 'hi' ? 32 : lod === 'mid' ? 128 : 512
        const geo = makeInst(r.geo, cap)
        const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false; mesh.visible = false
        scene.add(mesh)
        let smesh = null
        if (lod !== 'lo') { smesh = new THREE.Mesh(geo, depthMat); smesh.frustumCulled = false; smesh.visible = false; shadowScene.add(smesh) }
        gr[lod].push({ mesh, smesh, geo, cap, base: r.geo, tris: r.tris, sbase: lod === 'mid' ? grow(key, 1, 0).geo : null })
        { const L = gr[lod][gr[lod].length - 1]; if (L.sbase) L.smesh.geometry = shadowGeo(L.sbase, geo) }
      }
      ratios[lod] = rs / nv
    }
    MINFO.push({ key, ratio: ratios.hi, corr: { hi: 1, mid: Math.min(2, ratios.hi / ratios.mid), lo: Math.min(2.2, ratios.hi / ratios.lo) }, pick: ratios.pick, trunk: ratios.trunk })
    groups.push(gr)
  }
  // species info
  T.info = D.species.map(resolve)
  T.looks = T.info.map(lookFor)
  const spModel = T.info.map(inf => MODEL_KEYS.indexOf(modelFor(inf)))
  T.hiMask = new Uint8Array(D.species.length)
  T.hiTree = new Uint8Array(D.trees.n)
  const tr = D.trees, n = tr.n
  T.model = new Uint8Array(n); T.vari = new Uint8Array(n); T.px = new Float32Array(n); T.py = new Float32Array(n); T.pz = new Float32Array(n)
  T.H = new Float32Array(n); T.W = new Float32Array(n); T.SX = new Float32Array(n); T.TR = new Float32Array(n); T.rot = new Float32Array(n); T.seed = new Float32Array(n)
  T.col = new Float32Array(n * 3); T.trunk = new Float32Array(n * 3)
  T.leaf = new Uint8Array(n); T.bark = new Uint8Array(n); T.flw = new Float32Array(n * 3); T.state = new Uint8Array(n)
  let s = 12345
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  for (let i = 0; i < n; i++) {
    const info = T.info[tr.sp[i]]
    const x = tr.x[i] * 0.5, y = tr.y[i] * 0.5
    T.px[i] = x; T.pz[i] = -y; T.py[i] = heightAt(x, y) - 0.15
    const m = Math.max(0, spModel[tr.sp[i]])
    T.model[i] = m
    const d = tr.dbh[i]
    const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd()
    T.vari[i] = Math.min(VAR - 1, r4 * VAR | 0)
    const grow = d > 0 ? 0.32 + 0.68 * (1 - Math.exp(-d / 13)) + Math.max(0, d - 28) / 70 * 0.45 : 0.5 + 0.35 * r1
    let H = info.h * grow * (0.88 + 0.24 * r2)
    if (H < 2.2) H = 2.2 + r2
    T.H[i] = H
    // young trees are relatively narrower; old ones spread
    const age = Math.min(1.15, 0.8 + 0.35 * grow)
    T.SX[i] = H * age * (0.88 + 0.24 * r3)
    T.W[i] = Math.max(1.2, T.SX[i] * MINFO[m].ratio)
    T.TR[i] = Math.max(0.08, MINFO[m].trunk * T.SX[i])
    T.rot[i] = r1 * 6.2831
    T.seed[i] = r3
  }
  T.spArr = tr.sp
  recolor()
  buildGrid()
  if (gpu) initGpuTrees(sc, shadowScene, groups, MINFO, T, at, ENGINE.q.trees)
}

export function recolor() {
  const tr = D.trees
  const hex = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255] }
  const trunkCache = T.info.map(inf => hex(inf.t))
  for (let i = 0; i < tr.n; i++) {
    const info = T.info[tr.sp[i]]
    const se = seasonal(info, T.month, T.seed[i])
    const lk = T.looks[tr.sp[i]]
    T.bark[i] = lk.bark
    T.state[i] = se.bloom ? 1 : se.bare ? 2 : 0
    T.leaf[i] = se.bloom && lk.leaf !== LEAF.brush && lk.leaf !== LEAF.palmfan && lk.leaf !== LEAF.palmfeather && lk.leaf !== LEAF.strap ? LEAF.blossom : lk.leaf
    const fc = lk.flower ? hex(lk.flower) : [1, 1, 1]
    T.flw[i * 3] = fc[0]; T.flw[i * 3 + 1] = fc[1]; T.flw[i * 3 + 2] = fc[2]
    { // pull the palette toward natural foliage: a little less saturated, a little darker
      const [r, g, b] = se.color, l = 0.3 * r + 0.59 * g + 0.11 * b, k = se.bloom ? 0.9 : 0.8
      T.col[i * 3] = (l + (r - l) * k) * 0.9; T.col[i * 3 + 1] = (l + (g - l) * k) * 0.9; T.col[i * 3 + 2] = (l + (b - l) * k) * 0.9 }
    const tc = trunkCache[tr.sp[i]]
    T.trunk[i * 3] = tc[0]; T.trunk[i * 3 + 1] = tc[1]; T.trunk[i * 3 + 2] = tc[2]
  }
  lastX = 1e9
  if (ENGINE.gpu && GT.ready) refreshGpuTrees(T)
}

function buildGrid() {
  const w = D.world, cs = T.cellSize
  T.gx0 = w.gx0; T.gy0 = w.gy0
  T.ncx = Math.ceil(w.gnx * w.gres / cs); T.ncy = Math.ceil(w.gny * w.gres / cs)
  const n = D.trees.n, nc = T.ncx * T.ncy
  const cell = new Int32Array(n), cnt = new Int32Array(nc + 1)
  for (let i = 0; i < n; i++) {
    const cx = Math.min(T.ncx - 1, Math.max(0, Math.floor((T.px[i] - w.gx0) / cs)))
    const cy = Math.min(T.ncy - 1, Math.max(0, Math.floor((-T.pz[i] - w.gy0) / cs)))
    cell[i] = cy * T.ncx + cx; cnt[cell[i] + 1]++
  }
  for (let c = 0; c < nc; c++) cnt[c + 1] += cnt[c]
  const fill = cnt.slice(0, nc), list = new Int32Array(n)
  for (let i = 0; i < n; i++) list[fill[cell[i]]++] = i
  T.grid = list; T.cellStart = cnt
}

export function forEachInRadius(x, y, r, fn) {
  const cs = T.cellSize
  const c0 = Math.max(0, Math.floor((x - r - T.gx0) / cs)), c1 = Math.min(T.ncx - 1, Math.floor((x + r - T.gx0) / cs))
  const r0 = Math.max(0, Math.floor((y - r - T.gy0) / cs)), r1 = Math.min(T.ncy - 1, Math.floor((y + r - T.gy0) / cs))
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const c = cy * T.ncx + cx
    for (let k = T.cellStart[c]; k < T.cellStart[c + 1]; k++) fn(T.grid[k])
  }
}

let lastX = 1e9, lastY = 1e9
function ensureCap(L, need) {
  if (need <= L.cap) return
  let cap = L.cap; while (cap < need) cap *= 2
  const geo = makeInst(L.base, cap)
  L.mesh.geometry.dispose(); L.mesh.geometry = geo; L.geo = geo; L.cap = cap
  if (L.smesh) L.smesh.geometry = L.sbase ? shadowGeo(L.sbase, geo) : geo
}

export function updateTrees(x, y, force = false) {
  if (ENGINE.gpu) return
  if (!force && Math.hypot(x - lastX, y - lastY) < 15) return
  lastX = x; lastY = y
  const hr2 = T.hiR * T.hiR, nr2 = T.nearR * T.nearR, fr2 = T.farR * T.farR
  const sel = []
  for (const gr of groups) for (const lod of LODS) for (const L of gr[lod]) L.n = 0
  forEachInRadius(x, y, T.farR, i => {
    const dx = T.px[i] - x, dy = -T.pz[i] - y, d2 = dx * dx + dy * dy
    if (d2 > fr2) return
    const li = d2 < hr2 ? 0 : d2 < nr2 ? 1 : 2
    const L = groups[T.model[i]][LODS[li]][li === 2 ? 0 : T.vari[i]]
    L.n++
    sel.push(i * 4 + li)
  })
  for (const gr of groups) for (const lod of LODS) for (const L of gr[lod]) { ensureCap(L, L.n); L.k = 0 }
  const sp = D.trees.sp, hm = T.hiMask, ht = T.hiTree
  for (const v of sel) {
    const i = v >> 2, li = v & 3, m = T.model[i], lod = LODS[li]
    const L = groups[m][lod][li === 2 ? 0 : T.vari[i]], k = L.k++
    const at = L.geo.attributes
    at.iPos.array[k * 3] = T.px[i]; at.iPos.array[k * 3 + 1] = T.py[i]; at.iPos.array[k * 3 + 2] = T.pz[i]
    at.iScale.array[k * 3] = T.SX[i] * MINFO[m].corr[lod]; at.iScale.array[k * 3 + 1] = T.H[i]; at.iScale.array[k * 3 + 2] = T.rot[i]
    at.iColor.array[k * 3] = T.col[i * 3]; at.iColor.array[k * 3 + 1] = T.col[i * 3 + 1]; at.iColor.array[k * 3 + 2] = T.col[i * 3 + 2]
    at.iTrunk.array[k * 3] = T.trunk[i * 3]; at.iTrunk.array[k * 3 + 1] = T.trunk[i * 3 + 1]; at.iTrunk.array[k * 3 + 2] = T.trunk[i * 3 + 2]
    at.iMisc.array[k * 3] = T.seed[i]; at.iMisc.array[k * 3 + 1] = hm[sp[i]] | ht[i]; at.iMisc.array[k * 3 + 2] = T.state[i]
    at.iTex.array[k * 2] = T.leaf[i]; at.iTex.array[k * 2 + 1] = T.bark[i]
    at.iFlower.array[k * 3] = T.flw[i * 3]; at.iFlower.array[k * 3 + 1] = T.flw[i * 3 + 1]; at.iFlower.array[k * 3 + 2] = T.flw[i * 3 + 2]
  }
  for (const gr of groups) for (const lod of LODS) for (const L of gr[lod]) {
    L.geo.instanceCount = L.n
    if (L.smesh && L.smesh.geometry !== L.geo) L.smesh.geometry.instanceCount = L.n
    L.mesh.visible = L.n > 0; if (L.smesh) L.smesh.visible = L.n > 0
    if (!L.n) continue
    for (const k of ['iPos', 'iScale', 'iColor', 'iTrunk', 'iMisc', 'iTex', 'iFlower']) {
      const at = L.geo.attributes[k]; at.needsUpdate = true
      at.clearUpdateRanges(); at.addUpdateRange(0, L.n * at.itemSize)
    }
  }
}

export function setHighlight(list) { T.hiMask.fill(0); T.hiTree.fill(0); for (const s of list || []) T.hiMask[s] = 1; lastX = 1e9; if (ENGINE.gpu) refreshHighlights(T) }
export function setTreeHighlight(flagBit) { T.hiMask.fill(0); T.hiTree.fill(0); const f = D.trees.flags; for (let i = 0; i < f.length; i++) if (f[i] & flagBit) T.hiTree[i] = 1; lastX = 1e9; if (ENGINE.gpu) refreshHighlights(T) }
export function setDistances(nearR, farR, hiR) { T.nearR = nearR; T.farR = farR; if (hiR) T.hiR = hiR; lastX = 1e9 }
export function setMonth(m) { T.month = m; recolor() }

// Ray pick: returns {i, t} of the nearest tree hit along the ray (three-space origin/dir)
const _o = new THREE.Vector3(), _d = new THREE.Vector3()
export function pick(origin, dir, maxDist = 160) {
  let best = -1, bestT = maxDist
  const seen = new Set()
  for (let s = 0; s <= maxDist; s += 30) {
    const qx = origin.x + dir.x * s, qy = -(origin.z + dir.z * s)
    forEachInRadius(qx, qy, 40, i => {
      if (seen.has(i)) return; seen.add(i)
      const H = T.H[i], W = T.W[i]
      const pk = MINFO[T.model[i]].pick
      // canopy ellipsoid
      const cx = T.px[i], cy = T.py[i] + H * pk[0], cz = T.pz[i]
      const rx = W * 0.5, ry = Math.max(H * pk[1], 0.8)
      const ox = (origin.x - cx) / rx, oy = (origin.y - cy) / ry, oz = (origin.z - cz) / rx
      const dx = dir.x / rx, dy = dir.y / ry, dz = dir.z / rx
      const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1
      const disc = B * B - 4 * A * C
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / (2 * A)
        if (t > 0.3 && t < bestT) { bestT = t; best = i }
      }
      // trunk (vertical cylinder)
      const tr = Math.max(0.3, T.TR[i] * 1.2)
      const fx = origin.x - T.px[i], fz = origin.z - T.pz[i]
      const a2 = dir.x * dir.x + dir.z * dir.z
      if (a2 > 1e-6) {
        const b2 = 2 * (fx * dir.x + fz * dir.z), c2 = fx * fx + fz * fz - tr * tr
        const d2 = b2 * b2 - 4 * a2 * c2
        if (d2 >= 0) {
          const t = (-b2 - Math.sqrt(d2)) / (2 * a2)
          const yy = origin.y + dir.y * t
          if (t > 0.3 && t < bestT && yy > T.py[i] && yy < T.py[i] + H * (pk[0] - pk[1] * 0.5)) { bestT = t; best = i }
        }
      }
    })
  }
  return best >= 0 ? { i: best, t: bestT } : null
}

export function treeStats() {
  let hi = 0, lo = 0, tris = 0, calls = 0
  for (const g of groups) for (const lod of LODS) for (const L of g[lod]) {
    if (lod === 'lo') lo += L.n || 0; else hi += L.n || 0
    tris += (L.n || 0) * L.tris; if (L.n) calls++
  }
  return { hi, lo, tris, calls }
}

// Canopy cover painted at 4 m, used by the ground shader beyond the 3D tree range (like aerial imagery)
export function buildCanopyTexture() {
  const w = D.world, cv = document.createElement('canvas')
  cv.width = w.mnx; cv.height = w.mny
  const c = cv.getContext('2d')
  const n = D.trees.n
  for (let i = 0; i < n; i++) {
    const x = (T.px[i] - w.mx0) / w.mres, y = (w.mny - 1) - (-T.pz[i] - w.my0) / w.mres
    const r = Math.max(0.9, T.W[i] * 0.5 / w.mres)
    const k = i * 3
    c.fillStyle = `rgba(${T.col[k] * 255 | 0},${T.col[k + 1] * 255 | 0},${T.col[k + 2] * 255 | 0},0.92)`
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true
  return tex
}
