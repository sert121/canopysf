import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Tree archetypes, normalised to height 1 and crown width ~1, at three levels of detail:
//   hi  : branching wood + ~70 textured foliage cards (leaf atlas)
//   mid : trunk + main limbs + ~18 larger cards
//   lo  : one or two flat-shaded shapes (no texture), for the far field
// Attributes: position, normal (foliage normals point out from the crown centre for soft volume light),
// uv (card or bark coordinates; uv.x < 0 means untextured), aPart (0 wood, 1 foliage), aShade (baked occlusion).

let seed = 1
const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const rr = (a, b) => a + (b - a) * R()
const V = (x, y, z) => new THREE.Vector3(x, y, z)

function attrs(g, part, shade) {
  const n = g.attributes.position.count
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1))
  const sh = new Float32Array(n); const p = g.attributes.position
  for (let i = 0; i < n; i++) sh[i] = typeof shade === 'function' ? shade(p.getX(i), p.getY(i), p.getZ(i), i) : shade
  g.setAttribute('aShade', new THREE.BufferAttribute(sh, 1))
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(-1), 2))
  return g
}

// tapered limb between two points; bark uv wraps around (u) and runs along length (v)
function limb(a, b, r0, r1, seg = 6) {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 3.0)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()))
  g.translate(a.x, a.y, a.z)
  g.computeVertexNormals()
  const ng = g.toNonIndexed()
  return attrs(ng, 0, (x, y) => 0.55 + 0.45 * Math.min(1, y * 1.6))
}

// foliage card: quad centred at p, facing roughly n, side s, with uv 0..1
function card(p, n, s, centre, opts = {}) {
  const nn = n.clone().normalize()
  let up = opts.hang ? V(0, -1, 0) : V(rr(-0.4, 0.4), 1, rr(-0.4, 0.4))
  const right = new THREE.Vector3().crossVectors(up, nn).normalize()
  if (right.lengthSq() < 1e-4) right.set(1, 0, 0)
  up = new THREE.Vector3().crossVectors(nn, right).normalize()
  const rot = opts.hang ? 0 : rr(0, Math.PI * 2)
  const cr = Math.cos(rot), sr = Math.sin(rot)
  const ax = right.clone().multiplyScalar(cr).add(up.clone().multiplyScalar(sr))
  const ay = up.clone().multiplyScalar(cr).sub(right.clone().multiplyScalar(sr))
  const sx = s * (opts.aspect || 1), sy = s
  const c = (u, v) => p.clone().add(ax.clone().multiplyScalar((u - 0.5) * sx)).add(ay.clone().multiplyScalar((v - 0.5) * sy * (opts.hang ? 1.8 : 1)))
  const P = [c(0, 0), c(1, 0), c(1, 1), c(0, 0), c(1, 1), c(0, 1)]
  const UV = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
  if (opts.hang) for (const t of UV) t[1] = 1 - t[1]
  const pos = [], nor = [], uv = []
  for (let k = 0; k < 6; k++) {
    pos.push(P[k].x, P[k].y, P[k].z)
    const sn = P[k].clone().sub(centre).normalize().lerp(nn, 0.35).normalize()
    nor.push(sn.x, sn.y, sn.z); uv.push(UV[k][0], UV[k][1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const dist = p.clone().sub(centre).length()
  return attrs(g, 1, () => opts.shade ?? (0.62 + 0.38 * Math.min(1, dist / (opts.radius || 0.45))))
}

// palm frond strip: arcs out from the crown, uv.x along the frond, uv.y across
function frond(origin, angle, tilt, len, width, droop, segs = 5) {
  const pos = [], nor = [], uv = []
  const dir = V(Math.cos(angle), 0, Math.sin(angle)), side = V(-Math.sin(angle), 0, Math.cos(angle))
  const pt = t => origin.clone().add(dir.clone().multiplyScalar(Math.cos(tilt) * len * t)).add(V(0, Math.sin(tilt) * len * t - droop * t * t * len, 0))
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs
    const a = pt(t0), b = pt(t1)
    const w0 = width, w1 = width
    const A = a.clone().add(side.clone().multiplyScalar(-w0)), B = a.clone().add(side.clone().multiplyScalar(w0))
    const C = b.clone().add(side.clone().multiplyScalar(-w1)), D = b.clone().add(side.clone().multiplyScalar(w1))
    // slight V-fold so it reads from the side too
    A.y -= w0 * 0.25; B.y -= w0 * 0.25; C.y -= w1 * 0.25; D.y -= w1 * 0.25
    for (const [p, u, v] of [[A, t0, 0], [B, t0, 1], [D, t1, 1], [A, t0, 0], [D, t1, 1], [C, t1, 0]]) { pos.push(p.x, p.y, p.z); nor.push(0, 1, 0); uv.push(u, v) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return attrs(g, 1, (x, y) => 0.7 + 0.3 * Math.min(1, Math.max(0, (y - origin.y + 0.1) * 4)))
}

function blob(x, y, z, sx, sy, sz, detail = 0) {
  let g = new THREE.IcosahedronGeometry(0.5, detail)
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + rr(-0.1, 0.1)), p.getY(i) * (1 + rr(-0.1, 0.1)), p.getZ(i) * (1 + rr(-0.1, 0.1)))
  g.scale(sx, sy, sz); g.translate(x, y, z)
  g = g.toNonIndexed(); g.computeVertexNormals()
  return attrs(g, 1, (px, py) => 0.62 + 0.38 * THREE.MathUtils.clamp((py - (y - sy / 2)) / sy, 0, 1))
}

function merge(list) { const g = mergeGeometries(list, false); g.computeBoundingSphere(); return g }

// ---- crown samplers: return [{p, n}] points on/in the crown ----
function ellipsoidPts(n, c, r, { minY = -1, shell = 0.72 } = {}) {
  const out = []
  let guard = 0
  while (out.length < n && guard++ < n * 50) {
    const d = V(rr(-1, 1), rr(-1, 1), rr(-1, 1)); if (d.lengthSq() > 1 || d.lengthSq() < 0.05) continue
    d.normalize()
    if (d.y < minY) continue
    const k = rr(shell, 1.0)
    const p = V(c.x + d.x * r.x * k, c.y + d.y * r.y * k, c.z + d.z * r.z * k)
    out.push({ p, n: V(d.x / r.x, d.y / r.y, d.z / r.z).normalize() })
  }
  return out
}
function conePts(n, y0, y1, r0) {
  const out = []
  for (let i = 0; i < n; i++) {
    const t = Math.pow(R(), 0.8), y = y0 + (y1 - y0) * t, rad = r0 * (1 - t) * rr(0.7, 1.05), a = rr(0, Math.PI * 2)
    const p = V(Math.cos(a) * rad, y, Math.sin(a) * rad)
    out.push({ p, n: V(Math.cos(a), 0.5, Math.sin(a)).normalize() })
  }
  return out
}

// Build wood that reaches toward foliage points: trunk to `fork`, then limbs to clump centres, twigs to some cards.
function wood(L, trunkTop, r0, targets, { twigs = 12, lean = 0 } = {}) {
  const base = V(0, 0, 0), top = V(lean, trunkTop, 0)
  L.push(limb(base, top, r0, r0 * 0.7, 7))
  for (const t of targets) {
    const mid = top.clone().lerp(t, 0.55).add(V(rr(-0.04, 0.04), rr(0, 0.05), rr(-0.04, 0.04)))
    L.push(limb(top, mid, r0 * 0.6, r0 * 0.38, 5), limb(mid, t, r0 * 0.38, r0 * 0.14, 5))
  }
  return top
}

// ---- archetype builders: (detail) -> geometry ; detail 1 = hi, 0 = mid ----
const NC = (n, lv) => Math.max(lv === 0 ? 5 : 3, Math.round(n * [0.1, 0.26, 1][lv]))
const SZ = (s, lv) => s * [2.7, 1.85, 1][lv]
function broadleaf(spec) {
  return lv => { const hi = lv === 2
    const L = []
    const C = V(0, spec.cy, 0), Rr = V(spec.rx, spec.ry, spec.rx)
    const n = NC(spec.cards, lv)
    const pts = ellipsoidPts(n, C, Rr, { minY: spec.minY ?? -0.7, shell: hi ? 0.55 : 0.65 })
    const limbs = []
    for (let k = 0; k < (hi ? spec.limbs : lv === 1 ? 3 : 0); k++) {
      const a = k / spec.limbs * Math.PI * 2 + rr(-0.3, 0.3)
      limbs.push(V(Math.cos(a) * spec.rx * 0.6, spec.cy + rr(-0.05, spec.ry * 0.4), Math.sin(a) * spec.rx * 0.6))
    }
    wood(L, spec.trunk, spec.r0, limbs, { lean: spec.lean || 0 })
    const s = SZ(spec.size, lv)
    for (const { p, n: nn } of pts) L.push(card(p, nn, s * rr(0.85, 1.15), C, { radius: Math.max(spec.rx, spec.ry) }))
    if (spec.curtain) {
      // weeping curtain: hanging cards around the rim
      const m = [4, 8, 26][lv]
      for (let k = 0; k < m; k++) {
        const a = k / m * Math.PI * 2 + rr(-0.1, 0.1), rad = spec.rx * rr(0.85, 1.0)
        const p = V(Math.cos(a) * rad, spec.cy - spec.ry * rr(0.6, 1.1), Math.sin(a) * rad)
        L.push(card(p, V(Math.cos(a), 0, Math.sin(a)), s * 1.05, C, { hang: true, aspect: 0.75, shade: 0.75 }))
      }
    }
    return merge(L)
  }
}
function conifer(spec) {
  return lv => { const hi = lv === 2
    const L = []
    const n = NC(spec.cards, lv)
    L.push(limb(V(0, 0, 0), V(0, spec.top, 0), spec.r0, spec.r0 * 0.15, 7))
    if (hi) for (let k = 0; k < 9; k++) {
      const y = spec.y0 + (spec.top - spec.y0) * (k / 9), rad = spec.r * (1 - k / 9) * 0.9, a = k * 2.4
      L.push(limb(V(0, y, 0), V(Math.cos(a) * rad, y + 0.02, Math.sin(a) * rad), spec.r0 * 0.3, spec.r0 * 0.08, 4))
    }
    const C = V(0, (spec.y0 + spec.top) / 2, 0)
    for (const { p, n: nn } of conePts(n, spec.y0, spec.top, spec.r)) {
      const q = nn.clone(); q.y = spec.flat ? 1.6 : q.y
      L.push(card(p, q, SZ(spec.size, lv) * rr(0.85, 1.15), C, { radius: spec.r }))
    }
    return merge(L)
  }
}
function clumps(spec) {
  // clumped crowns: pine, eucalyptus, cypress (flat tiers)
  return lv => { const hi = lv === 2
    const L = []
    const targets = spec.clumps.map(c => V(c[0], c[1], c[2]))
    wood(L, spec.trunk, spec.r0, lv === 0 ? [] : targets, { lean: spec.lean || 0 })
    for (const c of spec.clumps) {
      const C = V(c[0], c[1], c[2]), Rr = V(c[3], c[4], c[5])
      const n = Math.max(lv === 0 ? 1 : 2, Math.round(spec.per * [0.12, 0.26, 1][lv] * c[3] / 0.3))
      for (const { p, n: nn } of ellipsoidPts(n, C, Rr, { minY: spec.minY ?? -0.4, shell: 0.4 })) {
        const q = spec.flat ? V(nn.x * 0.4, 1, nn.z * 0.4) : nn
        L.push(card(p, q, SZ(spec.size, lv) * (lv === 0 ? 0.8 : 1) * rr(0.8, 1.2), C, { radius: Math.max(c[3], c[4]), hang: spec.hang && R() < 0.4, aspect: spec.hang ? 0.7 : 1 }))
      }
    }
    return merge(L)
  }
}
function palm(kind) {
  return lv => { const hi = lv === 2
    const L = []
    const top = V(0.03, kind === 'fan' ? 0.88 : 0.8, 0)
    L.push(limb(V(0, 0, 0), top, kind === 'fan' ? 0.05 : 0.065, 0.045, 8))
    const n = [7, 10, 16][lv]
    if (kind === 'fan') {
      // skirt of dead fronds
      const sk = new THREE.ConeGeometry(0.085, 0.22, 8, 1, true); sk.translate(top.x, top.y - 0.06, 0)
      const skn = sk.toNonIndexed(); skn.computeVertexNormals(); L.push(attrs(skn, 0, 0.7))
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + rr(-0.15, 0.15), tilt = rr(-0.4, 0.9), l = 0.16
        const tip = top.clone().add(V(Math.cos(a) * Math.cos(tilt) * l, Math.sin(tilt) * l, Math.sin(a) * Math.cos(tilt) * l))
        if (hi) L.push(limb(top, tip, 0.008, 0.005, 3))
        const out = V(Math.cos(a), Math.sin(tilt) + 0.4, Math.sin(a))
        L.push(card(tip.clone().add(out.clone().normalize().multiplyScalar(0.12)), out, 0.34, top, { shade: 0.8 }))
      }
    } else {
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + rr(-0.15, 0.15)
        L.push(frond(top, a, rr(0.15, 1.0), 0.52, 0.12, rr(0.45, 0.8), [2, 3, 5][lv]))
      }
    }
    return merge(L)
  }
}
function tuft() {
  return lv => { const hi = lv === 2
    const L = []
    const top = V(0, 0.48, 0)
    L.push(limb(V(0, 0, 0), top, 0.05, 0.035, 6))
    const heads = [V(0.17, 0.74, 0.04), V(-0.15, 0.68, -0.08), V(0.02, 0.84, 0.14)]
    for (const h of heads) {
      L.push(limb(top, h, 0.03, 0.022, 5))
      for (let k = 0; k < [2, 3, 5][lv]; k++) {
        const a = k / 5 * Math.PI * 2
        L.push(card(h.clone().add(V(0, 0.08, 0)), V(Math.cos(a), 0.15, Math.sin(a)), 0.3, h, { shade: 0.85 }))
      }
    }
    return merge(L)
  }
}

const B = {
  round: broadleaf({ cy: 0.64, rx: 0.47, ry: 0.34, trunk: 0.36, r0: 0.05, cards: 70, limbs: 5, size: 0.3 }),
  oval: broadleaf({ cy: 0.6, rx: 0.45, ry: 0.4, trunk: 0.3, r0: 0.045, cards: 66, limbs: 4, size: 0.28 }),
  column: broadleaf({ cy: 0.56, rx: 0.42, ry: 0.44, trunk: 0.16, r0: 0.06, cards: 56, limbs: 3, size: 0.3 }),
  spread: broadleaf({ cy: 0.68, rx: 0.5, ry: 0.24, trunk: 0.38, r0: 0.055, cards: 72, limbs: 6, size: 0.3, minY: -0.35 }),
  umbrella: broadleaf({ cy: 0.86, rx: 0.5, ry: 0.12, trunk: 0.66, r0: 0.045, cards: 56, limbs: 5, size: 0.28, minY: -0.5, lean: 0.03 }),
  vase: broadleaf({ cy: 0.74, rx: 0.5, ry: 0.25, trunk: 0.3, r0: 0.055, cards: 70, limbs: 6, size: 0.3, minY: -0.3 }),
  weep: broadleaf({ cy: 0.72, rx: 0.44, ry: 0.27, trunk: 0.45, r0: 0.05, cards: 46, limbs: 4, size: 0.3, curtain: true }),
  cone: conifer({ y0: 0.1, top: 1.0, r: 0.5, r0: 0.05, cards: 74, size: 0.27 }),
  araucaria: conifer({ y0: 0.22, top: 1.0, r: 0.48, r0: 0.035, cards: 60, size: 0.24, flat: true }),
  cypress: clumps({ trunk: 0.48, r0: 0.07, lean: 0.06, per: 22, size: 0.3, flat: true, minY: -0.1,
    clumps: [[0.1, 0.84, 0, 0.48, 0.12, 0.4], [0.36, 0.66, 0.05, 0.26, 0.09, 0.26], [-0.26, 0.6, 0.08, 0.24, 0.09, 0.22], [0.05, 0.95, -0.06, 0.3, 0.07, 0.26], [-0.1, 0.74, -0.2, 0.22, 0.08, 0.2]] }),
  pine: clumps({ trunk: 0.66, r0: 0.05, lean: 0.03, per: 16, size: 0.26,
    clumps: [[0.02, 0.88, 0, 0.36, 0.14, 0.36], [0.3, 0.64, 0.06, 0.2, 0.11, 0.2], [-0.28, 0.72, -0.05, 0.21, 0.11, 0.21], [0.1, 0.75, 0.3, 0.18, 0.1, 0.18], [-0.12, 0.58, 0.24, 0.16, 0.09, 0.16]] }),
  gum: clumps({ trunk: 0.52, r0: 0.045, lean: 0.03, per: 14, size: 0.24, hang: true,
    clumps: [[0.2, 0.9, 0.04, 0.22, 0.13, 0.22], [-0.17, 0.86, -0.05, 0.21, 0.14, 0.21], [0.02, 0.97, 0.18, 0.18, 0.09, 0.18], [-0.02, 0.72, 0.02, 0.16, 0.12, 0.16], [0.16, 0.7, -0.16, 0.14, 0.1, 0.14]] }),
  palmfan: palm('fan'),
  palmfeather: palm('feather'),
  tuft: tuft(),
}

const LO = {
  round: () => merge([limb(V(0, 0, 0), V(0, 0.48, 0), 0.06, 0.04, 4), blob(0, 0.66, 0, 0.92, 0.64, 0.92)]),
  oval: () => merge([limb(V(0, 0, 0), V(0, 0.4, 0), 0.05, 0.04, 4), blob(0, 0.62, 0, 0.88, 0.8, 0.88)]),
  column: () => merge([limb(V(0, 0, 0), V(0, 0.2, 0), 0.06, 0.05, 4), blob(0, 0.57, 0, 0.82, 0.88, 0.82)]),
  spread: () => merge([limb(V(0, 0, 0), V(0, 0.45, 0), 0.06, 0.04, 4), blob(0, 0.7, 0, 1.0, 0.48, 1.0)]),
  umbrella: () => merge([limb(V(0, 0, 0), V(0, 0.75, 0), 0.05, 0.04, 4), blob(0, 0.87, 0, 1.0, 0.24, 1.0)]),
  vase: () => merge([limb(V(0, 0, 0), V(0, 0.4, 0), 0.06, 0.04, 4), blob(0, 0.75, 0, 1.0, 0.5, 1.0)]),
  weep: () => merge([limb(V(0, 0, 0), V(0, 0.45, 0), 0.05, 0.04, 4), blob(0, 0.62, 0, 0.9, 0.74, 0.9)]),
  cone: () => { const g = new THREE.ConeGeometry(0.5, 0.92, 7); g.translate(0, 0.54, 0); const n = g.toNonIndexed(); n.deleteAttribute('uv'); n.computeVertexNormals(); return merge([limb(V(0, 0, 0), V(0, 0.2, 0), 0.06, 0.04, 4), attrs(n, 1, (x, y) => 0.6 + 0.4 * y)]) },
  araucaria: () => { const g = new THREE.ConeGeometry(0.46, 0.8, 7); g.translate(0, 0.6, 0); const n = g.toNonIndexed(); n.deleteAttribute('uv'); n.computeVertexNormals(); return merge([limb(V(0, 0, 0), V(0, 0.3, 0), 0.04, 0.03, 4), attrs(n, 1, (x, y) => 0.6 + 0.4 * y)]) },
  cypress: () => merge([limb(V(0, 0, 0), V(0.06, 0.55, 0), 0.07, 0.05, 4), blob(0.1, 0.8, 0, 1.0, 0.34, 0.84)]),
  pine: () => merge([limb(V(0, 0, 0), V(0, 0.72, 0), 0.05, 0.035, 4), blob(0, 0.82, 0, 0.82, 0.38, 0.82)]),
  gum: () => merge([limb(V(0, 0, 0), V(0, 0.68, 0), 0.045, 0.03, 4), blob(0, 0.86, 0, 0.62, 0.34, 0.62)]),
  palmfan: () => merge([limb(V(0, 0, 0), V(0, 0.88, 0), 0.06, 0.05, 4), blob(0, 0.93, 0, 0.5, 0.24, 0.5)]),
  palmfeather: () => merge([limb(V(0, 0, 0), V(0, 0.8, 0), 0.07, 0.05, 4), blob(0, 0.84, 0, 0.8, 0.2, 0.8)]),
  tuft: () => merge([limb(V(0, 0, 0), V(0, 0.55, 0), 0.05, 0.04, 4), blob(0, 0.74, 0, 0.6, 0.36, 0.6)]),
}

export const ARCHES = Object.keys(B)
export const CROWN = { round: 0.82, oval: 0.64, column: 0.36, spread: 1.15, umbrella: 1.1, vase: 1.0, cone: 0.48, araucaria: 0.46, cypress: 1.05, pine: 0.74, gum: 0.62, weep: 0.88, palmfan: 0.36, palmfeather: 0.6, tuft: 0.5 }
export const PICK = { round: [0.66, 0.36], oval: [0.62, 0.4], column: [0.57, 0.45], spread: [0.7, 0.28], umbrella: [0.86, 0.16], vase: [0.78, 0.25], cone: [0.5, 0.45], araucaria: [0.6, 0.4], cypress: [0.8, 0.2], pine: [0.82, 0.2], gum: [0.85, 0.15], weep: [0.6, 0.38], palmfan: [0.92, 0.14], palmfeather: [0.86, 0.14], tuft: [0.76, 0.2] }

export function buildArchetypes() {
  const out = {}
  for (const k of ARCHES) {
    seed = 11 + k.length * 977
    const hi = B[k](2); seed = 5 + k.length * 131
    const mid = B[k](1); seed = 3 + k.length * 71
    out[k] = { hi, mid, lo: B[k](0) }
  }
  return out
}
