// Picks the rendering engine at boot.
//  - WebGPU (three.js WebGPURenderer + TSL): Chrome/Edge 113+ on desktop, Chrome on Android 12+, Safari 26+ on
//    macOS / iOS / iPadOS. GPU-driven trees (compute culling + indirect draws), cascaded shadows, GTAO, bloom, TRAA.
//  - WebGL 2 (the original hand-written GLSL engine): everything else, e.g. iOS 17–18 Safari.
// Force with ?engine=gpu or ?engine=gl.
export const ENGINE = { gpu: false, name: 'WebGL 2', adapter: null, info: null, q: null }

export async function detectWebGPU() {
  const qs = new URLSearchParams(location.search)
  const want = qs.get('engine')
  if (want === 'gl' || qs.has('lab')) return null
  if (!('gpu' in navigator) || !navigator.gpu) return null
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const info = adapter.info || {}
    // a software adapter is slower than the WebGL path; only use it when asked to
    const soft = adapter.isFallbackAdapter || info.isFallbackAdapter || /swiftshader|llvmpipe/i.test(info.architecture + ' ' + info.description)
    if (soft && want !== 'gpu') return null
    // GPU-driven trees read six storage buffers in the vertex stage; some older mobile drivers can't
    const L = adapter.limits
    if (want !== 'gpu' && (L.maxStorageBuffersPerShaderStage < 8 || (L.maxStorageBuffersInVertexStage !== undefined && L.maxStorageBuffersInVertexStage < 6))) return null
    return { adapter, info, soft }
  } catch (e) { return null }
}
