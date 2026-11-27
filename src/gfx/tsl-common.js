// TSL (three.js shading language) versions of the shared lighting model, for the WebGPU engine.
// Mirrors src/shaders.js so both engines light the city the same way: linear HDR, analytic sky,
// height fog, hemispheric ambient + sun. Tone mapping happens once, in the post chain.
import * as THREE from 'three/webgpu'
import {
  Fn, uniform, vec2, vec3, vec4, float, texture, fract, floor, dot, mix, smoothstep, pow, max, min, clamp, abs, exp,
  normalize, length, select, If, sin,
} from 'three/tsl'
import { U } from '../shaders.js'

// ---- uniforms bound to the shared U object (colours/vectors by reference, numbers per frame) ----
const num = k => uniform(U[k].value).onFrameUpdate(() => U[k].value)
export const T = {
  time: num('uTime'),
  sunDir: uniform(U.uSunDir.value),
  sunColor: uniform(U.uSunColor.value),
  sunI: num('uSunI'),
  skyAmb: uniform(U.uSkyAmb.value),
  groundAmb: uniform(U.uGroundAmb.value),
  ambI: num('uAmbI'),
  zenith: uniform(U.uZenith.value),
  horizon: uniform(U.uHorizon.value),
  haze: num('uHaze'),
  fogDensity: num('uFogDensity'),
  fogFalloff: num('uFogFalloff'),
  exposure: num('uExposure'),
  camPos: uniform(U.uCamPos.value),
  night: num('uNight'),
  cloud: num('uCloud'),
}

export const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
  p3.addAssign(dot(p3, p3.yzx.add(33.33)))
  return fract(p3.x.add(p3.y).mul(p3.z))
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

export const vnoise = Fn(([p]) => {
  const i = floor(p), f = fract(p)
  const u = f.mul(f).mul(f.mul(-2).add(3))
  return mix(mix(hash12(i), hash12(i.add(vec2(1, 0))), u.x), mix(hash12(i.add(vec2(0, 1))), hash12(i.add(vec2(1, 1))), u.x), u.y)
}).setLayout({ name: 'vnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

export const fbm2 = Fn(([p]) => vnoise(p).mul(0.5).add(vnoise(p.mul(2.03).add(7.1)).mul(0.3)).add(vnoise(p.mul(4.11).sub(3.7)).mul(0.2)))
  .setLayout({ name: 'fbm2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

export const lin = c => pow(max(c, 0), vec3(2.2))

// linear colours of the light rig, computed once per shader invocation site
export const L = {
  sun: () => lin(T.sunColor).mul(T.sunI),
  sunCol: () => lin(T.sunColor),
}

export const skyLin = Fn(([d]) => {
  const h = clamp(d.y, -0.2, 1.0)
  const mu = max(dot(d, T.sunDir), 0.0)
  const zen = lin(T.zenith), hor = lin(T.horizon)
  const c = mix(hor, zen, pow(smoothstep(-0.02, 1.0, h), 0.42)).toVar()
  c.addAssign(lin(T.sunColor).mul(pow(mu, 6.0).mul(0.35).mul(T.haze).add(pow(mu, 48.0).mul(0.6).mul(T.haze)).add(pow(mu, 400.0).mul(1.2))))
  c.mulAssign(float(1.0).add(float(0.6).mul(float(1.0).sub(smoothstep(0.0, 0.25, abs(h)))).mul(T.haze)))
  c.assign(mix(c, hor.mul(0.75), float(1.0).sub(smoothstep(-0.12, 0.0, d.y))))
  return c.mul(1.25).mul(float(1.0).sub(T.night.mul(0.75)))
})

export const fogIt = Fn(([c, wpos]) => {
  const v = wpos.sub(T.camPos)
  const dist = length(v)
  const dir = v.div(max(dist, 1e-3))
  const k = T.fogFalloff
  const h0 = max(T.camPos.y, -5.0)
  const x = v.y.mul(k)
  const integ = select(abs(x).greaterThan(1e-3), float(1.0).sub(exp(x.negate())).div(x), float(1.0))
  const amt = float(1.0).sub(exp(T.fogDensity.negate().mul(exp(h0.negate().mul(k))).mul(dist).mul(integ)))
  const sd = normalize(vec3(dir.x, max(dir.y, 0.02), dir.z))
  return mix(c, skyLin(sd).mul(0.92), clamp(amt, 0.0, 1.0))
})

export const lightIt = Fn(([alb, n, ao, sh]) => {
  const ndl = max(dot(n, T.sunDir), 0.0)
  const sun = lin(T.sunColor).mul(T.sunI).mul(ndl).mul(sh)
  const up = n.y.mul(0.5).add(0.5)
  const amb = lin(T.skyAmb).mul(up).add(lin(T.groundAmb).mul(float(1.0).sub(up)).mul(0.6)).mul(T.ambI)
  return alb.mul(sun.add(amb.mul(ao)))
})

// ---- cascaded sun shadows (filled in by gfx/shadows.js) ----
export const CSM = {
  cascades: [],   // { matrix: uniform(mat4), texel: uniform(float), tex: DepthTexture, extent }
  on: uniform(0),
  taps: 9,
}
export function registerCascades(list) { CSM.cascades = list }

// shadow factor at a world position with surface normal n; nearest cascade that contains the point wins.
// Every lookup is unconditional (WGSL needs uniform control flow around texture sampling); selects pick the result.
export function shadowAt(wpos, n) {
  return Fn(() => {
    const ndl = dot(n, T.sunDir)
    let res = float(1.0)
    // walk cascades from far to near so the nearest containing cascade ends up selected
    for (let ci = CSM.cascades.length - 1; ci >= 0; ci--) {
      const c = CSM.cascades[ci]
      const texW = c.texel.mul(c.extent * 2)
      const off = n.mul(texW).mul(float(1.5).add(float(2.5).mul(float(1.0).sub(clamp(abs(ndl), 0.0, 1.0))))).add(T.sunDir.mul(texW).mul(0.5))
      const sp = c.matrix.mul(vec4(wpos.add(off), 1.0))
      const ndc = sp.xyz.div(sp.w).toVar()
      const uv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(0.5).add(0.5).oneMinus()).toVar()
      const inside = uv.x.greaterThan(0.002).and(uv.x.lessThan(0.998)).and(uv.y.greaterThan(0.002)).and(uv.y.lessThan(0.998)).and(ndc.z.lessThan(1.0))
      const ref = ndc.z.sub(ci === 0 ? 0.0002 : 0.0004)
      const r = ci === 0 && CSM.taps >= 9 ? 1 : 0
      let s = float(0), k = 0
      const cuv = clamp(uv, 0.0, 1.0)
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        s = s.add(texture(c.tex, cuv.add(vec2(i, j).mul(c.texel).mul(1.1))).compare(ref)); k++
      }
      let v = s.div(k).toVar()
      if (ci === CSM.cascades.length - 1) {
        const edge = smoothstep(0.0, 0.06, min(min(uv.x, uv.x.oneMinus()), min(uv.y, uv.y.oneMinus())))
        v = mix(1.0, v, edge)
      }
      res = select(inside, v, res)
    }
    res = select(ndl.lessThanEqual(0.0), float(0.0), res)
    return select(CSM.on.greaterThan(0.5), res, float(1.0))
  })()
}

// ACES filmic (same fit as the WebGL engine) + exposure + sRGB encode
export const finish = Fn(([c]) => {
  const x = c.mul(T.exposure)
  const m = clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0)
  return pow(m, vec3(1.0 / 2.2))
})

export { THREE }
