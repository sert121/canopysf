// Loads all static data and exposes world-space helpers.
export const D = {
  world: null, H: null, species: null, trees: null, nh: null, roadIndex: null, metaIndex: null, groundImg: null, streets: null,
}

// Native gzip where the browser has it (Safari 16.4+, all current Chrome/Firefox); a small JS inflater for older iOS.
async function gunzip(raw) {
  if (typeof DecompressionStream !== 'undefined') {
    try { return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() } catch (e) { /* fall through */ }
  }
  const { gunzipSync } = await import('fflate')
  return gunzipSync(raw).buffer
}

// Binary data ships as base64 text of a gzip stream (so any static host serves and compresses it).
export async function getBuf(url, onp) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('fetch ' + url)
  let b
  if (url.endsWith('.gz') || url.endsWith('.b64.txt')) {
    let raw
    if (url.endsWith('.b64.txt')) { const t = atob((await r.text()).trim()); raw = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) raw[i] = t.charCodeAt(i) }
    else raw = new Uint8Array(await r.arrayBuffer())
    // the host may already have decoded it; gzip files start with 1f 8b
    b = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : raw.buffer
  } else b = await r.arrayBuffer()
  onp && onp(); return b
}
async function getJSON(url, onp) {
  const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + url)
  const j = await r.json(); onp && onp(); return j
}
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url })
}

export async function loadAll(progress) {
  let done = 0; const total = 9
  const tick = () => progress(++done / total)
  const base = 'data/'
  const [world, hbuf, tbuf, species, nh, roadIndex, metaIndex, groundImg] = await Promise.all([
    getJSON(base + 'world.json', tick), getBuf(base + 'terrain.u16.gz.b64.txt', tick), getBuf(base + 'trees.bin.gz.b64.txt', tick),
    getJSON(base + 'species.json', tick), getJSON(base + 'neighborhoods.json', tick), getJSON(base + 'roads.json', tick),
    getJSON(base + 'meta/index.json', tick), loadImage(base + 'ground.png').then(i => { tick(); return i }),
    getJSON(base + 'streets.json', tick).then(s => { D.streets = s; return s }),
  ])
  D.world = world; D.species = species; D.nh = nh; D.roadIndex = roadIndex; D.metaIndex = metaIndex; D.groundImg = groundImg
  // heights: file rows are north->south; store south->north so row index grows with world y
  const q = new Uint16Array(hbuf); const { gnx, gny, hoff, hscale } = world
  const H = new Float32Array(gnx * gny)
  for (let r = 0; r < gny; r++) {
    const src = (gny - 1 - r) * gnx, dst = r * gnx
    for (let c = 0; c < gnx; c++) H[dst + c] = q[src + c] / hscale - hoff
  }
  D.H = H
  // trees: struct of arrays
  const n = new Uint32Array(tbuf, 0, 1)[0]
  let o = 4
  const x = new Int16Array(tbuf, o, n); o += 2 * n
  const y = new Int16Array(tbuf, o, n); o += 2 * n
  const sp = new Uint16Array(tbuf.slice(o, o + 2 * n)); o += 2 * n
  const dbh = new Uint8Array(tbuf, o, n); o += n
  const flags = new Uint8Array(tbuf, o, n)
  D.trees = { n, x, y, sp, dbh, flags }
  // meta chunk lookup sorted by start index
  D.metaList = Object.entries(metaIndex).map(([k, [s, c]]) => ({ k, s, c })).sort((a, b) => a.s - b.s)
  return D
}

export function heightAt(x, y) {
  const w = D.world; const H = D.H
  let fx = (x - w.gx0) / w.gres, fy = (y - w.gy0) / w.gres
  if (fx < 0) fx = 0; if (fy < 0) fy = 0
  if (fx > w.gnx - 1.001) fx = w.gnx - 1.001; if (fy > w.gny - 1.001) fy = w.gny - 1.001
  const c = fx | 0, r = fy | 0, tx = fx - c, ty = fy - r
  const i = r * w.gnx + c
  const a = H[i], b = H[i + 1], cc = H[i + w.gnx], d = H[i + w.gnx + 1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty
}

const metaCache = new Map()
export async function treeMeta(i) {
  // find chunk containing global index i
  const L = D.metaList; let lo = 0, hi = L.length - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m].s <= i) lo = m; else hi = m - 1 }
  const ch = L[lo]
  if (!metaCache.has(ch.k)) metaCache.set(ch.k, fetch('data/meta/' + ch.k + '.json').then(r => r.json()))
  const arr = await metaCache.get(ch.k)
  return arr[i - ch.s] || null
}

export function toLatLon(x, y) {
  const w = D.world
  return [w.lat0 + y / w.mlat, w.lon0 + x / w.mlon]
}

let nhBoxes = null
export function neighborhoodAt(x, y) {
  if (!nhBoxes) nhBoxes = D.nh.map(n => n.polys.map(p => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (const [a, b] of p) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b) }
    return [x0, y0, x1, y1]
  }))
  for (let k = 0; k < D.nh.length; k++) {
    const n = D.nh[k]
    for (let j = 0; j < n.polys.length; j++) {
      const bb = nhBoxes[k][j]
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue
      if (pip(x, y, n.polys[j])) return n.name
    }
  }
  return null
}
function pip(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
