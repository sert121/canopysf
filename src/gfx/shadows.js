// Cascaded sun shadows for the WebGPU engine: a sharp near cascade around the viewer and a wide far cascade
// that carries tree and building shadows out toward the horizon. Casters live in shadowScene; layer 1 = near, 2 = far.
import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { U } from '../shaders.js'
import { CSM, registerCascades } from './tsl-common.js'

const cascades = []
export const GSH = { enabled: true }

export function initGpuShadows(specs) {
  // specs: [{ size, extent, ahead }]
  specs.forEach((s, i) => {
    const depth = new THREE.DepthTexture(s.size, s.size)
    depth.type = THREE.FloatType
    depth.compareFunction = THREE.LessEqualCompare
    depth.minFilter = depth.magFilter = THREE.LinearFilter
    const rt = new THREE.RenderTarget(s.size, s.size, { depthTexture: depth, depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType })
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000)
    cam.coordinateSystem = THREE.WebGPUCoordinateSystem
    cam.layers.set(i + 1)
    cascades.push({ ...s, rt, cam, matrix: uniform(new THREE.Matrix4()), texel: uniform(1 / s.size), tex: depth })
  })
  registerCascades(cascades)
}

const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _r = new THREE.Vector3(), _u = new THREE.Vector3()
export function renderGpuShadows(renderer, camera, shadowScene) {
  const sun = U.uSunDir.value
  if (!GSH.enabled || sun.y < 0.03 || !cascades.length) { CSM.on.value = 0; return }
  camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1); _f.normalize()
  const prev = renderer.getRenderTarget()
  for (const c of cascades) {
    const e = c.extent, cam = c.cam
    _c.copy(camera.position).addScaledVector(_f, e * c.ahead)
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = 1; cam.far = e * 2 + 2400
    cam.position.copy(_c).addScaledVector(sun, e + 1100)
    cam.up.copy(Math.abs(sun.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : _up); cam.lookAt(_c)
    cam.updateMatrixWorld()
    // snap the box to whole texels so shadows don't crawl as you move
    const texel = (2 * e) / c.size
    const lc = _c.clone().applyMatrix4(cam.matrixWorldInverse)
    const sx = Math.round(lc.x / texel) * texel - lc.x, sy = Math.round(lc.y / texel) * texel - lc.y
    _r.setFromMatrixColumn(cam.matrixWorld, 0); _u.setFromMatrixColumn(cam.matrixWorld, 1)
    cam.position.addScaledVector(_r, sx).addScaledVector(_u, sy)
    cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    c.matrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    renderer.setRenderTarget(c.rt)
    renderer.clear()
    renderer.render(shadowScene, cam)
  }
  renderer.setRenderTarget(prev)
  CSM.on.value = 1
}
