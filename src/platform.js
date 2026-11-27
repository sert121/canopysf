// Platform detection and quality tiers. Decides, before anything is drawn, how hard this device can be pushed:
// render resolution, antialiasing, shadow-map size, tree detail distances, buildings radius, and which controls to show.
// Override with ?quality=low|medium|high (and ?touch=1 to force touch controls).

const ua = navigator.userAgent || ''
const qs = new URLSearchParams(location.search)
const maxTP = navigator.maxTouchPoints || 0

// iPadOS 13+ reports itself as a Mac; a Mac with touch points is an iPad.
const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTP > 1)
const isIOS = /iPhone|iPod/.test(ua) || isIPad
const isAndroid = /Android/.test(ua)
const isAndroidTablet = isAndroid && !/Mobile/.test(ua)
const isPhone = !isIPad && !isAndroidTablet && ((isIOS) || isAndroid || /Mobi|Windows Phone/.test(ua))
const isTablet = isIPad || isAndroidTablet
const isMobile = isPhone || isTablet
const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Android/.test(ua)
const coarse = matchMedia('(pointer: coarse)').matches
const anyFine = matchMedia('(any-pointer: fine)').matches
const hasTouch = maxTP > 0 || 'ontouchstart' in window
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

// GPU name (where the browser exposes it) helps tell a gaming desktop from an office laptop or a software renderer.
function gpuName() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name || '')
  } catch (e) { return '' }
}
function webgl2() { try { return !!document.createElement('canvas').getContext('webgl2') } catch (e) { return false } }

const gpu = gpuName()
const mem = navigator.deviceMemory || 0          // Chrome/Android only; Safari leaves it undefined
const cores = navigator.hardwareConcurrency || 4
const softGPU = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)
const weakGPU = softGPU || /Intel\(R\) (HD|UHD) Graphics [1-6]\d\d\b|Mali-[GT][1-7]\d\b|Adreno \(TM\) [3-5]\d\d|PowerVR/i.test(gpu)
const strongGPU = /RTX|GTX 1[06-9]|GTX [2-9]\d|Radeon (RX|Pro)|Apple M\d|Apple GPU/i.test(gpu) && !isPhone

const iosMajor = isIOS ? +((ua.match(/OS (\d+)_/) || [])[1] || 0) : 0
function pickTier() {
  // Highest settings by default on every device; the live frame-rate governor in main.js scales
  // resolution (and, if it must, draw distance) down on hardware that can't keep up.
  const q = qs.get('quality')
  if (q === 'low' || q === 'medium' || q === 'high') return q
  return 'high'
}
const tier = pickTier()

const dpr = window.devicePixelRatio || 1
// Per tier: pixel-ratio range (adaptive resolution moves within it), antialiasing, shadow map, tree draw distances.
const Q = {
  low: { prMax: Math.min(dpr, 1.5), prMin: 0.7, aa: false, shadow: 1024, shadowExtent: 90, dist: 0, bldRadius: 1, aniso: 2 },
  medium: { prMax: Math.min(dpr, 1.5), prMin: 0.8, aa: true, shadow: 2048, shadowExtent: 120, dist: 1, bldRadius: 2, aniso: 4 },
  high: { prMax: Math.min(dpr, 2), prMin: 0.7, aa: true, shadow: 4096, shadowExtent: 140, dist: 3, bldRadius: 2, aniso: 16 },
}[tier]

const forceTouch = qs.get('touch') === '1'
export const PLATFORM = {
  ua, gpu, tier, iosMajor, isIOS, isIPad, isAndroid, isPhone, isTablet, isMobile, isSafari, standalone, mem, cores, softGPU,
  webgl2: webgl2(),
  // touch controls when touch is the main input; hybrids (iPad with a trackpad, touchscreen laptops) keep the mouse too
  touch: forceTouch || coarse || (isMobile && hasTouch),
  mouse: anyFine && !forceTouch,
  ...Q,
}

// Classes for CSS (safe areas, layout tweaks) and a name for the settings panel
const b = document.documentElement
b.classList.add('tier-' + tier)
if (PLATFORM.touch) b.classList.add('is-touch')
if (isIOS) b.classList.add('is-ios')
if (isAndroid) b.classList.add('is-android')
if (isPhone) b.classList.add('is-phone')
if (standalone) b.classList.add('is-standalone')

export function deviceLabel() {
  const kind = isIPad ? 'iPad' : isIOS ? 'iPhone' : isAndroidTablet ? 'Android tablet' : isAndroid ? 'Android phone' : PLATFORM.touch ? 'Touch device' : 'Computer'
  return `${kind} · ${tier} detail`
}

// ---- iOS Safari hygiene: no pinch-zoom of the page, no double-tap zoom, no rubber-band scrolling of the canvas ----
if (isIOS) {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })
  let lastEnd = 0
  document.addEventListener('touchend', e => {
    const now = Date.now()
    if (now - lastEnd < 320 && !(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault()
    lastEnd = now
  }, { passive: false })
}

// The real visible viewport (iOS toolbars collapse and expand; the on-screen keyboard shrinks it)
export function viewportSize() {
  const vv = window.visualViewport
  return { w: Math.round(vv ? vv.width : innerWidth), h: Math.round(vv ? vv.height : innerHeight) }
}

// Quality for the WebGPU engine. Desktop GPUs get everything; Apple silicon and recent phones get a lighter mix.
export function gpuQuality(gpuInfo) {
  const forced = qs.get('quality')
  const arch = ((gpuInfo && (gpuInfo.vendor + ' ' + gpuInfo.architecture + ' ' + gpuInfo.description)) || '') + ' ' + gpu
  const weak = /intel|swiftshader|llvmpipe|mali-g[1-6]\d\b|adreno \(tm\) [5-6]\d\d/i.test(arch) && !/arc/i.test(arch)
  let level = 'ultra'   // highest by default everywhere; the frame-rate governor scales down if needed
  if (forced === 'ultra' || forced === 'high' || forced === 'tablet' || forced === 'mobile') level = forced
  const Qs = {
    ultra: { prMax: Math.min(dpr, 2.5), prMin: 0.7, trees: { hiR: 220, midR: 900, farR: 3200, keepR: 120 },
      shadows: [{ size: 4096, extent: 90, ahead: 0.45 }, { size: 4096, extent: 700, ahead: 0.55 }], taps: 9, gtao: true, gtaoScale: 1.0, bloom: true, taa: true },
    high: { prMax: Math.min(dpr, 1.75), prMin: 0.8, trees: { hiR: 120, midR: 420, farR: 1800, keepR: 90 },
      shadows: [{ size: 2048, extent: 80, ahead: 0.45 }, { size: 2048, extent: 500, ahead: 0.55 }], taps: 9, gtao: false, bloom: true, taa: true },
    tablet: { prMax: Math.min(dpr, 2), prMin: 0.75, trees: { hiR: 110, midR: 400, farR: 1600, keepR: 80 },
      shadows: [{ size: 2048, extent: 75, ahead: 0.45 }, { size: 2048, extent: 450, ahead: 0.55 }], taps: 9, gtao: false, bloom: true, taa: true },
    mobile: { prMax: Math.min(dpr, 2), prMin: 0.7, trees: { hiR: 90, midR: 360, farR: 1500, keepR: 70 },
      shadows: [{ size: 2048, extent: 65, ahead: 0.45 }, { size: 2048, extent: 420, ahead: 0.55 }], taps: 9, gtao: false, bloom: true, taa: true },
  }
  return { level, ...Qs[level] }
}
