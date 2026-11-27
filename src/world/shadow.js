import * as THREE from 'three'
import { U } from '../shaders.js'

// Sun shadow map: an orthographic camera looking down the sun direction over a box around the viewer.
// Casters live in their own scene (instanced trees with a depth-only, alpha-tested material).
export const shadowScene = new THREE.Scene()
let rt, cam
let SIZE = 4096
export const SH = { extent: 140, enabled: true }

export function initShadows(renderer, size = 4096) {
  SIZE = size
  const depth = new THREE.DepthTexture(SIZE, SIZE)
  depth.type = THREE.UnsignedIntType
  depth.compareFunction = THREE.LessEqualCompare
  depth.minFilter = depth.magFilter = THREE.LinearFilter
  rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthTexture: depth, depthBuffer: true })
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000)
  U.uShadowMap.value = depth
  U.uShadowTexel.value = 1 / SIZE
}

const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0)
export function renderShadows(renderer, camera) {
  if (!SH.enabled || !rt) { U.uShadowOn.value = 0; return }
  const sun = U.uSunDir.value
  if (sun.y < 0.03) { U.uShadowOn.value = 0; return }
  const e = SH.extent
  // centre the box a little ahead of the viewer
  camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1); _f.normalize()
  _c.copy(camera.position).addScaledVector(_f, e * 0.45)
  // snap to shadow texels to stop shimmering
  const texel = (2 * e) / SIZE
  cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = 1; cam.far = 1600
  const pos = _c.clone().addScaledVector(sun, 700)
  cam.position.copy(pos); cam.up.copy(Math.abs(sun.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : _up); cam.lookAt(_c)
  cam.updateMatrixWorld()
  // texel snapping in light space
  const inv = cam.matrixWorldInverse.clone()
  const lc = _c.clone().applyMatrix4(inv)
  const sx = Math.round(lc.x / texel) * texel - lc.x, sy = Math.round(lc.y / texel) * texel - lc.y
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
  cam.position.addScaledVector(right, sx).addScaledVector(upv, sy)
  cam.updateMatrixWorld(); cam.updateProjectionMatrix()
  U.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  renderer.clear(true, true, true)
  renderer.render(shadowScene, cam)
  renderer.setRenderTarget(prev)
  U.uShadowOn.value = 1
}
