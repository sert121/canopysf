import * as THREE from 'three'
import { U, COMMON } from '../shaders.js'
import { ENGINE } from '../gfx/engine.js'
import { skyMaterial } from '../gfx/materials.js'

// Physically-plausible light rigs. sun = direction in three space (x east, y up, z south).
export const PRESETS = {
  day: {
    label: 'Afternoon', sun: [-0.45, 0.62, 0.55], sunColor: '#fff3e2', sunI: 3.4, sky: '#9fbbe0', ground: '#8c7d68', ambI: 0.95,
    zenith: '#2f62a6', horizon: '#c2d5e6', haze: 0.35, density: 0.00016, falloff: 0.0022, exposure: 0.95, cloud: 0.35, night: 0,
  },
  golden: {
    label: 'Golden hour', sun: [-0.86, 0.13, 0.42], sunColor: '#ffbd7a', sunI: 3.0, sky: '#8ea3c8', ground: '#8a6a52', ambI: 0.75,
    zenith: '#35598f', horizon: '#f0b98e', haze: 0.8, density: 0.00026, falloff: 0.003, exposure: 1.15, cloud: 0.3, night: 0,
  },
  karl: {
    label: 'Karl the Fog', sun: [-0.3, 0.55, 0.5], sunColor: '#dfe2e4', sunI: 0.55, sky: '#c2c9ce', ground: '#8f8d86', ambI: 1.35,
    zenith: '#a9b4bb', horizon: '#d3d8da', haze: 0.2, density: 0.0065, falloff: 0.0035, exposure: 1.0, cloud: 0.0, night: 0,
  },
  dusk: {
    label: 'Blue hour', sun: [-0.9, 0.02, 0.2], sunColor: '#ff9a6a', sunI: 0.6, sky: '#5d6d9a', ground: '#3f3a44', ambI: 0.55,
    zenith: '#1c2b52', horizon: '#c98a7d', haze: 0.9, density: 0.0003, falloff: 0.003, exposure: 1.5, cloud: 0.2, night: 0.5,
  },
}
export const PRESET_ORDER = ['day', 'golden', 'karl', 'dusk']

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`
const skyFrag = /* glsl */`
${COMMON}
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = skyLin(d);
  // sun disc
  float mu = dot(d, uSunDir);
  c += lin(uSunColor) * uSunI * 6.0 * smoothstep(0.99985, 0.99993, mu) * (1.0 - uNight);
  // soft high clouds, lit by the sun
  if (d.y > 0.0 && uCloud > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 0.9 + vec2(uTime * 0.0015, 0.0);
    float cl = fbm2(cp * 1.2) * 0.7 + fbm2(cp * 4.7) * 0.3;
    cl = smoothstep(0.55 - uCloud * 0.25, 0.85, cl) * smoothstep(0.0, 0.18, d.y);
    vec3 cc = lin(uHorizon) * 1.1 + lin(uSunColor) * uSunI * 0.18 * (0.5 + 0.5 * pow(max(mu, 0.0), 3.0));
    c = mix(c, cc, cl * 0.75);
  }
  if (uNight > 0.0) {
    vec2 sp = floor(d.xz / (d.y + 0.2) * 300.0);
    c += vec3(step(0.997, hash12(sp)) * smoothstep(0.15, 0.6, d.y)) * uNight * 0.6;
  }
  gl_FragColor = vec4(finish(c), 1.0);
}`

let skyMesh
export function initSky(scene) {
  const g = new THREE.SphereGeometry(1000, 48, 24)
  const m = ENGINE.gpu ? skyMaterial() : new THREE.ShaderMaterial({ uniforms: U, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false })
  skyMesh = new THREE.Mesh(g, m); skyMesh.frustumCulled = false; skyMesh.renderOrder = -10
  scene.add(skyMesh)
  return skyMesh
}
export function followSky(cam) { if (skyMesh) skyMesh.position.copy(cam.position) }

const KEYS = ['sunColor', 'sky', 'ground', 'zenith', 'horizon']
const UMAP = { sunColor: 'uSunColor', sky: 'uSkyAmb', ground: 'uGroundAmb', zenith: 'uZenith', horizon: 'uHorizon' }
const NUM = { sunI: 'uSunI', ambI: 'uAmbI', haze: 'uHaze', density: 'uFogDensity', falloff: 'uFogFalloff', exposure: 'uExposure', cloud: 'uCloud', night: 'uNight' }
let from = null, target = null, t = 1
const snap = () => {
  const o = { sun: U.uSunDir.value.clone() }
  for (const k of KEYS) o[k] = U[UMAP[k]].value.clone()
  for (const k in NUM) o[k] = U[NUM[k]].value
  return o
}
const asTarget = p => {
  const o = { sun: new THREE.Vector3(...p.sun).normalize() }
  for (const k of KEYS) o[k] = new THREE.Color(p[k])
  for (const k in NUM) o[k] = p[k]
  return o
}
function apply(k) {
  U.uSunDir.value.copy(from.sun).lerp(target.sun, k).normalize()
  for (const key of KEYS) U[UMAP[key]].value.copy(from[key]).lerp(target[key], k)
  for (const key in NUM) U[NUM[key]].value = from[key] + (target[key] - from[key]) * k
}
export function setPreset(name, instant = false) {
  const p = PRESETS[name]; if (!p) return
  target = asTarget(p)
  if (instant) { from = target; t = 1; apply(1) } else { from = snap(); t = 0 }
}
export function tickSky(dt) {
  if (!target || t >= 1) return
  t = Math.min(1, t + dt / 2.5)
  apply(t * t * (3 - 2 * t))
}
