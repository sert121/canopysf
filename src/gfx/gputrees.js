// GPU-driven trees for the WebGPU engine.
// All ~195,000 trees live in GPU storage buffers. Every frame a compute pass frustum-culls them, picks a level of
// detail by distance, and appends each survivor to the instance list of its (species model, variant, LOD) group,
// counting with atomics straight into the indirect-draw arguments. The CPU never touches per-tree data per frame,
// so the full-detail radius and the far distance can be far larger than the WebGL engine's streaming allows.
import * as THREE from 'three/webgpu'
import {
  Fn, uniform, uniformArray, vec2, vec3, vec4, float, uint, int, texture, attribute, varying, positionLocal, normalLocal, uv,
  instanceIndex, instancedArray, storage, atomicAdd, atomicStore, If, Discard, Return, select, fract, floor, mod, dot, mix, max, min,
  smoothstep, pow, abs, sin, cos, step, normalize, length, cross, clamp,
} from 'three/tsl'
import { T as TU, vnoise, lin, fogIt, lightIt, shadowAt } from './tsl-common.js'

export const GT = { ready: false, hiR: 160, midR: 600, farR: 2400, keepR: 90 }
let N = 0, G = 0
let bufA, bufB, bufC, bufD, bufE, lists, offsets, argsAttr, args, corrBuf
let computeReset, computeCull
const planes = Array.from({ length: 6 }, () => new THREE.Vector4())
let uPlanes, uCam, uHi, uMid, uFar, uKeep
const meshes = [], shadowMeshes = []
const frustum = new THREE.Frustum(), pv = new THREE.Matrix4()

const SLOT = { hi: 0, mid: 3, lo: 6 }

export function initGpuTrees(scene, shadowScene, groups, MINFO, T, atlas, opts) {
  Object.assign(GT, opts || {})
  N = T.px.length
  const M = groups.length
  G = M * 7
  // capacities: each tree belongs to exactly one hi, one mid and one lo group
  const capHM = new Uint32Array(M * 3), capLo = new Uint32Array(M)
  for (let i = 0; i < N; i++) { capHM[T.model[i] * 3 + T.vari[i]]++; capLo[T.model[i]]++ }
  const off = new Uint32Array(G); let total = 0
  for (let m = 0; m < M; m++) for (let s = 0; s < 7; s++) {
    off[m * 7 + s] = total
    total += s < 6 ? capHM[m * 3 + (s % 3)] : capLo[m]
  }
  offsets = instancedArray(off, 'uint')
  lists = instancedArray(total, 'uint')

  // per-tree data
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4), C = new Float32Array(N * 4), Dd = new Float32Array(N * 4)
  for (let i = 0; i < N; i++) {
    A[i * 4] = T.px[i]; A[i * 4 + 1] = T.py[i]; A[i * 4 + 2] = T.pz[i]; A[i * 4 + 3] = T.rot[i]
    B[i * 4] = T.SX[i]; B[i * 4 + 1] = T.H[i]; B[i * 4 + 2] = T.seed[i]; B[i * 4 + 3] = T.model[i] * 4 + T.vari[i]
    Dd[i * 4 + 3] = T.W[i]
  }
  bufA = instancedArray(A, 'vec4'); bufB = instancedArray(B, 'vec4')
  bufC = instancedArray(C, 'vec4'); bufD = instancedArray(Dd, 'vec4')
  bufE = instancedArray(new Float32Array(N * 4), 'vec4')
  refreshGpuTrees(T)

  const corr = new Float32Array(M * 4)
  MINFO.forEach((mi, m) => { corr[m * 4] = 1; corr[m * 4 + 1] = mi.corr.mid; corr[m * 4 + 2] = mi.corr.lo })
  corrBuf = instancedArray(corr, 'vec4')

  // indirect args: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance] per group
  const argData = new Uint32Array(G * 5)
  groups.forEach((gr, m) => {
    const geos = [...gr.hi.map(L => L.base), ...gr.mid.map(L => L.base), gr.lo[0].base]
    geos.forEach((g, s) => { argData[(m * 7 + s) * 5] = g.index.count })
  })
  argsAttr = new THREE.IndirectStorageBufferAttribute(argData, 5)
  args = storage(argsAttr, 'uint', G * 5).toAtomic()

  // ---- compute ----
  uPlanes = uniformArray(planes.map(p => p.clone()), 'vec4')
  uCam = uniform(new THREE.Vector3())
  uHi = uniform(GT.hiR); uMid = uniform(GT.midR); uFar = uniform(GT.farR); uKeep = uniform(GT.keepR)
  computeReset = Fn(() => { atomicStore(args.element(instanceIndex.mul(5).add(1)), uint(0)) })().compute(G)
  computeCull = Fn(() => {
    const i = instanceIndex
    const a = bufA.element(i), b = bufB.element(i), w = bufD.element(i).w
    const d = length(a.xz.sub(uCam.xz))
    If(d.greaterThan(uFar), () => { Return() })
    const r = max(b.y, w).mul(0.62)
    const c = vec3(a.x, a.y.add(b.y.mul(0.5)), a.z)
    const vis = float(1).toVar()
    for (let k = 0; k < 6; k++) {
      const p = uPlanes.element(k)
      vis.mulAssign(step(r.negate(), dot(p.xyz, c).add(p.w)))
    }
    // trees just outside the view still cast shadows into it
    If(vis.lessThan(0.5).and(d.greaterThan(uKeep)), () => { Return() })
    const model = uint(floor(b.w.div(4)))
    const vari = uint(b.w.sub(floor(b.w.div(4)).mul(4)))
    const slot = select(d.lessThan(uHi), vari, select(d.lessThan(uMid), vari.add(3), uint(6)))
    const g = model.mul(7).add(slot)
    const k = atomicAdd(args.element(g.mul(5).add(1)), uint(1))
    lists.element(offsets.element(g).add(k)).assign(i)
  })().compute(N)

  // ---- materials ----
  const mat = treeMaterial(atlas, false), dmat = treeMaterial(atlas, true)
  groups.forEach((gr, m) => {
    const geos = [...gr.hi.map(L => L.base), ...gr.mid.map(L => L.base), gr.lo[0].base]
    geos.forEach((base, s) => {
      const g = m * 7 + s
      const geo = new THREE.BufferGeometry()
      for (const k of ['position', 'normal', 'uv', 'aPart', 'aShade']) geo.setAttribute(k, base.attributes[k])
      geo.setIndex(base.index)
      geo.setIndirect(argsAttr, g * 20)
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)
      const lodC = s < 3 ? 0 : s < 6 ? 1 : 2
      const ud = { base: off[g], corr: lodC === 0 ? 1 : lodC === 1 ? MINFO[m].corr.mid : MINFO[m].corr.lo }
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.userData = ud
      scene.add(mesh); meshes.push(mesh)
      const sm = new THREE.Mesh(geo, dmat); sm.frustumCulled = false; sm.userData = ud
      // cascade 0 (near) draws hi + mid casters, cascade 1 (far) draws mid + lo
      sm.layers.disableAll()
      if (lodC <= 1) sm.layers.enable(1)
      if (lodC >= 1) sm.layers.enable(2)
      shadowScene.add(sm); shadowMeshes.push(sm)
    })
  })
  GT.ready = true
}

// flags/colours that change at runtime: season, highlight
export function refreshGpuTrees(T) {
  if (!bufC) return
  const C = bufC.value.array, Dd = bufD.value.array, E = bufE.value.array
  const sp = T.spArr, hm = T.hiMask, ht = T.hiTree
  for (let i = 0; i < N; i++) {
    C[i * 4] = T.col[i * 3]; C[i * 4 + 1] = T.col[i * 3 + 1]; C[i * 4 + 2] = T.col[i * 3 + 2]; C[i * 4 + 3] = T.leaf[i] * 16 + T.bark[i]
    Dd[i * 4] = T.trunk[i * 3]; Dd[i * 4 + 1] = T.trunk[i * 3 + 1]; Dd[i * 4 + 2] = T.trunk[i * 3 + 2]
    E[i * 4] = T.flw[i * 3]; E[i * 4 + 1] = T.flw[i * 3 + 1]; E[i * 4 + 2] = T.flw[i * 3 + 2]
    E[i * 4 + 3] = T.state[i] + 4 * ((hm[sp[i]] | ht[i]) ? 1 : 0)
  }
  bufC.value.needsUpdate = true; bufD.value.needsUpdate = true; bufE.value.needsUpdate = true
}
export function refreshHighlights(T) {
  if (!bufE) return
  const E = bufE.value.array, sp = T.spArr, hm = T.hiMask, ht = T.hiTree
  for (let i = 0; i < N; i++) E[i * 4 + 3] = T.state[i] + 4 * ((hm[sp[i]] | ht[i]) ? 1 : 0)
  bufE.value.needsUpdate = true
}

export function setGpuDistances(hi, mid, far) { GT.hiR = hi; GT.midR = mid; GT.farR = far }

export function cullGpuTrees(renderer, camera) {
  if (!GT.ready) return
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(pv, camera.coordinateSystem)
  frustum.planes.forEach((p, k) => uPlanes.array[k].set(p.normal.x, p.normal.y, p.normal.z, p.constant))
  uCam.value.copy(camera.position)
  uHi.value = GT.hiR; uMid.value = GT.midR; uFar.value = GT.farR; uKeep.value = GT.keepR
  renderer.compute(computeReset)
  renderer.compute(computeCull)
}

// ---------------------------------------------------------------- material
function treeMaterial(atlas, depthOnly) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
  m.fog = false; m.lights = false
  const base = uniform(0, 'uint').onObjectUpdate(({ object }) => object.userData.base)
  const corr = uniform(1).onObjectUpdate(({ object }) => object.userData.corr)
  const id = lists.element(base.add(instanceIndex))
  const A = bufA.element(id), B = bufB.element(id), C = bufC.element(id), Dd = bufD.element(id), E = bufE.element(id)
  const aPart = attribute('aPart', 'float'), aShade = attribute('aShade', 'float')

  const world = Fn(() => {
    const p = positionLocal
    const c = cos(A.w), s = sin(A.w)
    const ph = B.z.mul(6.2831)
    const sway = select(aPart.greaterThan(0.5),
      sin(TU.time.mul(1.05).add(ph).add(p.y.mul(1.7))).mul(0.012).add(sin(TU.time.mul(2.9).add(ph.mul(1.7)).add(p.x.mul(9.0))).mul(0.006)).mul(smoothstep(0.2, 1.0, p.y)),
      float(0))
    const sx = B.x.mul(corr)
    const sp = vec3(p.x.mul(sx).add(sway.mul(B.y)), p.y.mul(B.y), p.z.mul(sx).add(sway.mul(0.5).mul(B.y)))
    return A.xyz.add(vec3(c.mul(sp.x).sub(s.mul(sp.z)), sp.y, s.mul(sp.x).add(c.mul(sp.z))))
  })()
  m.positionNode = world
  const vW = varying(world)
  const vUv = varying(uv()), vPart = varying(aPart)
  const flags = varying(E.w)
  const vSeed = varying(B.z)
  const vTex = varying(C.w)
  const leafT = Fn(() => floor(vTex.div(16).add(0.001)))(), barkT = Fn(() => vTex.sub(floor(vTex.div(16).add(0.001)).mul(16)))()
  const state = flags.sub(floor(flags.div(4).add(0.001)).mul(4))
  const leafTex = texture(atlas.leaf), barkTex = texture(atlas.bark)
  const tileUV = (t, q) => {
    const cx = mod(t, 4.0), cy = floor(t.div(4.0).add(0.001))
    return vec2(cx.add(0.025).add(q.x.mul(0.95)).div(4.0), float(1.0).sub(cy.add(0.025).add(q.y.oneMinus().mul(0.95)).div(4.0)))
  }

  if (depthOnly) {
    m.colorNode = Fn(() => {
      const isCore = vPart.greaterThan(1.5)
      const tx = leafTex.sample(tileUV(leafT, fract(vUv))).toVar()
      If(isCore.and(state.greaterThan(1.5)), () => { Discard() })
      If(vPart.greaterThan(0.5).and(vPart.lessThan(1.5)).and(vUv.x.greaterThanEqual(0.0)), () => {
        If(tx.a.lessThan(0.4), () => { Discard() })
        If(state.greaterThan(1.5).and(vnoise(vW.xz.mul(0.9).add(vW.y.mul(1.3)).add(vSeed.mul(40.0))).lessThan(0.82)), () => { Discard() })
      })
      return vec3(1)
    })()
    return m
  }

  const nrm = Fn(() => {
    const c = cos(A.w), s = sin(A.w)
    const sx = B.x.mul(corr)
    const n = normalize(vec3(normalLocal.x.div(sx), normalLocal.y.div(B.y), normalLocal.z.div(sx)))
    return vec3(c.mul(n.x).sub(s.mul(n.z)), n.y, s.mul(n.x).add(c.mul(n.z)))
  })()
  const vN = varying(nrm)
  const vCol = varying(C.xyz), vTrunk = varying(Dd.xyz), vFlower = varying(E.xyz), vAO = varying(aShade)
  const hi = floor(flags.div(4).add(0.001))

  m.colorNode = Fn(() => {
    const n = normalize(vN).toVar()
    const v = normalize(TU.camPos.sub(vW))
    const leaf = vPart.greaterThan(0.5), core = vPart.greaterThan(1.5)
    // all texture fetches up front (uniform control flow)
    const tx = leafTex.sample(tileUV(leafT, fract(vUv))).toVar()
    const ct = leafTex.sample(tileUV(leafT, fract(vec2(vW.x.mul(0.45).add(vW.z.mul(0.31)), vW.y.mul(0.45).sub(vW.z.mul(0.2)))))).toVar()
    const bf = select(abs(barkT.sub(6.0)).lessThan(0.5), float(3.0), float(1.0))
    const buv = vec2(fract(vUv.x.mul(2.0).mul(bf)), fract(vUv.y.mul(0.5).mul(bf))).toVar()
    const b = barkTex.sample(tileUV(barkT, buv)).r.toVar()
    const bx = barkTex.sample(tileUV(barkT, buv.add(vec2(0.004, 0.0)))).r.sub(b).toVar()
    const nz = vnoise(vW.xz.mul(1.9).add(vW.y.mul(2.3)).add(vSeed.mul(17.0))).mul(0.6).add(vnoise(vW.xz.mul(5.3).sub(vW.y.mul(4.1))).mul(0.4)).toVar()

    If(core.and(state.greaterThan(1.5).or(dot(n, v).lessThan(0.0))), () => { Discard() })
    If(core.and(abs(dot(n, v)).lessThan(float(0.28).add(vnoise(vW.xz.mul(2.7).add(vW.y.mul(3.1))).mul(0.42)))), () => { Discard() })
    If(leaf.not().and(dot(n, v).lessThan(0.0)), () => { n.assign(n.negate()) })
    const alb = vec3(0).toVar(), spec = float(0).toVar(), trans = float(0).toVar()
    If(leaf.not(), () => {
      If(vUv.x.greaterThanEqual(0.0), () => {
        const t = normalize(cross(n, vec3(0, 1, 0)).add(1e-4))
        n.assign(normalize(n.sub(t.mul(bx).mul(3.0))))
        alb.assign(lin(vTrunk).mul(float(0.3).add(b.mul(0.8))).mul(0.45))
      }).Else(() => { alb.assign(lin(vTrunk).mul(0.45)) })
    }).ElseIf(core, () => {
      const leafy = mix(0.35, float(0.55).add(ct.r.mul(0.6)), ct.a)
      alb.assign(lin(vCol).mul(float(0.5).add(nz.mul(0.4))).mul(leafy).mul(mix(0.6, 1.0, vAO)).mul(0.85))
      If(state.greaterThan(0.5).and(state.lessThan(1.5)), () => { alb.assign(mix(alb, lin(vFlower).mul(0.6), step(0.6, nz).mul(0.6))) })
      trans.assign(0.35)
    }).ElseIf(vUv.x.greaterThanEqual(0.0), () => {
      If(tx.a.lessThan(0.4), () => { Discard() })
      If(state.greaterThan(1.5).and(vnoise(vW.xz.mul(0.9).add(vW.y.mul(1.3)).add(vSeed.mul(40.0))).lessThan(0.82)), () => { Discard() })
      const hue = mix(vec3(0.86, 1.04, 0.80), vec3(1.10, 0.98, 1.02), tx.b)
      alb.assign(lin(vCol).mul(float(0.3).add(tx.r.mul(0.85))).mul(hue).mul(mix(0.5, 1.0, vAO)).mul(0.78))
      If(state.greaterThan(0.5).and(state.lessThan(1.5)).and(tx.g.greaterThan(0.5)), () => { alb.assign(lin(vFlower).mul(float(0.55).add(tx.r.mul(0.6)))) })
      If(state.greaterThan(1.5), () => { alb.assign(mix(alb, lin(vTrunk), 0.4)) })
      spec.assign(float(0.03).add(tx.r.mul(0.05))); trans.assign(1.0)
    }).Else(() => {
      alb.assign(lin(vCol).mul(0.62)); trans.assign(0.6)
      If(state.greaterThan(0.5).and(state.lessThan(1.5)), () => { alb.assign(mix(alb, lin(vFlower), 0.5)) })
    })
    const shN = select(leaf, TU.sunDir, n)
    const sh0 = shadowAt(vW, shN)
    const sh = select(core, float(0.35).add(sh0.mul(0.65)), sh0)
    const c = lightIt(alb, n, select(core, max(vAO, 0.75), vAO), sh).toVar()
    If(leaf, () => {
      const back = pow(max(dot(v.negate(), TU.sunDir), 0.0), 3.0)
      c.addAssign(alb.mul(lin(TU.sunColor)).mul(TU.sunI).mul(back).mul(0.32).mul(trans).mul(float(0.25).add(sh.mul(0.75))))
      const h = normalize(TU.sunDir.add(v))
      c.addAssign(lin(TU.sunColor).mul(TU.sunI).mul(spec).mul(pow(max(dot(n, h), 0.0), 40.0)).mul(sh))
    })
    c.assign(fogIt(c, vW))
    If(hi.greaterThan(0.5), () => {
      const pulse = float(0.55).add(sin(TU.time.mul(3.0)).mul(0.45))
      c.assign(mix(c, vec3(1.0, 0.75, 0.25).mul(1.6), float(0.25).add(pulse.mul(0.2))))
    })
    return c
  })()
  return m
}
