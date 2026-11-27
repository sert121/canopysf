import * as THREE from 'three'
import { D, heightAt } from '../data.js'
import { U, COMMON } from '../shaders.js'
import { ENGINE } from '../gfx/engine.js'
import { groundMaterials, oceanMaterial, groundNodes } from '../gfx/materials.js'

// Terrain: a coarse whole-city mesh + detailed chunks streamed around the player.
// Ground is painted in-shader: golden grass on open land, greener parks, sand, rock on steep slopes, lakes.

const NEAR_SEG = 50 // 10 m
let groundTex, heightTex
export const terrainUniforms = {
  uGround: { value: null }, uHeight: { value: null },
  uGroundOrigin: { value: new THREE.Vector2() }, uGroundSize: { value: new THREE.Vector2() },
  uHOrigin: { value: new THREE.Vector2() }, uHSize: { value: new THREE.Vector2() },
  uNearMin: { value: new THREE.Vector2(1e9, 1e9) }, uNearMax: { value: new THREE.Vector2(-1e9, -1e9) },
  uCanopy: { value: null }, uTreeFar: { value: 1150 },
}

const groundVert = /* glsl */`
${COMMON}
attribute float aSkirt;
uniform vec2 uNearMin; uniform vec2 uNearMax; uniform float uIsFar;
varying vec3 vW; varying vec3 vN;
void main(){
  vec3 p = position;
  if (uIsFar > 0.5) {
    vec2 q = vec2(p.x, -p.z);
    if (q.x > uNearMin.x + 1.0 && q.x < uNearMax.x - 1.0 && q.y > uNearMin.y + 1.0 && q.y < uNearMax.y - 1.0) p.y -= 60.0;
  }
  p.y -= aSkirt * 4.0;
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  vN = normalize(normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`

const groundFrag = /* glsl */`
${COMMON}
uniform sampler2D uGround; uniform sampler2D uCanopy; uniform vec2 uGroundOrigin; uniform vec2 uGroundSize; uniform float uTreeFar;
varying vec3 vW; varying vec3 vN;
void main(){
  vec2 q = vec2(vW.x, -vW.z);
  vec2 guv = (q - uGroundOrigin) / uGroundSize;
  vec3 g = texture2D(uGround, guv).rgb; // r park, g water, b sand
  vec3 n = normalize(vN);
  float dist = length(vW - uCamPos);
  float slope = 1.0 - n.y;
  float n1 = fbm2(q * 0.018), n2 = fbm2(q * 0.09), n3 = vnoise(q * 0.7), n4 = vnoise(q * 3.3), n5 = vnoise(q * 11.0);
  float near = 1.0 - smoothstep(25.0, 140.0, dist);
  // open ground: dry California grass, greener in hollows, patches of bare soil
  vec3 dry = mix(vec3(0.47, 0.44, 0.34), vec3(0.55, 0.51, 0.39), n1);
  dry = mix(dry, vec3(0.38, 0.41, 0.27), smoothstep(0.45, 0.8, n2) * 0.65);
  dry = mix(dry, vec3(0.50, 0.42, 0.33), smoothstep(0.62, 0.82, n2 * 0.5 + n3 * 0.5) * 0.55);
  // irrigated park lawns
  vec3 lawn = mix(vec3(0.27, 0.35, 0.17), vec3(0.33, 0.40, 0.20), n1);
  lawn = mix(lawn, vec3(0.30, 0.36, 0.17), smoothstep(0.5, 0.85, n2) * 0.5);
  vec3 sand = mix(vec3(0.76, 0.69, 0.54), vec3(0.82, 0.75, 0.60), n3) * (0.94 + 0.06 * sin(q.x * 0.9 + n2 * 6.0));
  vec3 rock = mix(vec3(0.45, 0.41, 0.37), vec3(0.55, 0.50, 0.44), n3);
  vec3 col = mix(dry, lawn, smoothstep(0.3, 0.7, g.r));
  col = mix(col, sand, smoothstep(0.3, 0.7, g.b));
  col = mix(col, rock, smoothstep(0.25, 0.5, slope) * (1.0 - g.r * 0.5));
  // fine grain up close
  col *= mix(1.0, 0.82 + 0.36 * (n4 * 0.6 + n5 * 0.4), near);
  // micro-normal from the grain so grass and soil catch the light
  if (near > 0.0) {
    float e = 0.15;
    float hx = vnoise((q + vec2(e, 0.0)) * 3.3) - n4, hz = vnoise((q + vec2(0.0, e)) * 3.3) - n4;
    n = normalize(n + vec3(-hx, 0.0, hz) * 1.6 * near);
  }
  // canopy: contact darkening under trees; seen from afar, the canopy itself
  vec4 cp = texture2D(uCanopy, guv);
  float far = smoothstep(uTreeFar * 0.7, uTreeFar * 1.02, dist);
  float ao = 1.0 - cp.a * 0.45 * (1.0 - far);
  col = mix(col, cp.rgb * 0.62, cp.a * far * 0.95);
  float sh = shadowAt(vW, n);
  vec3 c = lightIt(lin(col), n, ao, sh);
  // lakes
  float lake = smoothstep(0.45, 0.6, g.g) * step(0.2, vW.y);
  if (lake > 0.0) {
    vec2 w = vec2(vnoise(q * 0.35 + uTime * 0.12), vnoise(q * 0.41 - uTime * 0.1)) - 0.5;
    vec3 wn = normalize(vec3(w.x * 0.12, 1.0, w.y * 0.12));
    vec3 v = normalize(uCamPos - vW);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, v), 0.0), 5.0);
    vec3 body = lin(vec3(0.10, 0.17, 0.14)) * (lin(uSkyAmb) * uAmbI * 0.6 + lin(uSunColor) * uSunI * 0.15);
    vec3 wc = mix(body, skyLin(reflect(-v, wn)), fres) + lin(uSunColor) * uSunI * pow(max(dot(reflect(-uSunDir, wn), v), 0.0), 200.0) * 2.0 * sh;
    c = mix(c, wc, lake);
  }
  gl_FragColor = vec4(finish(fogIt(c, vW)), 1.0);
}`

const oceanVert = /* glsl */`
${COMMON}
varying vec3 vW;
void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`
const oceanFrag = /* glsl */`
${COMMON}
uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform vec2 uHSize;
varying vec3 vW;
vec2 waveN(vec2 q){
  float e = 0.6;
  float a = vnoise(q * 0.045 + vec2(uTime * 0.04, uTime * 0.025)) + 0.5 * vnoise(q * 0.13 - vec2(uTime * 0.09, -uTime * 0.05)) + 0.25 * vnoise(q * 0.41 + vec2(uTime * 0.2, uTime * 0.15));
  float bx = vnoise((q + vec2(e, 0.0)) * 0.045 + vec2(uTime * 0.04, uTime * 0.025)) + 0.5 * vnoise((q + vec2(e, 0.0)) * 0.13 - vec2(uTime * 0.09, -uTime * 0.05)) + 0.25 * vnoise((q + vec2(e, 0.0)) * 0.41 + vec2(uTime * 0.2, uTime * 0.15));
  float bz = vnoise((q + vec2(0.0, e)) * 0.045 + vec2(uTime * 0.04, uTime * 0.025)) + 0.5 * vnoise((q + vec2(0.0, e)) * 0.13 - vec2(uTime * 0.09, -uTime * 0.05)) + 0.25 * vnoise((q + vec2(0.0, e)) * 0.41 + vec2(uTime * 0.2, uTime * 0.15));
  return vec2(bx - a, bz - a);
}
void main(){
  vec2 q = vec2(vW.x, -vW.z);
  vec2 uv = (q - uHOrigin) / uHSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float depth = inside > 0.5 ? -texture2D(uHeight, uv).r : 15.0;
  float dist = length(vW - uCamPos);
  vec2 d = waveN(q) * mix(2.2, 0.6, smoothstep(200.0, 3000.0, dist));
  vec3 n = normalize(vec3(-d.x, 1.0, d.y));
  vec3 v = normalize(uCamPos - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 deep = lin(vec3(0.03, 0.12, 0.15)), shallow = lin(vec3(0.16, 0.32, 0.30));
  vec3 body = mix(shallow, deep, smoothstep(0.5, 10.0, depth)) * (lin(uSkyAmb) * uAmbI * 0.55 + lin(uSunColor) * uSunI * 0.12);
  vec3 refl = skyLin(reflect(-v, n));
  vec3 c = mix(body, refl, fres);
  c += lin(uSunColor) * uSunI * pow(max(dot(reflect(-uSunDir, n), v), 0.0), 350.0) * 6.0;
  // breaking surf along the shore
  float foam = (1.0 - smoothstep(0.0, 1.6 + d.x * 2.0, depth)) * step(0.0, depth) * inside;
  foam *= smoothstep(0.35, 0.75, vnoise(q * 0.35 + vec2(uTime * 0.3, 0.0)) * 0.6 + 0.4 * sin(uTime * 0.8 + depth * 3.0));
  c = mix(c, lin(vec3(0.92, 0.93, 0.9)) * (lin(uSkyAmb) * uAmbI + lin(uSunColor) * uSunI * max(uSunDir.y, 0.0)), clamp(foam, 0.0, 1.0) * 0.85);
  gl_FragColor = vec4(finish(fogIt(c, vW)), 1.0);
}`

let groundMatNear, groundMatFar
const near = new Map() // key -> mesh
let scene

export function initTerrain(sc) {
  scene = sc
  const w = D.world
  groundTex = new THREE.Texture(D.groundImg)
  groundTex.flipY = true; groundTex.minFilter = THREE.LinearMipmapLinearFilter; groundTex.magFilter = THREE.LinearFilter
  groundTex.generateMipmaps = true; groundTex.needsUpdate = true
  terrainUniforms.uGround.value = groundTex
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true
  if (!terrainUniforms.uCanopy.value) terrainUniforms.uCanopy.value = blank
  terrainUniforms.uGroundOrigin.value.set(w.mx0 - w.mres / 2, w.my0 - w.mres / 2)
  terrainUniforms.uGroundSize.value.set(w.mnx * w.mres, w.mny * w.mres)
  heightTex = new THREE.DataTexture(D.H, w.gnx, w.gny, THREE.RedFormat, THREE.FloatType)
  heightTex.minFilter = heightTex.magFilter = ENGINE.gpu ? THREE.NearestFilter : THREE.LinearFilter; heightTex.needsUpdate = true
  terrainUniforms.uHeight.value = heightTex
  terrainUniforms.uHOrigin.value.set(w.gx0 - w.gres / 2, w.gy0 - w.gres / 2)
  terrainUniforms.uHSize.value.set(w.gnx * w.gres, w.gny * w.gres)

  const mk = (far) => new THREE.ShaderMaterial({
    uniforms: { ...U, ...terrainUniforms, uIsFar: { value: far ? 1 : 0 } },
    vertexShader: groundVert, fragmentShader: groundFrag,
  })
  if (ENGINE.gpu) { const g = groundMaterials(terrainUniforms); groundMatNear = g.near; groundMatFar = g.far } else { groundMatNear = mk(false); groundMatFar = mk(true) }

  // far mesh, 25 m grid aligned with 500 m chunk boundaries
  const step = 25
  const x0 = Math.ceil(w.gx0 / 500) * 500, y0 = Math.ceil(w.gy0 / 500) * 500
  const x1 = Math.floor((w.gx0 + (w.gnx - 1) * w.gres) / 500) * 500, y1 = Math.floor((w.gy0 + (w.gny - 1) * w.gres) / 500) * 500
  const nx = (x1 - x0) / step + 1, ny = (y1 - y0) / step + 1
  const geo = gridGeometry(x0, y0, nx, ny, step, false)
  const far = new THREE.Mesh(geo, groundMatFar)
  far.frustumCulled = false
  scene.add(far)

  // ocean
  const og = new THREE.PlaneGeometry(80000, 80000, 1, 1); og.rotateX(-Math.PI / 2)
  const om = ENGINE.gpu ? oceanMaterial(terrainUniforms) : new THREE.ShaderMaterial({ uniforms: { ...U, ...terrainUniforms }, vertexShader: oceanVert, fragmentShader: oceanFrag })
  const ocean = new THREE.Mesh(og, om); ocean.position.y = 0.0; ocean.renderOrder = -1
  scene.add(ocean)
}

function gridGeometry(x0, y0, nx, ny, step, skirt) {
  const extra = skirt ? 4 * (nx) : 0
  const N = nx * ny
  const pos = new Float32Array((N + (skirt ? 2 * nx + 2 * ny : 0)) * 3)
  const nor = new Float32Array(pos.length)
  const sk = new Float32Array(pos.length / 3)
  let k = 0
  const put = (x, y, s) => {
    const h = heightAt(x, y)
    const e = 3
    const hx = heightAt(x + e, y) - heightAt(x - e, y), hy = heightAt(x, y + e) - heightAt(x, y - e)
    // world (x, h, -y); normal in three space
    const nxv = -hx / (2 * e), nzv = hy / (2 * e)
    const l = Math.hypot(nxv, 1, nzv)
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -y
    nor[k * 3] = nxv / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nzv / l
    sk[k] = s; k++
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) put(x0 + i * step, y0 + j * step, 0)
  const idx = []
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
    idx.push(a, b, c, b, d, c)
  }
  if (skirt) {
    const ring = []
    for (let i = 0; i < nx; i++) ring.push(i)
    for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1)
    for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i)
    for (let j = ny - 2; j > 0; j--) ring.push(j * nx)
    const base = k
    for (const r of ring) { pos[k * 3] = pos[r * 3]; pos[k * 3 + 1] = pos[r * 3 + 1]; pos[k * 3 + 2] = pos[r * 3 + 2]; nor[k * 3 + 1] = 1; sk[k] = 1; k++ }
    for (let t = 0; t < ring.length; t++) {
      const a = ring[t], b = ring[(t + 1) % ring.length], a2 = base + t, b2 = base + (t + 1) % ring.length
      idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3))
  g.setAttribute('aSkirt', new THREE.BufferAttribute(sk.subarray(0, k), 1))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

export function updateTerrain(px, py, radiusChunks = 2) {
  const C = 500
  const cx = Math.floor(px / C), cy = Math.floor(py / C)
  const want = new Set()
  for (let j = -radiusChunks; j <= radiusChunks; j++) for (let i = -radiusChunks; i <= radiusChunks; i++) {
    const key = (cx + i) + '_' + (cy + j)
    want.add(key)
    if (!near.has(key)) {
      const x0 = (cx + i) * C, y0 = (cy + j) * C
      const w = D.world
      if (x0 < w.gx0 || y0 < w.gy0 || x0 + C > w.gx0 + (w.gnx - 1) * w.gres || y0 + C > w.gy0 + (w.gny - 1) * w.gres) continue
      const g = gridGeometry(x0, y0, NEAR_SEG + 1, NEAR_SEG + 1, C / NEAR_SEG, true)
      const m = new THREE.Mesh(g, groundMatNear)
      scene.add(m); near.set(key, m)
    }
  }
  for (const [k, m] of near) if (!want.has(k)) { scene.remove(m); m.geometry.dispose(); near.delete(k) }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const k of near.keys()) {
    const [a, b] = k.split('_').map(Number)
    x0 = Math.min(x0, a * C); y0 = Math.min(y0, b * C); x1 = Math.max(x1, (a + 1) * C); y1 = Math.max(y1, (b + 1) * C)
  }
  terrainUniforms.uNearMin.value.set(x0, y0)
  terrainUniforms.uNearMax.value.set(x1, y1)
}

export function setCanopy(tex) { terrainUniforms.uCanopy.value = tex; if (groundNodes.canopy) groundNodes.canopy.value = tex }
export function setTreeFar(r) { terrainUniforms.uTreeFar.value = r }
