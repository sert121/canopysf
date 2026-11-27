// WebGPU-engine materials for everything that isn't a tree: sky, ground, ocean, roads, buildings, markers.
// Each outputs linear HDR radiance with aerial perspective applied; the post chain tone-maps.
import * as THREE from 'three/webgpu'
import {
  Fn, uniform, vec2, vec3, vec4, float, texture, attribute, varying, positionLocal, positionWorld, normalLocal, normalWorld, uv,
  fract, floor, dot, mix, smoothstep, pow, max, min, clamp, abs, step, mod, fwidth, normalize, length, reflect, sin, select, If,
  modelWorldMatrix, cameraProjectionMatrix, cameraViewMatrix, Discard, instanceIndex,
} from 'three/tsl'
import { T, hash12, vnoise, fbm2, lin, skyLin, fogIt, lightIt, shadowAt } from './tsl-common.js'

const unlit = (opts = {}) => {
  const m = new THREE.MeshBasicNodeMaterial(opts)
  m.fog = false; m.lights = false
  return m
}

// ---------------- sky ----------------
export function skyMaterial() {
  const m = unlit({ side: THREE.BackSide, depthWrite: false })
  const dirV = varying(normalize(positionLocal))
  m.colorNode = Fn(() => {
    const d = normalize(dirV)
    const c = skyLin(d).toVar()
    const mu = dot(d, T.sunDir)
    c.addAssign(lin(T.sunColor).mul(T.sunI).mul(6.0).mul(smoothstep(0.99985, 0.99993, mu)).mul(T.night.oneMinus()))
    If(d.y.greaterThan(0.0).and(T.cloud.greaterThan(0.0)), () => {
      const cp = d.xz.div(d.y.add(0.08)).mul(0.9).add(vec2(T.time.mul(0.0015), 0.0))
      const cl = fbm2(cp.mul(1.2)).mul(0.7).add(fbm2(cp.mul(4.7)).mul(0.3))
      const cov = smoothstep(float(0.55).sub(T.cloud.mul(0.25)), 0.85, cl).mul(smoothstep(0.0, 0.18, d.y))
      const cc = lin(T.horizon).mul(1.1).add(lin(T.sunColor).mul(T.sunI).mul(0.18).mul(float(0.5).add(pow(max(mu, 0.0), 3.0).mul(0.5))))
      c.assign(mix(c, cc, cov.mul(0.75)))
    })
    If(T.night.greaterThan(0.0), () => {
      const sp = floor(d.xz.div(d.y.add(0.2)).mul(300.0))
      c.addAssign(vec3(step(0.997, hash12(sp)).mul(smoothstep(0.15, 0.6, d.y))).mul(T.night).mul(0.6))
    })
    return c
  })()
  // keep the dome at the far plane
  m.vertexNode = Fn(() => {
    const p = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix).mul(vec4(positionLocal, 1.0))
    return vec4(p.x, p.y, p.w.mul(0.99999), p.w)
  })()
  return m
}

// ---------------- ground ----------------
export const groundNodes = { canopy: null, ground: null }
export function groundMaterials(tu) {
  groundNodes.ground = texture(tu.uGround.value)
  groundNodes.canopy = texture(tu.uCanopy.value)
  const groundOrigin = uniform(tu.uGroundOrigin.value), groundSize = uniform(tu.uGroundSize.value)
  const nearMin = uniform(tu.uNearMin.value), nearMax = uniform(tu.uNearMax.value)
  const treeFar = uniform(tu.uTreeFar.value).onFrameUpdate(() => tu.uTreeFar.value)

  const mk = (isFar) => {
    const m = unlit()
    const skirt = attribute('aSkirt', 'float')
    m.positionNode = Fn(() => {
      const p = positionLocal.toVar()
      if (isFar) {
        const q = vec2(p.x, p.z.negate())
        If(q.x.greaterThan(nearMin.x.add(1)).and(q.x.lessThan(nearMax.x.sub(1))).and(q.y.greaterThan(nearMin.y.add(1))).and(q.y.lessThan(nearMax.y.sub(1))), () => {
          p.y.subAssign(60.0)
        })
      }
      p.y.subAssign(skirt.mul(4.0))
      return p
    })()
    const vN = varying(normalLocal)
    m.colorNode = Fn(() => {
      const W = positionWorld
      const q = vec2(W.x, W.z.negate())
      const guv = q.sub(groundOrigin).div(groundSize)
      const g = groundNodes.ground.sample(guv).rgb.toVar()
      const n = normalize(vN).toVar()
      const dist = length(W.sub(T.camPos))
      const slope = n.y.oneMinus()
      const n1 = fbm2(q.mul(0.018)), n2 = fbm2(q.mul(0.09)), n3 = vnoise(q.mul(0.7)), n4 = vnoise(q.mul(3.3)), n5 = vnoise(q.mul(11.0))
      const near = smoothstep(25.0, 140.0, dist).oneMinus()
      const dry = mix(vec3(0.47, 0.44, 0.34), vec3(0.55, 0.51, 0.39), n1).toVar()
      dry.assign(mix(dry, vec3(0.38, 0.41, 0.27), smoothstep(0.45, 0.8, n2).mul(0.65)))
      dry.assign(mix(dry, vec3(0.50, 0.42, 0.33), smoothstep(0.62, 0.82, n2.mul(0.5).add(n3.mul(0.5))).mul(0.55)))
      const lawn = mix(mix(vec3(0.27, 0.35, 0.17), vec3(0.33, 0.40, 0.20), n1), vec3(0.30, 0.36, 0.17), smoothstep(0.5, 0.85, n2).mul(0.5))
      const sand = mix(vec3(0.76, 0.69, 0.54), vec3(0.82, 0.75, 0.60), n3).mul(float(0.94).add(sin(q.x.mul(0.9).add(n2.mul(6.0))).mul(0.06)))
      const rock = mix(vec3(0.45, 0.41, 0.37), vec3(0.55, 0.50, 0.44), n3)
      const col = mix(dry, lawn, smoothstep(0.3, 0.7, g.r)).toVar()
      col.assign(mix(col, sand, smoothstep(0.3, 0.7, g.b)))
      col.assign(mix(col, rock, smoothstep(0.25, 0.5, slope).mul(g.r.mul(0.5).oneMinus())))
      col.mulAssign(mix(1.0, float(0.82).add(n4.mul(0.6).add(n5.mul(0.4)).mul(0.36)), near))
      If(near.greaterThan(0.0), () => {
        const e = 0.15
        const hx = vnoise(q.add(vec2(e, 0)).mul(3.3)).sub(n4), hz = vnoise(q.add(vec2(0, e)).mul(3.3)).sub(n4)
        n.assign(normalize(n.add(vec3(hx.negate(), 0.0, hz).mul(1.6).mul(near))))
      })
      const cp = groundNodes.canopy.sample(guv).toVar()
      const far = smoothstep(treeFar.mul(0.7), treeFar.mul(1.02), dist)
      const ao = float(1.0).sub(cp.a.mul(0.45).mul(far.oneMinus()))
      col.assign(mix(col, cp.rgb.mul(0.62), cp.a.mul(far).mul(0.95)))
      const sh = shadowAt(W, n)
      const c = lightIt(lin(col), n, ao, sh).toVar()
      const lake = smoothstep(0.45, 0.6, g.g).mul(step(0.2, W.y))
      If(lake.greaterThan(0.0), () => {
        const w = vec2(vnoise(q.mul(0.35).add(T.time.mul(0.12))), vnoise(q.mul(0.41).sub(T.time.mul(0.1)))).sub(0.5)
        const wn = normalize(vec3(w.x.mul(0.12), 1.0, w.y.mul(0.12)))
        const v = normalize(T.camPos.sub(W))
        const fres = float(0.02).add(pow(max(dot(wn, v), 0.0).oneMinus(), 5.0).mul(0.98))
        const body = lin(vec3(0.10, 0.17, 0.14)).mul(lin(T.skyAmb).mul(T.ambI).mul(0.6).add(lin(T.sunColor).mul(T.sunI).mul(0.15)))
        const wc = mix(body, skyLin(reflect(v.negate(), wn)), fres).add(lin(T.sunColor).mul(T.sunI).mul(pow(max(dot(reflect(T.sunDir.negate(), wn), v), 0.0), 200.0)).mul(2.0).mul(sh))
        c.assign(mix(c, wc, lake))
      })
      return fogIt(c, W)
    })()
    return m
  }
  return { near: mk(false), far: mk(true) }
}

// ---------------- ocean ----------------
export function oceanMaterial(tu) {
  const m = unlit()
  const hOrigin = uniform(tu.uHOrigin.value), hSize = uniform(tu.uHSize.value)
  const hTex = texture(tu.uHeight.value)
  const wave = (q) => {
    const t = T.time
    return vnoise(q.mul(0.045).add(vec2(t.mul(0.04), t.mul(0.025))))
      .add(vnoise(q.mul(0.13).sub(vec2(t.mul(0.09), t.mul(-0.05)))).mul(0.5))
      .add(vnoise(q.mul(0.41).add(vec2(t.mul(0.2), t.mul(0.15)))).mul(0.25))
  }
  m.colorNode = Fn(() => {
    const W = positionWorld
    const q = vec2(W.x, W.z.negate())
    const huv = q.sub(hOrigin).div(hSize)
    const inside = step(0.0, huv.x).mul(step(huv.x, 1.0)).mul(step(0.0, huv.y)).mul(step(huv.y, 1.0))
    const hs = hTex.sample(clamp(huv, 0.0, 1.0)).r.toVar()
    const depth = select(inside.greaterThan(0.5), hs.negate(), float(15.0))
    const dist = length(W.sub(T.camPos))
    const e = 0.6
    const a = wave(q)
    const d = vec2(wave(q.add(vec2(e, 0))).sub(a), wave(q.add(vec2(0, e))).sub(a)).mul(mix(2.2, 0.6, smoothstep(200.0, 3000.0, dist)))
    const n = normalize(vec3(d.x.negate(), 1.0, d.y))
    const v = normalize(T.camPos.sub(W))
    const fres = float(0.02).add(pow(max(dot(n, v), 0.0).oneMinus(), 5.0).mul(0.98))
    const body = mix(lin(vec3(0.16, 0.32, 0.30)), lin(vec3(0.03, 0.12, 0.15)), smoothstep(0.5, 10.0, depth))
      .mul(lin(T.skyAmb).mul(T.ambI).mul(0.55).add(lin(T.sunColor).mul(T.sunI).mul(0.12)))
    const c = mix(body, skyLin(reflect(v.negate(), n)), fres).toVar()
    c.addAssign(lin(T.sunColor).mul(T.sunI).mul(pow(max(dot(reflect(T.sunDir.negate(), n), v), 0.0), 350.0)).mul(6.0))
    const foam = smoothstep(0.0, float(1.6).add(d.x.mul(2.0)), depth).oneMinus().mul(step(0.0, depth)).mul(inside)
      .mul(smoothstep(0.35, 0.75, vnoise(q.mul(0.35).add(vec2(T.time.mul(0.3), 0.0))).mul(0.6).add(sin(T.time.mul(0.8).add(depth.mul(3.0))).mul(0.4))))
    c.assign(mix(c, lin(vec3(0.92, 0.93, 0.9)).mul(lin(T.skyAmb).mul(T.ambI).add(lin(T.sunColor).mul(T.sunI).mul(max(T.sunDir.y, 0.0)))), clamp(foam, 0.0, 1.0).mul(0.85)))
    return fogIt(c, W)
  })()
  return m
}

// ---------------- roads ----------------
export function roadMaterial() {
  const m = unlit({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  const aUV = attribute('aUV', 'vec2'), aCol = attribute('aCol', 'vec3'), aFlags = attribute('aFlags', 'vec2')
  m.colorNode = Fn(() => {
    const W = positionWorld
    const vUV = varying(aUV), vCol = varying(aCol), vFlags = varying(aFlags)
    const q = vec2(W.x, W.z.negate())
    const dist = length(W.sub(T.camPos))
    const near = smoothstep(30.0, 160.0, dist).oneMinus()
    const n1 = vnoise(q.mul(0.08)), n2 = vnoise(q.mul(0.9)), n3 = vnoise(q.mul(23.0)).mul(0.6).add(hash12(floor(q.mul(40.0))).mul(0.4))
    const mk = floor(vFlags.x.div(1000.0)), hw = max(mod(vFlags.x, 1000.0), 0.5)
    const am = abs(vUV.y).mul(hw)
    const a = abs(vUV.y)
    const c = vec3(vCol).toVar()
    const surf = vFlags.y
    const fw = max(fwidth(am), 0.002).toVar()
    const jw = fwidth(vUV.x.div(1.6)).toVar()
    If(surf.lessThan(0.5), () => {
      c.mulAssign(float(0.86).add(n1.mul(0.22)))
      c.assign(mix(c, c.mul(1.22), smoothstep(0.55, 0.8, n2.mul(0.7).add(n1.mul(0.3))).mul(0.5)))
      c.mulAssign(mix(1.0, float(0.9).add(n3.mul(0.2)), near))
      const wheel = smoothstep(0.18, 0.32, a).mul(smoothstep(0.42, 0.6, a).oneMinus())
      c.mulAssign(float(1.0).add(wheel.mul(0.06)))
      c.assign(mix(c, c.mul(0.8), smoothstep(0.9, 1.0, a)))
      If(mk.greaterThan(0.5), () => {
        const y1 = smoothstep(0.05, fw.add(0.05), abs(am.sub(0.12))).oneMinus()
        c.assign(mix(c, vec3(0.74, 0.58, 0.20).mul(float(0.85).add(n3.mul(0.15))), y1.mul(float(1.0).sub(smoothstep(60.0, 300.0, dist).mul(0.5)))))
        If(mk.greaterThan(1.5), () => {
          const lane = smoothstep(0.06, fw.add(0.06), abs(am.sub(hw.mul(0.5)))).oneMinus().mul(step(fract(vUV.x.div(12.0)), 0.3))
          c.assign(mix(c, vec3(0.82), lane))
        })
      })
    }).ElseIf(surf.lessThan(1.5), () => {
      c.mulAssign(float(0.85).add(n2.mul(0.25))); c.mulAssign(mix(1.0, float(0.85).add(n3.mul(0.3)), near))
      c.assign(mix(c, c.mul(0.85), smoothstep(0.6, 1.0, a)))
    }).ElseIf(surf.lessThan(2.5), () => {
      c.mulAssign(float(0.9).add(n2.mul(0.15)))
      c.mulAssign(select(fract(vUV.x.div(0.6)).lessThan(0.06), float(0.75), float(1.0)))
    }).Else(() => {
      c.mulAssign(float(0.9).add(n1.mul(0.12))); c.mulAssign(mix(1.0, float(0.92).add(n3.mul(0.14)), near))
      const fx = fract(vUV.x.div(1.6))
      const joint = smoothstep(0.0, max(jw.mul(1.5), 0.01), min(fx, fx.oneMinus())).oneMinus()
      c.mulAssign(float(1.0).sub(joint.mul(0.22).mul(smoothstep(40.0, 200.0, dist).oneMinus())))
      c.assign(mix(c, c.mul(1.12), smoothstep(0.85, 0.97, a.oneMinus())))
    })
    const n = vec3(0, 1, 0)
    const sh = shadowAt(W, n)
    return fogIt(lightIt(lin(c), n, 0.95, sh), W)
  })()
  return m
}

// ---------------- buildings ----------------
export function buildingMaterials() {
  const m = unlit({ side: THREE.DoubleSide })
  const aWall = attribute('aWall', 'vec3'), aCol = attribute('aCol', 'vec3'), aSeed = attribute('aSeed', 'float')
  const vN = varying(normalLocal), vWall = varying(aWall), vCol = varying(aCol), vSeed = varying(aSeed)
  m.colorNode = Fn(() => {
    const W = positionWorld
    const n = normalize(vN).toVar()
    const v = normalize(T.camPos.sub(W))
    If(dot(n, v).lessThan(0.0), () => { n.assign(n.negate()) })
    const dist = length(W.sub(T.camPos))
    const q = vec2(W.x, W.z.negate())
    const alb = vec3(0).toVar(), glass = float(0).toVar()
    If(vWall.z.greaterThan(0.5), () => {
      alb.assign(vCol.mul(float(0.85).add(vnoise(q.mul(0.7)).mul(0.25))).mul(float(0.9).add(vnoise(q.mul(6.0)).mul(0.15))))
    }).Else(() => {
      const wp = vec2(vWall.x, vWall.y)
      const stucco = vnoise(wp.mul(1.7)).mul(0.5).add(vnoise(wp.mul(9.0)).mul(0.5))
      alb.assign(vCol.mul(float(0.9).add(stucco.mul(0.12))).mul(float(0.96).add(vnoise(vec2(vWall.x.mul(0.15), vWall.y.mul(0.3))).mul(0.06))))
      const aaf = smoothstep(150.0, 480.0, dist).oneMinus()
      const fy = vWall.y.sub(0.6), ly = fract(fy.div(3.2)).mul(3.2)
      const bay = float(2.6).add(fract(vSeed.mul(7.3)).mul(0.6))
      const lx = fract(vWall.x.div(bay).add(vSeed)).sub(0.5).mul(bay)
      const ww = float(0.55).add(fract(vSeed.mul(3.1)).mul(0.15))
      const inX = step(abs(lx), ww), inY = step(0.8, ly).mul(step(ly, 2.45))
      const frameX = step(abs(lx), ww.add(0.09)), frameY = step(0.72, ly).mul(step(ly, 2.53))
      const above = step(0.0, fy)
      const frame = frameX.mul(frameY).mul(inX.mul(inY).oneMinus()).mul(above).mul(aaf)
      alb.assign(mix(alb, vec3(0.93, 0.92, 0.88), frame.mul(0.85)))
      const sill = step(abs(lx), ww.add(0.16)).mul(step(0.62, ly)).mul(step(ly, 0.72)).mul(above).mul(aaf)
      alb.assign(mix(alb, alb.mul(0.72), sill))
      glass.assign(inX.mul(inY).mul(above).mul(aaf).mul(step(0.04, abs(lx))))
      alb.mulAssign(float(1.0).sub(smoothstep(0.0, 0.6, vWall.y).oneMinus().mul(0.18)))
    })
    const sh = shadowAt(W, n)
    const ao = float(0.75).add(smoothstep(0.0, 4.0, vWall.y.add(vWall.z.mul(10.0))).mul(0.25))
    const c = lightIt(lin(alb), n, ao, sh).toVar()
    If(glass.greaterThan(0.0), () => {
      const fres = float(0.04).add(pow(max(dot(n, v), 0.0).oneMinus(), 5.0).mul(0.96))
      const inside = lin(vec3(0.10, 0.11, 0.12)).mul(float(0.6).add(hash12(floor(vec2(vWall.x.div(2.7), vWall.y.div(3.2))).add(vSeed.mul(13.0))).mul(0.8)))
      const g = mix(inside, skyLin(reflect(v.negate(), n)).mul(0.8), fres.mul(0.85).add(0.12)).toVar()
      g.addAssign(lin(T.sunColor).mul(T.sunI).mul(pow(max(dot(reflect(T.sunDir.negate(), n), v), 0.0), 300.0)).mul(3.0).mul(sh))
      c.assign(mix(c, g, glass))
    })
    return fogIt(c, W)
  })()
  const depth = unlit({ side: THREE.DoubleSide })
  depth.colorNode = vec3(1)
  return { material: m, depth }
}

// ---------------- markers (selection ring, search beacons) ----------------
export function ringMaterial() {
  const m = unlit({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  m.colorNode = vec3(1.0, 0.75, 0.35).mul(float(0.55).add(sin(T.time.mul(3.0)).mul(0.45))).mul(2.0)
  return m
}
export function beaconMaterial() {
  const m = unlit({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  const y = varying(attribute('position', 'vec3').y)
  m.colorNode = vec3(1.0, 0.78, 0.35).mul(y.oneMinus().mul(float(0.35).add(sin(T.time.mul(2.0).add(y.mul(6.0))).mul(0.15)))).mul(2.0)
  return m
}
