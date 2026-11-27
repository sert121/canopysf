import { D, treeMeta, toLatLon } from '../data.js'
import { T } from '../world/trees.js'
import { HABIT } from '../info/index.js'
import { $, esc, sil, fmt, record, toast, journal, speciesTotal } from './common.js'

const LEAF_DESC = { broad: 'Simple, smooth-edged oval leaves', palmate: 'Lobed, hand-shaped leaves', small: 'Small, fine leaves in dense sprays', needle: 'Needles in bundles and tufts', scale: 'Flat sprays of tiny scale-like leaves', feather: 'Feathery compound leaves of many leaflets', sickle: 'Long, narrow leaves that hang down', heart: 'Broad, heart-shaped leaves', fan: 'Small fan-shaped leaves with a notch', oak: 'Small, stiff leaves with spiny edges', palmfeather: 'Long feather-shaped fronds', palmfan: 'Round, pleated fan fronds', strap: 'Long strap- or sword-shaped leaves in rosettes', brush: 'Narrow leaves; flowers like red bottlebrushes', willow: 'Long, narrow leaves on hanging strands' }
const BARK_DESC = { furrowed: 'Ridged, furrowed bark', smooth: 'Smooth bark', camo: 'Bark flaking into camouflage patches', white: 'Pale, smooth bark that sheds in strips', redpeel: 'Smooth red-brown bark that peels and curls', plates: 'Dark bark broken into thick plates', diamond: 'Trunk covered in diamond-shaped leaf-base scars', rings: 'Smooth trunk ringed by old leaf scars', fiber: 'Shaggy, fibrous bark' }
const SHAPE_DESC = { round: 'Rounded crown', oval: 'Upright oval crown', column: 'Narrow and columnar', spread: 'Broad, spreading crown', umbrella: 'Flat umbrella crown on a tall trunk', vase: 'Vase-shaped, branches arching up and out', cone: 'Conical', araucaria: 'Perfectly symmetrical tiers', cypress: 'Flat-topped, wind-sculpted tiers', pine: 'Open crown of irregular clumps', gum: 'Tall and open, leaves hanging in loose clumps', weep: 'Weeping, branches falling in curtains', palmfan: 'Single trunk, round head of fan fronds', palmfeather: 'Single trunk, arching feather fronds', tuft: 'Branching stems tipped with leaf tufts' }

function swatch(canvas, src, tile, cols, size, tint, flower) {
  const ctx = canvas.getContext('2d'), sx = (tile % cols) * size, sy = Math.floor(tile / cols) * size
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height), a = d.data
  const t = tint.map(v => v * 255), f = (flower || tint).map(v => v * 255)
  for (let k = 0; k < a.length; k += 4) {
    const l = a[k] / 255, fl = a[k + 1] > 128
    const c = fl ? f : t, m = fl ? 0.62 + 0.48 * l : 0.38 + 0.86 * l
    a[k] = Math.min(255, c[0] * m); a[k + 1] = Math.min(255, c[1] * m); a[k + 2] = Math.min(255, c[2] * m)
  }
  ctx.putImageData(d, 0, 0)
}
const hex3 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }

let current = null
export let onTrack = () => { }
export function setTrackHandler(fn) { onTrack = fn }
let onWalk = () => { }
export function setWalkHandler(fn) { onWalk = fn }
let onFly = () => { }
export function setFlyHandler(fn) { onFly = fn }

// species ranking by street-tree count (computed once)
let rank = null
function rankOf(sp) {
  if (!rank) { rank = D.species.map((s, i) => [s.n, i]).sort((a, b) => b[0] - a[0]); rank = new Map(rank.map(([n, i], r) => [i, r + 1])) }
  return rank.get(sp)
}
const streetTotal = () => D.species.reduce((a, s) => a + s.n, 0)
let ST = 0

function ago(dateStr) {
  const d = new Date(dateStr + 'T12:00:00'); if (isNaN(d)) return ''
  const y = (Date.now() - d) / (365.25 * 864e5)
  const when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  return y < 1 ? `${when} (this past year)` : `${when} (${Math.floor(y)} year${y >= 2 ? 's' : ''} ago)`
}

export function closeCard() { $('#card').classList.add('hidden'); current = null; dispatchEvent(new CustomEvent('cardclose')) }
export function cardOpen() { return current !== null }

// Open for a specific tree index, or for a species (sp) with no tree.
export async function openCard({ i = -1, sp = -1 } = {}) {
  if (i >= 0) sp = D.trees.sp[i]
  const info = T.info[sp], rec = D.species[sp]
  if (!ST) ST = streetTotal()
  current = { i, sp }
  const el = $('#card')
  el.classList.remove('hidden')
  const band = info.c
  const approx = i >= 0 && (D.trees.flags[i] & 1)
  const landmark = i >= 0 && (D.trees.flags[i] & 2)
  const significant = i >= 0 && (D.trees.flags[i] & 4)
  const dbh = i >= 0 ? D.trees.dbh[i] : 0
  const chips = [`<span class="chip">${HABIT[info.k] || 'Tree'}</span>`]
  if (landmark) chips.push('<span class="chip hot">★ Landmark tree</span>')
  if (significant) chips.push('<span class="chip hot">Significant tree</span>')
  if (approx) chips.push('<span class="chip warn">Approximate position</span>')
  const pct = rec.n / ST * 100
  const facts = info.facts.length ? `<ul class="c-list">${info.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''
  const wiki = info.unknown ? '' : `<a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(info.base || info.sci)}" target="_blank" rel="noopener">Learn more ↗</a>`
  let place = ''
  if (i >= 0) {
    const x = D.trees.x[i] * 0.5, y = D.trees.y[i] * 0.5
    const [lat, lon] = toLatLon(x, y)
    place = `<dt>${approx ? 'Position' : 'GPS'}</dt><dd data-pos style="font-family:var(--mono);font-size:12px">${lat.toFixed(6)}, ${lon.toFixed(6)}</dd>
      <dt>Est. height</dt><dd>${Math.round(T.H[i])} m <span class="muted">(${Math.round(T.H[i] * 3.28)} ft, modelled)</span></dd>
      ${dbh ? `<dt>Trunk (DBH)</dt><dd>${dbh} in <span class="muted">(${Math.round(dbh * 2.54)} cm)</span></dd>` : ''}`
  }
  el.innerHTML = `
    <div class="c-band" style="background:linear-gradient(135deg, ${band}, ${shade(band, -0.25)})">
      <div class="c-hab">${i >= 0 ? (approx ? 'Park tree' : 'Street tree') : 'Species'}${info.genus ? ' · ' + esc(info.genus) : ''}</div>
      ${sil(info.a, shade(band, 0.18), shade(info.t, 0.1))}
      <button class="c-x" title="Close (X)">×</button>
    </div>
    <div class="c-body">
      <h2 class="c-name">${esc(info.name)}</h2>
      ${info.sci ? `<div class="c-sci">${esc(info.sci)}</div>` : ''}
      <div class="c-fam">${info.family && info.family !== '—' ? esc(info.family) : ''}${info.datasetName && info.datasetName !== info.name ? ' · listed as “' + esc(info.datasetName) + '”' : ''}</div>
      <div class="chips">${chips.join('')}</div>
      <div class="c-sec">Field marks</div>
      <div class="marks">
        <figure><canvas id="c-leafsw" width="120" height="120"></canvas><figcaption>${esc(LEAF_DESC[leafKey(sp)] || (leafKey(sp) === 'blossom' ? 'In flower now' : ''))}</figcaption></figure>
        <figure><canvas id="c-barksw" width="120" height="120"></canvas><figcaption>${esc(BARK_DESC[barkKey(sp)] || '')}</figcaption></figure>
        <figure class="shape">${sil(info.a, info.c, info.t)}<figcaption>${esc(SHAPE_DESC[info.a] || '')}</figcaption></figure>
      </div>
      ${i >= 0 ? `<div class="c-sec">This tree</div><dl class="facts" id="c-tree">${place}<dt>Record</dt><dd class="muted">${approx ? '—' : 'loading…'}</dd></dl>` : ''}
      ${landmark ? `<div class="c-sf">A designated San Francisco Landmark Tree. The Board of Supervisors protects trees like this one for their age, size, rarity, history or beauty.</div>` : ''}
      ${approx ? `<div class="c-approx">San Francisco publishes its street tree survey, but not the Recreation and Park Department's inventory of about 131,000 park trees. This tree is planted from the park's documented species mix and layout (edge rows, groves, open lawns), so its exact position and size are illustrative.</div>` : ''}
      <div class="c-sec">The species</div>
      <dl class="facts">
        <dt>Native to</dt><dd>${esc(info.origin)}</dd>
        <dt>Typical height</dt><dd>~${info.h} m on SF streets</dd>
        <dt>In the city</dt><dd>${fmt(rec.n)} street trees${rec.n ? ` · ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% · #${rankOf(sp)}` : ''}<div class="bar"><i style="width:${Math.min(100, Math.sqrt(pct / 6.4) * 100)}%"></i></div></dd>
      </dl>
      ${facts}
      ${info.sf ? `<div class="c-sf">${esc(info.sf)}</div>` : ''}
      ${info.note ? `<div class="c-note">${esc(info.note)}</div>` : ''}
      <div class="c-actions">
        ${i >= 0 ? `<button class="pri" id="c-fly">Fly above it</button><button id="c-walk">Walk to it</button>` : ''}
        ${rec.n + rec.na > 1 ? `<button class="${i >= 0 ? '' : 'pri'}" id="c-track">Show all of this species</button>` : ''}
        ${wiki}
      </div>
      <div class="c-foot">${i >= 0 && !approx ? 'Source: SF Public Works Street Tree List · ' : ''}<kbd>X</kbd> or <kbd>Esc</kbd> close</div>
    </div>`
  el.querySelector('.c-x').onclick = closeCard
  try {
    const lk = T.looks[sp], at = T.atlas
    if (at) {
      swatch(el.querySelector('#c-leafsw'), at.leafCanvas, lk.leaf, 4, 512, hex3(info.c), lk.flower ? hex3(lk.flower) : null)
      swatch(el.querySelector('#c-barksw'), at.barkCanvas, lk.bark, 4, 256, hex3(info.t), null)
    }
  } catch (e) { }
  const tb = el.querySelector('#c-track'); if (tb) tb.onclick = () => onTrack(sp)
  const wb = el.querySelector('#c-walk'); if (wb) wb.onclick = () => onWalk(i)
  const fb = el.querySelector('#c-fly'); if (fb) fb.onclick = () => onFly(i)
  // journal
  if (i >= 0) {
    const first = record(sp)
    const nFound = Object.keys(journal().species).length
    $('#j-count').textContent = nFound
    if (first) toast(`New species: <b>${esc(info.name)}</b> <span class="muted">${nFound} / ${speciesTotal()}</span>`, info.c)
  }
  // park trees: which park
  if (i >= 0 && approx) {
    const m = await treeMeta(i)
    if (!current || current.i !== i) return
    const dl = el.querySelector('#c-tree')
    if (dl && typeof m === 'string' && m !== 'Park' && !dl.dataset.filled) { dl.dataset.filled = '1'; dl.lastElementChild.remove(); dl.lastElementChild.remove(); dl.insertAdjacentHTML('afterbegin', `<dt>Park</dt><dd>${esc(m.replace(/\bRec\b/, 'Recreation').replace(/\(Rec\/Park\)/, ''))}</dd>`) }
  }
  // async record details
  if (i >= 0 && !approx) {
    const m = await treeMeta(i)
    if (!current || current.i !== i) return
    const dl = el.querySelector('#c-tree'); if (!dl || !m) return
    const [id, addr, date, site, care, legal, , lat, lon] = m
    if (lat) { const pos = dl.querySelector('dd[data-pos]'); if (pos) pos.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}` }
    dl.lastElementChild.remove(); dl.lastElementChild.remove()
    const rows = []
    if (addr) rows.push(`<dt>Address</dt><dd>${esc(addr)}</dd>`)
    if (site && site !== ':') rows.push(`<dt>Site</dt><dd>${esc(site.replace(/\s*:\s*/g, ' · '))}</dd>`)
    if (date) rows.push(`<dt>Planted</dt><dd>${esc(ago(date))}</dd>`)
    if (care) rows.push(`<dt>Cared for by</dt><dd>${esc(care === 'Private' ? 'Property owner' : care)}</dd>`)
    if (legal) rows.push(`<dt>Status</dt><dd>${esc(legal)}</dd>`)
    rows.push(`<dt>Tree ID</dt><dd style="font-family:var(--mono);font-size:12px">#${id}</dd>`)
    dl.insertAdjacentHTML('afterbegin', rows.join(''))
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255
  const f = c => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

import { LEAF, BARK } from '../info/looks.js'
function leafKey(sp) { const v = T.looks[sp].leaf; return Object.keys(LEAF).find(k => LEAF[k] === v) }
function barkKey(sp) { const v = T.looks[sp].bark; return Object.keys(BARK).find(k => BARK[k] === v) }
