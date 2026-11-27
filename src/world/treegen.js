import * as THREE from 'three'

// Procedural tree generator in the Weber & Penn tradition, extended for San Francisco's street trees:
// crown-envelope shapes, multi-stem trunks, tropism (upward/weeping), gnarl, phyllotaxis, flat cypress pads,
// palms and branching rosettes. Output is normalised to height 1; the crown width/height ratio is returned.
//
// Geometry attributes: position, normal, uv, aPart (0 wood, 1 leaf card, 2 crown core), aShade (occlusion 0..1)

class RNG {
  constructor(seed) { this.s = (seed * 9301 + 49297) % 233280 || 1 }
  r() { this.s = (this.s * 16807) % 2147483647; return (this.s - 1) / 2147483646 }
  range(a, b) { return a + (b - a) * this.r() }
}

const UP = new THREE.Vector3(0, 1, 0)
const SHAPES = {
  conical: r => 0.2 + 0.8 * r,
  spherical: r => 0.2 + 0.8 * Math.sin(Math.PI * r),
  hemispherical: r => 0.2 + 0.8 * Math.sin(0.5 * Math.PI * r),
  cylindrical: () => 1,
  tapered: r => 0.5 + 0.5 * r,
  flame: r => r <= 0.7 ? r / 0.7 : (1 - r) / 0.3,
  inverse: r => 1 - 0.8 * r,
  tendflame: r => r <= 0.7 ? 0.5 + 0.5 * r / 0.7 : 0.5 + 0.5 * (1 - r) / 0.3,
  oval: r => 0.25 + 0.75 * Math.pow(Math.sin(Math.PI * Math.pow(r, 0.8)), 0.8),
}

function perpendicular(v) {
  const a = Math.abs(v.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  return new THREE.Vector3().crossVectors(v, a).normalize()
}

class Builder {
  constructor() { this.P = []; this.N = []; this.UV = []; this.PART = []; this.SH = []; this.I = [] }
  get count() { return this.P.length / 3 }
  v(p, n, u, v, part, sh) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.UV.push(u, v); this.PART.push(part); this.SH.push(sh) }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2))
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.PART, 1))
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.SH, 1))
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1))
    return g
  }
}

// tube along a polyline with parallel-transported frames
function tube(B, pts, radii, segs, vScale, shadeFn) {
  const base = B.count
  let n0 = perpendicular(pts.length > 1 ? pts[1].clone().sub(pts[0]).normalize() : UP)
  let along = 0
  for (let i = 0; i < pts.length; i++) {
    const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize()
    if (i > 0) along += pts[i].distanceTo(pts[i - 1])
    // parallel transport
    const b = new THREE.Vector3().crossVectors(t, n0).normalize()
    n0 = new THREE.Vector3().crossVectors(b, t).normalize()
    for (let s = 0; s <= segs; s++) {
      const a = s / segs * Math.PI * 2
      const dir = n0.clone().multiplyScalar(Math.cos(a)).add(b.clone().multiplyScalar(Math.sin(a)))
      const p = pts[i].clone().addScaledVector(dir, radii[i])
      B.v(p, dir, s / segs, along * vScale, 0, shadeFn(pts[i].y))
    }
  }
  const row = segs + 1
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < segs; s++) {
    const a = base + i * row + s, b = a + 1, c = a + row, d = c + 1
    B.I.push(a, c, b, b, c, d)
  }
}

// leaf card: centre p, long axis `up`, facing `n`, width w, length l; uv (0..1) with stem at v=0
function card(B, p, up, n, w, l, centre, radius, aspect = 1) {
  const right = new THREE.Vector3().crossVectors(up, n).normalize()
  const base = B.count
  const W = w * aspect
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]
  for (const [cx, cy] of corners) {
    const q = p.clone().addScaledVector(right, cx * W).addScaledVector(up, (cy - 0.15) * l)
    const out = q.clone().sub(centre); const d = out.length()
    const sn = out.normalize().lerp(n, 0.3).normalize()
    const sh = Math.min(1, 0.45 + 0.55 * (d / Math.max(radius, 1e-3)))
    B.v(q, sn, cx + 0.5, cy, 1, sh)
  }
  B.I.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function icosphere(B, centre, rad, detail, rng, noise, part = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail)
  const p = g.attributes.position
  const tmp = new Map()
  const base = B.count
  // dedupe vertices for a closed, smooth hull
  const idx = []
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`
    if (!tmp.has(k)) {
      const d = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize()
      const k2 = 1 + noise * (Math.sin(d.x * 7.1 + rng * 3) * Math.sin(d.y * 6.3 + rng) * Math.sin(d.z * 5.7 + rng * 2))
      const q = new THREE.Vector3(centre.x + d.x * rad.x * k2, centre.y + d.y * rad.y * k2, centre.z + d.z * rad.z * k2)
      tmp.set(k, B.count)
      B.v(q, d, -1, -1, part, 0.35 + 0.35 * Math.max(0, d.y))
    }
    idx.push(tmp.get(k))
  }
  for (let i = 0; i < idx.length; i += 3) B.I.push(idx[i], idx[i + 1], idx[i + 2])
}

// ------------------------------------------------------------------------------------------
// Branching trees
// def = {
//   stems, stemSpread, lean, trunk: {length, radius, flare, taper, gnarl, sections, segs, crownStart},
//   shape, levels: [{children, angle, angleVar, length, start, gnarl, force, taper, radius, sections, segs, droop}],
//   leaves: {count, size, aspect, start, angle, flat, droop, cluster, double}, core, coreScale, coreOffset }
export function growTree(def, seed, lod) {
  const rng = new RNG(seed * 7919 + (def.seedSalt || 0))
  const B = new Builder()
  const leafPts = []
  const maxLevel = lod === 2 ? def.levels.length : lod === 1 ? Math.max(1, def.levels.length - 1) : 1
  const segScale = lod === 2 ? 1 : lod === 1 ? 0.6 : 0.4
  const secScale = lod === 2 ? 1 : lod === 1 ? 0.6 : 0.35
  const tr = def.trunk
  const shapeFn = SHAPES[def.shape || 'spherical']
  const queue = []
  const trunkShade = y => Math.min(1, 0.55 + 0.45 * y / (tr.length * 0.6))

  // stems
  const stems = def.stems || 1
  for (let s = 0; s < stems; s++) {
    const a = s / stems * Math.PI * 2 + rng.range(-0.4, 0.4)
    const spread = stems > 1 ? (def.stemSpread || 0.35) * rng.range(0.7, 1.2) : 0
    const dir = new THREE.Vector3(Math.sin(spread) * Math.cos(a) + (def.lean || 0), Math.cos(spread), Math.sin(spread) * Math.sin(a)).normalize()
    queue.push({ origin: new THREE.Vector3(stems > 1 ? Math.cos(a) * tr.radius * 0.6 : 0, 0, stems > 1 ? Math.sin(a) * tr.radius * 0.6 : 0), dir, length: tr.length * (stems > 1 ? rng.range(0.85, 1.05) : 1), radius: tr.radius / Math.sqrt(stems), level: 0, parentT: 0 })
  }

  while (queue.length) {
    const br = queue.shift()
    const L = br.level === 0 ? tr : def.levels[br.level - 1]
    const nSec = Math.max(2, Math.round((L.sections || 6) * secScale))
    const segs = lod === 0 ? 4 : Math.max(3, Math.round((L.segs || 5) * segScale))
    const pts = [br.origin.clone()], radii = [br.radius * (br.level === 0 ? 1 + (tr.flare || 0.3) : 1)]
    let dir = br.dir.clone(), pos = br.origin.clone()
    const step = br.length / nSec
    const gn = L.gnarl ?? 0.1, force = L.force ?? 0
    const frames = [{ pos: pos.clone(), dir: dir.clone(), r: br.radius }]
    for (let i = 1; i <= nSec; i++) {
      const t = i / nSec
      dir.add(new THREE.Vector3(rng.range(-gn, gn), rng.range(-gn, gn) * 0.5, rng.range(-gn, gn)))
      dir.y += force * (br.level === 0 ? 0.3 : 1)
      if (L.droop) dir.y -= L.droop * t
      dir.normalize()
      pos = pos.clone().addScaledVector(dir, step)
      // limbs sweep down but never into the ground
      const floor = br.level === 0 ? 0 : tr.length * 0.12
      if (pos.y < floor) { pos.y = floor + (floor - pos.y) * 0.3; dir.y = Math.abs(dir.y) * 0.5 + 0.15; dir.normalize() }
      const taper = L.taper ?? 0.7
      const r = br.radius * Math.max(0.05, 1 - taper * t)
      const flare = br.level === 0 && t < 0.15 ? (tr.flare || 0.3) * (1 - t / 0.15) : 0
      pts.push(pos); radii.push(r * (1 + flare)); frames.push({ pos: pos.clone(), dir: dir.clone(), r })
    }
    if (lod > 0 || br.level === 0) tube(B, pts, radii, segs, 1.6 / Math.max(br.radius * 6, 0.05), br.level === 0 ? trunkShade : () => 0.85)

    const nextLevel = br.level + 1
    const isTerminal = nextLevel > maxLevel || nextLevel > def.levels.length
    if (!isTerminal) {
      const C = def.levels[nextLevel - 1]
      const start = br.level === 0 ? (tr.crownStart ?? 0.35) : (C.start ?? 0.2)
      const n = Math.max(1, Math.round(C.children * (br.level === 0 ? 1 : rng.range(0.75, 1.25))))
      let phase = rng.range(0, Math.PI * 2)
      for (let k = 0; k < n; k++) {
        const t = start + (1 - start) * ((k + rng.range(0.15, 0.85)) / n)
        const fi = Math.min(frames.length - 1, Math.floor(t * (frames.length - 1)))
        const f = frames[fi], f2 = frames[Math.min(frames.length - 1, fi + 1)]
        const a = (t * (frames.length - 1)) - fi
        const origin = f.pos.clone().lerp(f2.pos, a)
        const pdir = f.dir.clone().lerp(f2.dir, a).normalize()
        phase += 2.39996 + rng.range(-0.3, 0.3)       // golden-angle phyllotaxis
        const side = perpendicular(pdir).applyAxisAngle(pdir, phase)
        const ang = THREE.MathUtils.degToRad(C.angle + rng.range(-(C.angleVar || 10), C.angleVar || 10))
        const cdir = pdir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize()
        let len = C.length * br.length
        if (br.level === 0) len = C.length * tr.length * shapeFn(1 - (t - start) / (1 - start + 1e-6))
        len *= rng.range(0.8, 1.15)
        const rad = Math.max(0.002, f.r * (C.radius ?? 0.6) * (1 - (L.taper ?? 0.7) * t * 0.5))
        queue.push({ origin, dir: cdir, length: len, radius: rad, level: nextLevel, parentT: t })
      }
      // apex leader keeps going for conical / excurrent forms
    }
    if (isTerminal || (def.leaves.onAll && br.level >= 1)) {
      // foliage along this terminal branch
      const lf = def.leaves
      const scale = lod === 2 ? 1 : lod === 1 ? 1.75 : 2.6
      const cnt = Math.max(1, Math.round(lf.count * (lod === 2 ? 1.5 : lod === 1 ? 0.5 : 0.2)))
      for (let k = 0; k < cnt; k++) {
        const t = (lf.start ?? 0.3) + (1 - (lf.start ?? 0.3)) * (cnt === 1 ? 1 : k / (cnt - 1)) * rng.range(0.92, 1.0)
        const fi = Math.min(frames.length - 1, Math.round(t * (frames.length - 1)))
        const f = frames[fi]
        leafPts.push({ p: f.pos.clone(), d: f.dir.clone(), s: scale })
      }
    }
  }

  // crown centre & radius from foliage points
  const centre = new THREE.Vector3()
  for (const l of leafPts) centre.add(l.p)
  centre.multiplyScalar(1 / Math.max(1, leafPts.length))
  const spread = new THREE.Vector3()
  for (const l of leafPts) spread.add(new THREE.Vector3(Math.abs(l.p.x - centre.x), Math.abs(l.p.y - centre.y), Math.abs(l.p.z - centre.z)))
  spread.multiplyScalar(1 / Math.max(1, leafPts.length) * 1.7)
  const radius = Math.max(spread.x, spread.y, spread.z)

  // leaf cards
  const lf = def.leaves
  for (const l of (lod > 0 ? leafPts : [])) {
    const out = l.p.clone().sub(centre).normalize()
    for (let c = 0; c < (lf.cluster || 1); c++) {
      let up = l.d.clone().lerp(out, 0.5).normalize()
      up.add(new THREE.Vector3(rng.range(-0.5, 0.5), rng.range(-0.3, 0.3), rng.range(-0.5, 0.5))).normalize()
      if (lf.droop) up.lerp(new THREE.Vector3(0, -1, 0), lf.droop).normalize()
      if (lf.rise) up.lerp(UP, lf.rise).normalize()
      let n
      if (lf.flat) { n = UP.clone().lerp(out, 0.6).normalize(); up = new THREE.Vector3().crossVectors(n, perpendicular(n)).normalize().applyAxisAngle(n, rng.range(0, 6.28)) }
      else { n = perpendicular(up).applyAxisAngle(up, rng.range(0, Math.PI * 2)); n.lerp(out, 0.35).normalize() }
      const sz = lf.size * l.s * (lod === 2 ? 0.8 : 1) * rng.range(0.8, 1.2)
      const p = l.p.clone().addScaledVector(out, sz * 0.08).add(new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(sz * 0.12))
      card(B, p, up, n, sz, sz * (lf.length || 1), centre, radius, lf.aspect || 1)
      if (lf.double && lod < 2) card(B, p, up, new THREE.Vector3().crossVectors(up, n).normalize(), sz, sz * (lf.length || 1), centre, radius, lf.aspect || 1)
    }
  }
  // crown core: an inner foliage mass so the crown never reads as see-through
  if (def.core > 0 && leafPts.length) {
    const k = lod > 0 ? def.core : Math.max(0.95, def.core + 0.3)
    const c2 = centre.clone().add(new THREE.Vector3(0, (def.coreOffset || 0) * spread.y, 0))
    icosphere(B, c2, new THREE.Vector3(spread.x * k, spread.y * k * (def.coreFlat || 1), spread.z * k), lod === 2 ? 2 : lod === 1 ? 1 : 0, seed, lod > 0 ? 0.12 : 0.2)
  }
  return finish(B)
}

// ------------------------------------------------------------------------------------------
// Palms: trunk (curved, tapered) + fronds (feather strips or fan cards) + optional skirt / leaf-base ball
export function growPalm(def, seed, lod) {
  const rng = new RNG(seed * 104729 + 7)
  const B = new Builder()
  const H = def.height, nSec = lod === 2 ? 14 : 6, segs = lod === 2 ? 12 : 6
  const pts = [], radii = []
  const bend = rng.range(-1, 1) * (def.curve || 0.04), bendDir = rng.range(0, 6.28)
  for (let i = 0; i <= nSec; i++) {
    const t = i / nSec
    pts.push(new THREE.Vector3(Math.cos(bendDir) * bend * t * t * H, t * H, Math.sin(bendDir) * bend * t * t * H))
    radii.push(def.radius * (1 + (def.base || 0.4) * Math.pow(1 - t, 4)) * (1 - (def.taper || 0.15) * t) * (def.bulge ? 1 + def.bulge * Math.sin(Math.PI * Math.min(1, t * 1.1)) : 1))
  }
  tube(B, pts, radii, segs, 1.6 / (def.radius * 6), y => 0.6 + 0.4 * y / H)
  const top = pts[pts.length - 1].clone()
  if (def.ball) icosphere(B, top.clone().add(new THREE.Vector3(0, -def.ball * 0.2, 0)), new THREE.Vector3(def.ball, def.ball * 0.8, def.ball), 1, seed, 0.15, 0)
  if (def.skirt) {
    // hanging dead fronds: a flared tube of bark-coloured thatch
    const sp = [], sr = []
    for (let i = 0; i <= 5; i++) { const t = i / 5; sp.push(top.clone().add(new THREE.Vector3(0, -def.skirt * t * H + 0.01 * H, 0))); sr.push(def.radius * (3.4 - 2.0 * Math.pow(t, 1.5))) }
    tube(B, sp, sr, segs, 2, () => 0.55)
  }
  const n = Math.round(def.fronds * (lod === 2 ? 1 : lod === 1 ? 0.5 : 0.22))
  const centre = top.clone()
  for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + rng.range(-0.1, 0.1)
    const tier = k / n
    const tilt = def.tiltTop - (def.tiltTop - def.tiltLow) * tier + rng.range(-0.15, 0.15)   // radians above horizontal
    const len = def.frondLen * rng.range(0.85, 1.1) * (1 - 0.25 * Math.max(0, tier - 0.6))
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt))
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
    if (def.kind === 'fan') {
      // petiole + pleated fan card at the end
      const tip = top.clone().addScaledVector(dir, len * 0.55)
      tube(B, [top.clone(), tip], [def.radius * 0.12, def.radius * 0.06], 3, 4, () => 0.8)
      const nrm = dir.clone().lerp(UP, 0.3).normalize()
      const up = new THREE.Vector3().crossVectors(side, nrm).normalize()
      card(B, tip.clone().addScaledVector(dir, len * 0.2), dir.clone().lerp(new THREE.Vector3(0, -1, 0), 0.15).normalize(), nrm, len * 0.9, len * 0.75, centre, len)
    } else {
      // arching feather frond: strip with leaflets in the texture; slight V fold
      const segsF = lod === 2 ? 7 : 4
      const droop = def.droop * rng.range(0.8, 1.2)
      const base = B.count
      for (let i = 0; i <= segsF; i++) {
        const t = i / segsF
        const p = top.clone().addScaledVector(dir, len * t).add(new THREE.Vector3(0, -droop * t * t * len, 0))
        const w = def.frondW * len * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95))
        for (const s of [-1, 1]) {
          const q = p.clone().addScaledVector(side, s * w).add(new THREE.Vector3(0, -Math.abs(s) * w * 0.3, 0))
          const nrm = UP.clone().addScaledVector(side, -s * 0.4).normalize()
          B.v(q, nrm, t, s < 0 ? 0 : 1, 1, 0.6 + 0.4 * Math.min(1, t * 2))
        }
        if (i > 0) { const a0 = base + (i - 1) * 2; B.I.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2) }
      }
    }
  }
  return finish(B)
}

// Rosette trees (cordyline, yucca, dracaena): stem forks, each tipped with a burst of strap leaves
export function growRosette(def, seed, lod) {
  const rng = new RNG(seed * 31 + 3)
  const B = new Builder()
  const top = new THREE.Vector3(0, def.trunk, 0)
  tube(B, [new THREE.Vector3(), top], [def.radius, def.radius * 0.8], lod === 2 ? 8 : 5, 3, y => 0.6 + 0.4 * y)
  const heads = def.heads
  for (let h = 0; h < heads; h++) {
    const a = h / heads * 6.28 + rng.range(-0.4, 0.4), out = rng.range(0.1, 0.25)
    const tip = top.clone().add(new THREE.Vector3(Math.cos(a) * out, rng.range(0.2, 0.42), Math.sin(a) * out))
    tube(B, [top.clone(), top.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.02, 0)), tip], [def.radius * 0.6, def.radius * 0.5, def.radius * 0.45], 5, 3, () => 0.8)
    const n = Math.round(def.leaves * (lod === 2 ? 1 : 0.5))
    for (let k = 0; k < n; k++) {
      const b = k * 2.39996, el = rng.range(-0.6, 1.1)
      const dir = new THREE.Vector3(Math.cos(b) * Math.cos(el), Math.sin(el), Math.sin(b) * Math.cos(el))
      const nrm = perpendicular(dir).applyAxisAngle(dir, rng.range(0, 3.14))
      card(B, tip.clone(), dir, nrm, def.leafW, def.leafL * rng.range(0.8, 1.1), tip, def.leafL)
    }
  }
  return finish(B)
}

function finish(B) {
  // nothing below the ground plane except the root flare
  for (let i = 0; i < B.PART.length; i++) if (B.PART[i] > 0.5 && B.P[i * 3 + 1] < 0.15) B.P[i * 3 + 1] = 0.15 + (B.P[i * 3 + 1] - 0.15) * 0.15
  const g = B.geometry()
  g.computeBoundingBox()
  const bb = g.boundingBox
  const h = bb.max.y
  const s = 1 / h
  g.scale(s, s, s)
  g.computeBoundingBox()
  const w = Math.max(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.z - g.boundingBox.min.z)
  g.computeBoundingSphere()
  return { geo: g, ratio: w, tris: g.index.count / 3 }
}
