import * as THREE from 'three'
import { PLATFORM } from '../platform.js'
import uFeather from '../assets/leaf_feather.png'
import uSmall from '../assets/leaf_small.png'
import uOak from '../assets/leaf_oak.png'
import uNeedle from '../assets/leaf_needle.png'
import bFurrowed from '../assets/bark_furrowed.png'
import bPlates from '../assets/bark_plates.png'
import bFiber from '../assets/bark_fiber.png'

// Photographic sprigs and bark (from EZ-Tree, MIT; bark scans CC0) replace the hand-drawn tiles where they exist.
const PHOTO_LEAF = { 5: uFeather, 2: uSmall, 9: uOak, 3: uNeedle }
const PHOTO_BARK = { 0: bFurrowed, 5: bPlates, 8: bFiber }
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })

// Procedural texture atlases, drawn on canvas at startup.
// Leaf atlas: 4x4 tiles of 512px. R = leaf shading (tinted per species), G = flower mask, A = coverage.
// Bark atlas: 4x4 tiles of 256px, greyscale pattern tinted by the species' trunk colour.

let seed = 7
const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const rr = (a, b) => a + (b - a) * R()

function col(l, f = 0, b) { return `rgb(${Math.min(255, l) | 0},${f ? 255 : 0},${(b ?? l) | 0})` }

// --- leaf shapes, drawn pointing along +x from the origin ---
const SH = {
  ellipse(c, L, W) { c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(L * 0.25, -W, L * 0.75, -W * 0.8, L, 0); c.bezierCurveTo(L * 0.75, W * 0.8, L * 0.25, W, 0, 0); c.fill() },
  lance(c, L, W) { c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(L * 0.4, -W, L, 0); c.quadraticCurveTo(L * 0.4, W, 0, 0); c.fill() },
  palmate(c, L) {
    c.beginPath(); const n = 5
    for (let k = 0; k <= n * 2; k++) {
      const a = -Math.PI * 0.75 + (k / (n * 2)) * Math.PI * 1.5
      const r = k % 2 === 0 ? L * (k === n ? 1 : 0.82) : L * 0.42
      const x = L * 0.45 + Math.cos(a) * r * 0.6, y = Math.sin(a) * r * 0.6
      k ? c.lineTo(x, y) : c.moveTo(x, y)
    }
    c.closePath(); c.fill()
  },
  heart(c, L) { c.beginPath(); c.moveTo(L, 0); c.bezierCurveTo(L * 0.6, -L * 0.55, 0, -L * 0.5, L * 0.12, 0); c.bezierCurveTo(0, L * 0.5, L * 0.6, L * 0.55, L, 0); c.fill() },
  fan(c, L) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, L, -0.75, 0.75); c.closePath(); c.fill(); c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.moveTo(L * 0.55, 0); c.lineTo(L * 1.05, -L * 0.08); c.lineTo(L * 1.05, L * 0.08); c.fill(); c.restore() },
  holly(c, L, W) {
    c.beginPath(); c.moveTo(0, 0); const n = 4
    for (let k = 1; k <= n; k++) { c.lineTo(L * (k - 0.5) / n, -W * (k % 2 ? 1.1 : 0.7)); c.lineTo(L * k / n, -W * 0.45) }
    c.lineTo(L, 0)
    for (let k = n; k >= 1; k--) { c.lineTo(L * k / n, W * 0.45); c.lineTo(L * (k - 0.5) / n, W * (k % 2 ? 1.1 : 0.7)) }
    c.closePath(); c.fill()
  },
}

function leafAt(c, x, y, ang, L, W, shape, lum, vein = true) {
  c.save(); c.translate(x, y); c.rotate(ang)
  const hue = rr(0, 255)
  const gr = c.createLinearGradient(0, -W, L * 0.3, W + 1)
  gr.addColorStop(0, col(lum * 1.08, 0, hue)); gr.addColorStop(1, col(lum * 0.72, 0, hue))
  c.fillStyle = gr; SH[shape](c, L, W)
  if (vein && L > 18) { c.strokeStyle = col(lum * 0.62, 0, hue); c.lineWidth = Math.max(1, L / 45); c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.92, 0); c.stroke() }
  c.restore()
}
function twig(c, x0, y0, x1, y1, w, lum = 90) { c.strokeStyle = col(lum); c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + rr(-20, 20), (y0 + y1) / 2 + rr(-20, 20), x1, y1); c.stroke() }

// generic cluster: twigs radiating from below-centre, leaves along them
function cluster(c, { shape, L, W, n = 7, per = 9, spread = 1, droop = 0 }) {
  const cx = 256, cy = 300
  for (let b = 0; b < n; b++) {
    const a = -Math.PI / 2 + rr(-1.25, 1.25) * spread
    const len = rr(150, 210)
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len * 0.95
    twig(c, cx + rr(-20, 20), cy + 40, ex, ey, 4)
    for (let k = 0; k < per; k++) {
      const t = 0.25 + 0.75 * (k / per) + rr(-0.03, 0.03)
      const px = cx + (ex - cx) * t, py = cy + 40 + (ey - cy - 40) * t
      const side = k % 2 ? 1 : -1
      let la = a + side * rr(0.5, 1.1)
      if (droop) la = la * (1 - droop) + Math.PI / 2 * droop
      leafAt(c, px, py, la, L * rr(0.8, 1.15), W * rr(0.85, 1.1), shape, rr(150, 250))
    }
    leafAt(c, ex, ey, a, L * 0.9, W * 0.9, shape, rr(170, 250))
  }
}

const TILES = [
  // 0 broad: glossy oval leaves
  c => cluster(c, { shape: 'ellipse', L: 74, W: 22, n: 8, per: 8 }),
  // 1 palmate: maple / plane stars
  c => cluster(c, { shape: 'palmate', L: 78, W: 0, n: 7, per: 6 }),
  // 2 small: dense small leaves
  c => cluster(c, { shape: 'ellipse', L: 30, W: 9, n: 11, per: 18 }),
  // 3 needle: pine tufts
  c => {
    for (let k = 0; k < 9; k++) {
      const x = rr(120, 392), y = rr(140, 380); twig(c, 256, 470, x, y, 6, 80)
      for (let j = 0; j < 46; j++) { const a = rr(0, Math.PI * 2), l = rr(50, 95); c.strokeStyle = col(rr(130, 235)); c.lineWidth = 2.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.8); c.stroke() }
    }
  },
  // 4 scale: flat cypress / redwood sprays
  c => {
    const spray = (x, y, a, len, w, d) => {
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len
      c.strokeStyle = col(rr(140, 230)); c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke()
      if (d > 0) for (let k = 1; k <= 5; k++) { const t = k / 6; spray(x + (ex - x) * t, y + (ey - y) * t, a + (k % 2 ? 0.75 : -0.75), len * 0.42, w * 0.78, d - 1) }
    }
    for (let k = 0; k < 14; k++) spray(256 + rr(-50, 50), 470, -Math.PI / 2 + rr(-1.25, 1.25), rr(200, 280), 20, 3)
  },
  // 5 feather: bipinnate fern-like
  c => {
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 + rr(-1.3, 1.3), len = rr(160, 220), x0 = 256 + rr(-20, 20), y0 = 330
      const ex = x0 + Math.cos(a) * len, ey = y0 + Math.sin(a) * len
      twig(c, x0, y0 + 40, ex, ey, 3, 110)
      for (let j = 1; j < 14; j++) {
        const t = j / 14, px = x0 + (ex - x0) * t, py = y0 + (ey - y0) * t
        for (const s of [-1, 1]) leafAt(c, px, py, a + s * 1.25, rr(22, 34) * (1.1 - t * 0.5), 6, 'ellipse', rr(150, 245), false)
      }
    }
  },
  // 6 sickle: long, narrow, drooping (eucalyptus, acacia phyllodes)
  c => cluster(c, { shape: 'lance', L: 105, W: 12, n: 8, per: 7, droop: 0.55 }),
  // 7 heart
  c => cluster(c, { shape: 'heart', L: 68, W: 0, n: 7, per: 6 }),
  // 8 fan: ginkgo
  c => cluster(c, { shape: 'fan', L: 44, W: 0, n: 9, per: 10 }),
  // 9 oak / holly: small spiny leaves
  c => cluster(c, { shape: 'holly', L: 42, W: 13, n: 10, per: 12 }),
  // 10 palm feather frond: rachis along u, leaflets both sides
  c => {
    c.strokeStyle = col(150); c.lineWidth = 7; c.beginPath(); c.moveTo(6, 256); c.lineTo(506, 256); c.stroke()
    for (let x = 30; x < 500; x += 9) {
      const t = x / 512, l = 190 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 20
      for (const s of [-1, 1]) { c.strokeStyle = col(rr(150, 245)); c.lineWidth = 6; c.beginPath(); c.moveTo(x, 256); c.quadraticCurveTo(x + 30, 256 + s * l * 0.5, x + 46, 256 + s * l); c.stroke() }
    }
  },
  // 11 palm fan: pleated circular leaf
  c => {
    const cx = 256, cy = 300
    for (let k = 0; k < 44; k++) {
      const a = Math.PI * (1.05 + k / 44 * 0.9) + rr(-0.02, 0.02), l = rr(200, 245)
      c.fillStyle = col(k % 2 ? 175 : 235); c.beginPath(); c.moveTo(cx, cy)
      c.lineTo(cx + Math.cos(a - 0.03) * l, cy + Math.sin(a - 0.03) * l); c.lineTo(cx + Math.cos(a + 0.035) * l * 1.02, cy + Math.sin(a + 0.035) * l * 1.02); c.closePath(); c.fill()
    }
    for (let k = 0; k < 20; k++) { const a = Math.PI * (1.05 + R() * 0.9), l = rr(180, 250); c.strokeStyle = col(200); c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); c.lineTo(cx + Math.cos(a) * (l + 40), cy + Math.sin(a) * (l + 50)); c.stroke() }
  },
  // 12 blossom: masses of five-petal flowers with a few leaves
  c => {
    cluster(c, { shape: 'ellipse', L: 50, W: 15, n: 6, per: 4 })
    for (let k = 0; k < 230; k++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 215, x = 256 + Math.cos(a) * r, y = 250 + Math.sin(a) * r * 0.9
      const s = rr(9, 15), lum = rr(185, 255)
      for (let p = 0; p < 5; p++) { const pa = p * 1.2566 + k; c.fillStyle = col(lum, 1); c.beginPath(); c.ellipse(x + Math.cos(pa) * s * 0.7, y + Math.sin(pa) * s * 0.7, s * 0.62, s * 0.42, pa, 0, 7); c.fill() }
      c.fillStyle = col(lum * 0.6, 1); c.beginPath(); c.arc(x, y, s * 0.25, 0, 7); c.fill()
    }
  },
  // 13 strap: cordyline / yucca rosette
  c => {
    for (let k = 0; k < 34; k++) {
      const a = -Math.PI / 2 + rr(-1.45, 1.45), l = rr(180, 250)
      c.fillStyle = col(rr(150, 240)); c.beginPath(); c.moveTo(256 - 6, 470); c.lineTo(256 + Math.cos(a) * l, 470 + Math.sin(a) * l * 1.7); c.lineTo(256 + 6, 470); c.fill()
    }
  },
  // 14 brush: narrow leaves + flower brushes (bottlebrush, pōhutukawa)
  c => {
    cluster(c, { shape: 'lance', L: 64, W: 9, n: 9, per: 9 })
    for (let k = 0; k < 10; k++) {
      const x = rr(110, 400), y = rr(90, 360), a = rr(-0.5, 0.5) - Math.PI / 2
      for (let j = 0; j < 60; j++) { const t = R(), px = x + Math.cos(a) * t * 70, py = y + Math.sin(a) * t * 70, sa = rr(0, 6.28), sl = rr(10, 20); c.strokeStyle = col(rr(190, 255), 1); c.lineWidth = 2.2; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(sa) * sl, py + Math.sin(sa) * sl); c.stroke() }
    }
  },
  // 15 willow: long hanging strands
  c => {
    for (let k = 0; k < 13; k++) {
      const x = rr(60, 452), y0 = rr(20, 90), len = rr(330, 430)
      twig(c, x, y0, x + rr(-25, 25), y0 + len, 2.5, 100)
      for (let j = 0; j < 22; j++) { const t = j / 22; leafAt(c, x + rr(-6, 6), y0 + len * t, Math.PI / 2 + (j % 2 ? 0.5 : -0.5), rr(34, 52), 6, 'lance', rr(150, 245), false) }
    }
  },
]

function noiseFill(c, w, h, base, amp, sx, sy, n = 3000) {
  c.fillStyle = `rgb(${base},${base},${base})`; c.fillRect(0, 0, w, h)
  for (let k = 0; k < n; k++) { const l = base + rr(-amp, amp); c.fillStyle = `rgb(${l | 0},${l | 0},${l | 0})`; c.fillRect(rr(0, w), rr(0, h), rr(2, sx), rr(2, sy)) }
}
const BARKS = [
  // 0 furrowed: vertical ridges
  (c, w, h) => { noiseFill(c, w, h, 150, 30, 6, 30); for (let k = 0; k < 26; k++) { const x = rr(0, w); c.strokeStyle = `rgba(40,40,40,${rr(0.4, 0.8)})`; c.lineWidth = rr(3, 7); c.beginPath(); c.moveTo(x, 0); for (let y = 0; y <= h; y += 16) c.lineTo(x + rr(-6, 6), y); c.stroke() } },
  // 1 smooth: subtle horizontal lenticels
  (c, w, h) => { noiseFill(c, w, h, 175, 12, 20, 6); for (let k = 0; k < 40; k++) { c.fillStyle = 'rgba(70,70,70,.5)'; c.fillRect(rr(0, w), rr(0, h), rr(8, 22), 2) } },
  // 2 camo: plane-tree jigsaw — pale cream underbark with overlapping grey/olive flakes, jagged rims
  (c, w, h) => {
    noiseFill(c, w, h, 222, 10, 12, 12, 1500)
    const blob = (x, y, r, l, a) => {
      c.fillStyle = `rgba(${l},${l},${l},${a})`; c.beginPath()
      const n = 14 + (R() * 8 | 0)
      for (let k = 0; k < n; k++) { const t = k / n * 6.283, rr2 = r * (0.65 + 0.5 * R()); const px = x + Math.cos(t) * rr2 * 1.25, py = y + Math.sin(t) * rr2 * 0.8; k ? c.lineTo(px, py) : c.moveTo(px, py) }
      c.closePath(); c.fill()
    }
    for (let k = 0; k < 55; k++) { const x = rr(-20, w + 20), y = rr(-20, h + 20), r = rr(12, 34); blob(x + 1.5, y + 1.5, r, 70, 0.5); blob(x, y, r, [128, 150, 170, 105][k % 4], 1) }
    for (let k = 0; k < 600; k++) { const l = rr(-30, 30); c.fillStyle = `rgba(${128 + l | 0},${128 + l | 0},${128 + l | 0},.25)`; c.fillRect(rr(0, w), rr(0, h), rr(1, 4), rr(1, 4)) }
  },
  // 3 white: smooth pale gum bark, long vertical ribbons peeling away, faint mottling
  (c, w, h) => {
    noiseFill(c, w, h, 226, 8, 40, 40, 900)
    for (let k = 0; k < 40; k++) { const l = rr(190, 245); c.fillStyle = `rgba(${l},${l},${l},.55)`; c.beginPath(); c.ellipse(rr(0, w), rr(0, h), rr(10, 30), rr(20, 60), 0, 0, 7); c.fill() }
    for (let k = 0; k < 14; k++) {
      const x = rr(0, w), wd = rr(5, 16), y0 = rr(-40, h), len = rr(60, 200)
      c.fillStyle = `rgba(${rr(120, 160) | 0},${rr(115, 150) | 0},${rr(105, 140) | 0},.75)`; c.fillRect(x, y0, wd, len)
      c.fillStyle = 'rgba(70,70,70,.5)'; c.fillRect(x, y0, 1.5, len); c.fillRect(x + wd - 1, y0, 1.5, len)
    }
  },
  // 4 redpeel: smooth with peeling curls (tinted red by trunk colour)
  (c, w, h) => { noiseFill(c, w, h, 205, 18, 30, 12); for (let k = 0; k < 30; k++) { c.fillStyle = `rgba(110,110,110,${rr(0.4, 0.8)})`; c.beginPath(); c.ellipse(rr(0, w), rr(0, h), rr(8, 24), rr(3, 8), rr(-0.4, 0.4), 0, 7); c.fill() } },
  // 5 plates: dark blocky plates (pine, ironbark)
  (c, w, h) => { c.fillStyle = '#383838'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 26) for (let x = (y / 26) % 2 * 20; x < w; x += 40) { const l = rr(110, 175); c.fillStyle = `rgb(${l},${l},${l})`; c.fillRect(x + 3, y + 3, rr(26, 36), rr(16, 22)) } },
  // 6 diamond: palm leaf-base scars
  (c, w, h) => { c.fillStyle = '#7a7a7a'; c.fillRect(0, 0, w, h); for (let y = -32; y < h + 32; y += 32) for (let x = (y / 32) % 2 * 32 - 32; x < w + 32; x += 64) { c.fillStyle = `rgb(${rr(160, 200) | 0},${rr(160, 200) | 0},${rr(160, 200) | 0})`; c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x + 30, y); c.lineTo(x, y + 26); c.lineTo(x - 30, y); c.fill() } },
  // 7 rings: smooth palm trunk with leaf rings
  (c, w, h) => { noiseFill(c, w, h, 190, 10, 30, 4); for (let y = 0; y < h; y += rr(14, 22)) { c.fillStyle = 'rgba(80,80,80,.55)'; c.fillRect(0, y, w, 3) } },
  // 8 fiber: shaggy fibrous strands
  (c, w, h) => { noiseFill(c, w, h, 140, 20, 4, 10); for (let k = 0; k < 400; k++) { const x = rr(0, w), y = rr(0, h); c.strokeStyle = `rgba(${rr(60, 220) | 0},${rr(60, 220) | 0},${rr(60, 220) | 0},.6)`; c.lineWidth = rr(1, 3); c.beginPath(); c.moveTo(x, y); c.lineTo(x + rr(-6, 6), y + rr(18, 46)); c.stroke() } },
]

export async function makeAtlases(renderer) {
  const imgs = {}
  await Promise.all([...Object.entries(PHOTO_LEAF).map(([k, u]) => loadImg(u).then(im => imgs['l' + k] = im)),
    ...Object.entries(PHOTO_BARK).map(([k, u]) => loadImg(u).then(im => imgs['b' + k] = im))])
  const lc = document.createElement('canvas'); lc.width = lc.height = 2048
  const c = lc.getContext('2d')
  TILES.forEach((draw, i) => {
    seed = 1000 + i * 97
    c.save(); c.translate((i % 4) * 512, Math.floor(i / 4) * 512)
    c.beginPath(); c.rect(12, 12, 488, 488); c.clip()
    if (imgs['l' + i]) c.drawImage(imgs['l' + i], 12, 12, 488, 488); else draw(c)
    c.restore()
  })
  const leaf = new THREE.CanvasTexture(lc)
  leaf.colorSpace = THREE.NoColorSpace; leaf.anisotropy = Math.min(PLATFORM.aniso, (renderer.capabilities?.getMaxAnisotropy?.() ?? renderer.getMaxAnisotropy?.() ?? 8))
  leaf.minFilter = THREE.LinearMipmapLinearFilter; leaf.generateMipmaps = true
  const bc = document.createElement('canvas'); bc.width = bc.height = 2048
  const b = bc.getContext('2d')
  BARKS.forEach((draw, i) => {
    seed = 3000 + i * 131
    b.save(); b.translate((i % 4) * 512, Math.floor(i / 4) * 512); b.beginPath(); b.rect(0, 0, 512, 512); b.clip()
    if (imgs['b' + i]) b.drawImage(imgs['b' + i], 0, 0, 512, 512); else { b.scale(2, 2); draw(b, 256, 256) }
    b.restore()
  })
  const bark = new THREE.CanvasTexture(bc)
  bark.colorSpace = THREE.NoColorSpace; bark.wrapS = bark.wrapT = THREE.ClampToEdgeWrapping
  bark.minFilter = THREE.LinearMipmapLinearFilter; bark.anisotropy = leaf.anisotropy
  return { leaf, bark, leafCanvas: lc, barkCanvas: bc }
}
