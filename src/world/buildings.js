import * as THREE from 'three'
import { D, heightAt, getBuf } from '../data.js'
import { U, COMMON } from '../shaders.js'
import { shadowScene } from './shadow.js'
import { ENGINE } from '../gfx/engine.js'
import { buildingMaterials } from '../gfx/materials.js'

// OpenStreetMap building footprints, extruded to their mapped (or inferred) heights.
// Walls get stucco colours from the city's palette and procedural windows; roofs are tar and gravel.

const vert = /* glsl */`
${COMMON}
attribute vec3 aWall;   // x: metres along the facade, y: metres above the base, z: 0 wall / 1 roof
attribute vec3 aCol;
attribute float aSeed;
varying vec3 vW; varying vec3 vN; varying vec3 vWall; varying vec3 vCol; varying float vSeed;
void main(){ vW = (modelMatrix * vec4(position, 1.0)).xyz; vN = normal; vWall = aWall; vCol = aCol; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`
const frag = /* glsl */`
${COMMON}
varying vec3 vW; varying vec3 vN; varying vec3 vWall; varying vec3 vCol; varying float vSeed;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(uCamPos - vW);
  if (dot(n, v) < 0.0) n = -n;
  float dist = length(vW - uCamPos);
  vec2 q = vec2(vW.x, -vW.z);
  vec3 alb; float glass = 0.0;
  if (vWall.z > 0.5) {
    alb = vCol * (0.85 + 0.25 * vnoise(q * 0.7)) * (0.9 + 0.15 * vnoise(q * 6.0));
  } else {
    float stucco = vnoise(vec2(vWall.x, vWall.y) * 1.7) * 0.5 + vnoise(vec2(vWall.x, vWall.y) * 9.0) * 0.5;
    alb = vCol * (0.9 + 0.12 * stucco) * (0.96 + 0.06 * vnoise(vec2(vWall.x * 0.15, vWall.y * 0.3)));
    float aaf = 1.0 - smoothstep(150.0, 480.0, dist);
    // windows: storeys every 3.2 m, bays every 2.6-3.2 m; 1.1 m x 1.6 m panes with frames and sills
    float fy = vWall.y - 0.6, ly = fract(fy / 3.2) * 3.2;
    float bay = 2.6 + 0.6 * fract(vSeed * 7.3);
    float lx = (fract(vWall.x / bay + vSeed) - 0.5) * bay;
    float ww = 0.55 + 0.15 * fract(vSeed * 3.1);
    float inX = step(abs(lx), ww), inY = step(0.8, ly) * step(ly, 2.45);
    float frameX = step(abs(lx), ww + 0.09), frameY = step(0.72, ly) * step(ly, 2.53);
    float above = step(0.0, fy);
    float frame = frameX * frameY * (1.0 - inX * inY) * above * aaf;
    alb = mix(alb, vec3(0.93, 0.92, 0.88), frame * 0.85);                                   // painted trim
    float sill = step(abs(lx), ww + 0.16) * step(0.62, ly) * step(ly, 0.72) * above * aaf;
    alb = mix(alb, alb * 0.72, sill);
    glass = inX * inY * above * aaf;
    // mullion
    glass *= step(0.04, abs(lx));
    alb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.6, vWall.y));
  }
  float sh = shadowAt(vW, n);
  float ao = 0.75 + 0.25 * smoothstep(0.0, 4.0, vWall.y + vWall.z * 10.0);
  vec3 c = lightIt(lin(alb), n, ao, sh);
  if (glass > 0.0) {
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 inside = lin(vec3(0.10, 0.11, 0.12)) * (0.6 + 0.8 * hash12(floor(vec2(vWall.x / 2.7, vWall.y / 3.2)) + vSeed * 13.0));
    vec3 g = mix(inside, skyLin(reflect(-v, n)) * 0.8, fres * 0.85 + 0.12);
    g += lin(uSunColor) * uSunI * pow(max(dot(reflect(-uSunDir, n), v), 0.0), 300.0) * 3.0 * sh;
    c = mix(c, g, glass);
  }
  gl_FragColor = vec4(finish(fogIt(c, vW)), 1.0);
}`
const depthFrag = 'void main(){ gl_FragColor = vec4(1.0); }'

// San Francisco stucco palette (muted pastels, whites, greys)
const WALLS = ['#e9e4d8', '#e3d8c2', '#d9cfba', '#e6d9b0', '#c9d3d6', '#bfcbc2', '#dccbc2', '#c9c4bb', '#ebe6dd', '#d6c3a8', '#b9c2c9', '#e1d2a3', '#d3d6cf', '#c8b9a4']
const ROOFS = ['#5d5a57', '#6b6862', '#4f4d4b', '#77726a', '#5a5550']
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }

let material, depthMat, scene, pack = null, index = null
const chunks = new Map()
const polys = new Map() // chunk key -> [{x0,y0,x1,y1, xs, ys}] for collision
export const BLD = { on: true, radius: 2 }

export function initBuildings(sc) {
  scene = sc
  if (ENGINE.gpu) { const b = buildingMaterials(); material = b.material; depthMat = b.depth } else {
    material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide })
    depthMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: depthFrag, side: THREE.DoubleSide })
  }
  fetch('data/buildings.json').then(r => r.json()).then(ix => { index = new Map(ix.map(([a, b, o, n]) => [a + '_' + b, [o, n]])) })
  getBuf('data/buildings.pack.gz.b64.txt').then(b => { pack = b; lastKey = '' })
}

function build(buf, cx, cy) {
  const dv = new DataView(buf); let o = 0
  const n = dv.getUint32(o, true); o += 4
  const ox = cx * 500, oy = cy * 500
  const P = [], N = [], WL = [], C = [], SD = [], col = []
  for (let b = 0; b < n; b++) {
    const nv = dv.getUint16(o, true), h = dv.getUint16(o + 2, true) / 10; o += 5
    const pts = []
    for (let k = 0; k < nv; k++) { pts.push(new THREE.Vector2(ox + dv.getInt16(o, true) / 10, oy + dv.getInt16(o + 2, true) / 10)); o += 4 }
    if (nv < 3) continue
    let gmin = 1e9, gsum = 0
    for (const p of pts) { const g = heightAt(p.x, p.y); gmin = Math.min(gmin, g); gsum += g }
    if (gsum / nv < 0.3) continue // over water
    { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
      col.push({ x0, y0, x1, y1, xs: pts.map(p => p.x), ys: pts.map(p => p.y) }) }
    const base = gmin - 1.0, top = gsum / nv + Math.max(3, h)
    const seed = Math.abs(Math.sin(pts[0].x * 12.9898 + pts[0].y * 78.233) * 43758.5453) % 1
    const wc = hex(WALLS[(seed * WALLS.length) | 0]), rc = hex(ROOFS[((seed * 7.7) % 1 * ROOFS.length) | 0])
    // winding: make it counter-clockwise in (x, y)
    let area = 0; for (let k = 0; k < nv; k++) { const a = pts[k], c = pts[(k + 1) % nv]; area += a.x * c.y - c.x * a.y }
    if (area < 0) pts.reverse()
    let along = 0
    for (let k = 0; k < nv; k++) {
      const a = pts[k], c = pts[(k + 1) % nv]
      const len = a.distanceTo(c); if (len < 0.05) continue
      const nx = (c.y - a.y) / len, ny = -(c.x - a.x) / len // outward normal for CCW
      const quad = [[a, base, 0], [c, base, len], [c, top, len], [a, base, 0], [c, top, len], [a, top, 0]]
      for (const [p, y, u] of quad) {
        P.push(p.x, y, -p.y); N.push(nx, 0, -ny); WL.push(along + u, y - base - 1.0, 0); C.push(...wc); SD.push(seed)
      }
      along += len
    }
    // roof
    let tris
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []) } catch (e) { tris = [] }
    for (const t of tris) for (const k of t) { const p = pts[k]; P.push(p.x, top, -p.y); N.push(0, 1, 0); WL.push(0, 0, 1); C.push(...rc); SD.push(seed) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(WL, 3))
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(SD, 1))
  g.computeBoundingSphere()
  polys.set(cx + '_' + cy, col)
  return g
}

export function insideBuilding(x, y) {
  if (!BLD.on) return false
  const cx = Math.floor(x / 500), cy = Math.floor(y / 500)
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const L = polys.get((cx + i) + '_' + (cy + j)); if (!L) continue
    for (const b of L) {
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue
      let inside = false
      for (let k = 0, m = b.xs.length - 1; k < b.xs.length; m = k++) {
        if (((b.ys[k] > y) !== (b.ys[m] > y)) && (x < (b.xs[m] - b.xs[k]) * (y - b.ys[k]) / (b.ys[m] - b.ys[k]) + b.xs[k])) inside = !inside
      }
      if (inside) return true
    }
  }
  return false
}
export function freeSpot(x, y) {
  if (!insideBuilding(x, y)) return [x, y]
  for (let r = 2; r <= 80; r += 2) for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r
    if (!insideBuilding(tx, ty) && heightAt(tx, ty) > 0.4) return [tx, ty]
  }
  return [x, y]
}

let lastKey = ''
export function updateBuildings(px, py) {
  if (!pack || !index) return
  const r = BLD.on ? BLD.radius : -1
  const cx = Math.floor(px / 500), cy = Math.floor(py / 500)
  const key = cx + '_' + cy + '_' + r
  if (key === lastKey) return
  lastKey = key
  const want = new Set()
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const k = (cx + i) + '_' + (cy + j)
    if (!index.has(k)) continue
    want.add(k)
    if (!chunks.has(k)) {
      const [off, len] = index.get(k)
      const g = build(pack.slice(off, off + len), cx + i, cy + j)
      const m = new THREE.Mesh(g, material), s = new THREE.Mesh(g, depthMat); s.layers.enableAll()
      scene.add(m); shadowScene.add(s); chunks.set(k, { m, s })
    }
  }
  for (const [k, { m, s }] of chunks) if (!want.has(k)) { scene.remove(m); shadowScene.remove(s); m.geometry.dispose(); chunks.delete(k); polys.delete(k) }
}
// a one-triangle stand-in so the engine can compile the building shaders during loading
export function buildingWarmup(x, y, z) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, y, z, x + 1, y, z, x, y + 1, z]), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
  g.setAttribute('aWall', new THREE.BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(9).fill(0.8), 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(3), 1))
  const m = new THREE.Mesh(g, material); m.frustumCulled = false
  return m
}
export function setBuildings(on) { BLD.on = on; lastKey = '' }
export function buildingsReady() { return !!pack && !!index }
