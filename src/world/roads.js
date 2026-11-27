import * as THREE from 'three'
import { D, heightAt, getBuf } from '../data.js'
import { U, COMMON } from '../shaders.js'
import { ENGINE } from '../gfx/engine.js'
import { roadMaterial } from '../gfx/materials.js'

// Road ribbons draped on terrain, streamed in 500 m chunks.
// Per-vertex attributes: aUV = (distance along, across -1..1), aKind (type index), aWidth.

const TYPES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street',
  'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'steps']
// kind -> [r,g,b, centreLine(0/1), surface(0 asphalt,1 dirt,2 stone)]
const STYLE = {
  motorway: [0.25, 0.245, 0.24, 2, 0], trunk: [0.26, 0.255, 0.25, 2, 0], primary: [0.27, 0.265, 0.26, 2, 0], secondary: [0.28, 0.275, 0.27, 1, 0],
  tertiary: [0.30, 0.295, 0.29, 1, 0], residential: [0.31, 0.305, 0.30, 0, 0], unclassified: [0.31, 0.305, 0.30, 0, 0],
  living_street: [0.36, 0.35, 0.34, 0, 0], service: [0.36, 0.35, 0.34, 0, 0], pedestrian: [0.58, 0.55, 0.50, 0, 2],
  track: [0.52, 0.45, 0.35, 0, 1], path: [0.60, 0.52, 0.40, 0, 1], footway: [0.62, 0.55, 0.43, 0, 1], cycleway: [0.40, 0.40, 0.41, 0, 0],
  steps: [0.62, 0.60, 0.56, 0, 2],
}
const SIDEWALK = { motorway: 0, trunk: 0, primary: 3.4, secondary: 3.2, tertiary: 3.0, residential: 2.8, unclassified: 2.6, living_street: 2.4 }

const vert = /* glsl */`
${COMMON}
attribute vec2 aUV; attribute vec3 aCol; attribute vec2 aFlags;
varying vec3 vW; varying vec2 vUV; varying vec3 vCol; varying vec2 vFlags;
void main(){ vW = (modelMatrix * vec4(position, 1.0)).xyz; vUV = aUV; vCol = aCol; vFlags = aFlags;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`
const frag = /* glsl */`
${COMMON}
varying vec3 vW; varying vec2 vUV; varying vec3 vCol; varying vec2 vFlags;
void main(){
  vec2 q = vec2(vW.x, -vW.z);
  float dist = length(vW - uCamPos);
  float near = 1.0 - smoothstep(30.0, 160.0, dist);
  float n1 = vnoise(q * 0.08), n2 = vnoise(q * 0.9), n3 = vnoise(q * 23.0) * 0.6 + hash12(floor(q * 40.0)) * 0.4;
  float mk = floor(vFlags.x / 1000.0), hw = max(mod(vFlags.x, 1000.0), 0.5);
  float am = abs(vUV.y) * hw;   // metres from centre line
  float a = abs(vUV.y);
  vec3 c = vCol;
  float surf = vFlags.y;
  if (surf < 0.5) {                  // asphalt
    c *= 0.86 + 0.22 * n1;
    c = mix(c, c * 1.22, smoothstep(0.55, 0.8, n2 * 0.7 + n1 * 0.3) * 0.5);          // patches
    c *= mix(1.0, 0.9 + 0.2 * n3, near);                                               // aggregate
    float wheel = smoothstep(0.18, 0.32, a) * (1.0 - smoothstep(0.42, 0.6, a));
    c *= 1.0 + wheel * 0.06;                                                           // polished wheel paths
    c = mix(c, c * 0.8, smoothstep(0.9, 1.0, a));                                      // gutter
    float fw = max(fwidth(am), 0.002);
    if (mk > 0.5) {
      float y1 = 1.0 - smoothstep(0.05, 0.05 + fw, abs(am - 0.12));                    // double yellow centre
      c = mix(c, vec3(0.74, 0.58, 0.20) * (0.85 + 0.15 * n3), y1 * (1.0 - smoothstep(60.0, 300.0, dist) * 0.5));
      if (mk > 1.5) {
        float lane = (1.0 - smoothstep(0.06, 0.06 + fw, abs(am - hw * 0.5))) * step(fract(vUV.x / 12.0), 0.3);
        c = mix(c, vec3(0.82), lane);
      }
    }
  } else if (surf < 1.5) {           // dirt / gravel trail
    c *= 0.85 + 0.25 * n2; c *= mix(1.0, 0.85 + 0.3 * n3, near);
    c = mix(c, c * 0.85, smoothstep(0.6, 1.0, a));
  } else if (surf < 2.5) {           // pavers / steps
    c *= 0.9 + 0.15 * n2;
    if (fract(vUV.x / 0.6) < 0.06) c *= 0.75;
  } else {                           // concrete sidewalk with panel joints and a curb edge
    c *= 0.9 + 0.12 * n1; c *= mix(1.0, 0.92 + 0.14 * n3, near);
    float jw = fwidth(vUV.x / 1.6);
    float joint = 1.0 - smoothstep(0.0, max(jw * 1.5, 0.01), min(fract(vUV.x / 1.6), 1.0 - fract(vUV.x / 1.6)));
    c *= 1.0 - joint * 0.22 * (1.0 - smoothstep(40.0, 200.0, dist));
    c = mix(c, c * 1.12, smoothstep(0.85, 0.97, 1.0 - a));                           // curb lip
  }
  vec3 n = vec3(0.0, 1.0, 0.0);
  float sh = shadowAt(vW, n);
  vec3 col = lightIt(lin(c), n, 0.95, sh);
  gl_FragColor = vec4(finish(fogIt(col, vW)), 1.0);
}`

let material, scene, pack
const chunks = new Map(), loading = new Set()
let available

export function initRoads(sc) {
  scene = sc
  available = new Map(D.roadIndex.chunks.map(([a, b, o, n]) => [a + '_' + b, [o, n]]))
  pack = getBuf('data/roads.pack.gz.b64.txt')
  material = ENGINE.gpu ? roadMaterial() : new THREE.ShaderMaterial({
    uniforms: U, vertexShader: vert, fragmentShader: frag,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
  })
}

function buildChunk(buf, cx, cy) {
  const dv = new DataView(buf)
  let o = 0
  const n = dv.getUint32(o, true); o += 4
  const ox = cx * 500, oy = cy * 500
  const P = [], UV = [], COL = [], FL = [], IDX = []
  let vcount = 0
  for (let r = 0; r < n; r++) {
    const t = dv.getUint8(o); const w = dv.getUint8(o + 1) / 4; const np = dv.getUint16(o + 2, true); o += 4
    const pts = []
    for (let k = 0; k < np; k++) { pts.push([ox + dv.getInt16(o, true) / 10, oy + dv.getInt16(o + 2, true) / 10]); o += 4 }
    const kind = TYPES[t], st = STYLE[kind]
    // resample every <= 6 m so the ribbon follows the hills
    const rs = [pts[0]]
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]
      const L = Math.hypot(x1 - x0, y1 - y0), m = Math.max(1, Math.ceil(L / 6))
      for (let s = 1; s <= m; s++) rs.push([x0 + (x1 - x0) * s / m, y0 + (y1 - y0) * s / m])
    }
    const half = Math.max(0.9, w * 0.5)
    const lift = 0.22 + Math.min(0.25, half * 0.02)
    const sw = SIDEWALK[kind] || 0
    if (sw > 0) {
      // concrete sidewalks either side, drawn just beneath the asphalt so junctions stay clean
      for (const side of [-1, 1]) {
        const b0 = vcount; let dd = 0
        for (let k = 0; k < rs.length; k++) {
          const [x, y] = rs[k]
          const p = rs[Math.max(0, k - 1)], q = rs[Math.min(rs.length - 1, k + 1)]
          let tx = q[0] - p[0], ty = q[1] - p[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
          const nx = -ty * side, ny = tx * side
          if (k > 0) dd += Math.hypot(x - rs[k - 1][0], y - rs[k - 1][1])
          for (const [off, v] of [[half - 0.3, 1], [half + sw, 0]]) {
            const vx = x + nx * off, vy = y + ny * off
            P.push(vx, heightAt(vx, vy) + lift - 0.09, -vy); UV.push(dd, v); COL.push(0.58, 0.57, 0.54); FL.push(0, 3)
          }
          if (k > 0) { const a = b0 + (k - 1) * 2; IDX.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
        }
        vcount += rs.length * 2
      }
    }
    let dist = 0
    const base = vcount
    for (let k = 0; k < rs.length; k++) {
      const [x, y] = rs[k]
      const p = rs[Math.max(0, k - 1)], q = rs[Math.min(rs.length - 1, k + 1)]
      let tx = q[0] - p[0], ty = q[1] - p[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
      const nx = -ty, ny = tx
      if (k > 0) dist += Math.hypot(x - rs[k - 1][0], y - rs[k - 1][1])
      for (const side of [-1, 1]) {
        const vx = x + nx * half * side, vy = y + ny * half * side
        P.push(vx, heightAt(vx, vy) + lift, -vy)
        UV.push(dist, side); COL.push(st[0], st[1], st[2]); FL.push((w >= 11 ? st[3] : 0) * 1000 + half, st[4])
      }
      if (k > 0) { const a = base + (k - 1) * 2; IDX.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
    vcount += rs.length * 2
    // round-ish caps at both ends so junctions knit together
    for (const end of [0, rs.length - 1]) {
      const [x, y] = rs[end]; const c0 = vcount
      P.push(x, heightAt(x, y) + lift, -y); UV.push(dist * (end ? 1 : 0), 0); COL.push(st[0], st[1], st[2]); FL.push(0, st[4])
      const seg = 8
      for (let s = 0; s <= seg; s++) {
        const a = s / seg * Math.PI * 2, vx = x + Math.cos(a) * half * 0.98, vy = y + Math.sin(a) * half * 0.98
        P.push(vx, heightAt(vx, vy) + lift, -vy); UV.push(dist * (end ? 1 : 0), 0.9); COL.push(st[0], st[1], st[2]); FL.push(0, st[4])
      }
      for (let s = 0; s < seg; s++) IDX.push(c0, c0 + 1 + s + 1, c0 + 1 + s)
      vcount += seg + 2
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(UV, 2))
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(COL, 3))
  g.setAttribute('aFlags', new THREE.Float32BufferAttribute(FL, 2))
  g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1))
  g.computeBoundingSphere()
  return g
}

export function updateRoads(px, py, radius = 2) {
  const cx = Math.floor(px / 500), cy = Math.floor(py / 500)
  const want = new Set()
  for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) {
    const k = (cx + i) + '_' + (cy + j)
    if (!available.has(k)) continue
    want.add(k)
    if (!chunks.has(k) && !loading.has(k)) {
      loading.add(k)
      const [a, b] = [cx + i, cy + j]
      const [off, len] = available.get(k)
      pack.then(all => all.slice(off, off + len)).then(buf => {
        loading.delete(k)
        if (!want.has(k) && Math.max(Math.abs(a - Math.floor(lastX / 500)), Math.abs(b - Math.floor(lastY / 500))) > radius) return
        const m = new THREE.Mesh(buildChunk(buf, a, b), material)
        scene.add(m); chunks.set(k, m)
      }).catch(() => loading.delete(k))
    }
  }
  lastX = px; lastY = py
  for (const [k, m] of chunks) {
    const [a, b] = k.split('_').map(Number)
    if (Math.max(Math.abs(a - cx), Math.abs(b - cy)) > radius + 1) { scene.remove(m); m.geometry.dispose(); chunks.delete(k) }
  }
}
let lastX = 0, lastY = 0

export function roadPack() { return pack }
export const ROAD_TYPES = TYPES
