// Post chain for the WebGPU engine: scene → ground-truth ambient occlusion → bloom → temporal anti-aliasing
// (jittered, reprojected: it resolves foliage edges and leaf alpha-cutouts that MSAA can't) → ACES tone map.
import * as THREE from 'three/webgpu'
import { pass, mrt, output, velocity, vec4, float, mix } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { finish } from './tsl-common.js'

export function createPost(renderer, scene, camera, q) {
  const pipe = new THREE.RenderPipeline(renderer)
  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, velocity }))
  const color = scenePass.getTextureNode('output')
  const depth = scenePass.getTextureNode('depth')
  const vel = scenePass.getTextureNode('velocity')
  let hdr = color
  if (q.gtao) {
    const aoPass = ao(depth, null, camera)
    aoPass.resolutionScale = q.gtaoScale || 0.5
    aoPass.radius.value = 1.6
    aoPass.thickness.value = 1.0
    hdr = vec4(color.rgb.mul(mix(float(1.0), aoPass.getTextureNode().r, 0.6)), 1.0)
  }
  if (q.bloom) hdr = hdr.add(bloom(hdr, 0.12, 0.35, 1.4))
  const aa = q.taa ? traa(hdr, depth, vel, camera) : hdr
  pipe.outputNode = vec4(finish(aa.rgb), 1.0)
  pipe.outputColorTransform = false
  return pipe
}
