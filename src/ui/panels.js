import { D } from '../data.js'
import { T } from '../world/trees.js'
import { $, esc, sil, fmt, journal } from './common.js'
import { openCard } from './card.js'

// ---------- species catalogue (deduplicated by display name) ----------
let catalogue = null
export function getCatalogue() {
  if (catalogue) return catalogue
  const byName = new Map()
  D.species.forEach((rec, sp) => {
    const info = T.info[sp]
    const key = info.unknown ? '__unknown' : (info.name + '|' + info.base)
    if (!byName.has(key)) byName.set(key, { key, name: info.name, sci: info.sci, base: info.base, arch: info.a, c: info.c, t: info.t, sps: [], n: 0, na: 0, unknown: info.unknown })
    const e = byName.get(key); e.sps.push(sp); e.n += rec.n; e.na += rec.na
  })
  catalogue = [...byName.values()].sort((a, b) => (b.n - a.n) || (b.na - a.na))
  return catalogue
}

// ---------- journal ----------
let jFilter = 'all'
export function renderJournal() {
  const cat = getCatalogue(), J = journal()
  const found = e => e.sps.some(sp => J.species[sp])
  $('#j-found').textContent = cat.filter(found).length
  $('#j-total').textContent = cat.length
  $('#j-trees').textContent = fmt(J.trees)
  const q = ($('#j-search').value || '').toLowerCase()
  const list = cat.filter(e => (jFilter === 'all' || (jFilter === 'found') === found(e)) && (!q || e.name.toLowerCase().includes(q) || e.sci.toLowerCase().includes(q)))
  $('#j-grid').innerHTML = list.slice(0, 600).map(e => {
    const f = found(e)
    return `<div class="jt ${f ? '' : 'locked'}" data-sp="${e.sps[0]}">
      ${f ? '<span class="seen"></span>' : ''}
      ${sil(e.arch, f ? e.c : '#a89c86', f ? e.t : '#8f846f')}
      <b>${esc(f || e.n > 200 ? e.name : 'Unidentified')}</b>
      <i>${esc(f || e.n > 200 ? e.sci : '— — —')}</i>
      <small>${e.n ? fmt(e.n) + ' street trees' : ''}${e.na ? (e.n ? ' · ' : '') + 'park stands' : ''}</small>
    </div>`
  }).join('')
}
export function initJournal() {
  $('#journal .j-tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return
    jFilter = b.dataset.f
    document.querySelectorAll('#journal .j-tabs button').forEach(x => x.classList.toggle('on', x === b))
    renderJournal()
  }
  $('#j-search').oninput = renderJournal
  $('#j-grid').onclick = e => {
    const t = e.target.closest('.jt'); if (!t) return
    openCard({ sp: +t.dataset.sp })
  }
  $('#j-count').textContent = Object.keys(journal().species).length
}

// ---------- search ----------
let results = [], sel = 0
export function initSearch(onPick) {
  const inp = $('#s-input')
  const run = () => {
    const q = inp.value.trim().toLowerCase()
    const cat = getCatalogue().filter(e => !e.unknown)
    results = !q ? cat.slice(0, 12) : cat.filter(e => e.name.toLowerCase().includes(q) || e.sci.toLowerCase().includes(q)).slice(0, 30)
    sel = 0; draw()
  }
  const draw = () => {
    $('#s-results').innerHTML = results.map((e, k) => `<div class="sr ${k === sel ? 'on' : ''}" data-k="${k}"><span class="sw" style="background:${e.c}"></span><div><b>${esc(e.name)}</b><br><i>${esc(e.sci)}</i></div><span class="n">${e.n ? fmt(e.n) : ''}${e.na ? (e.n ? ' + ' : '') + 'parks' : ''}</span></div>`).join('') || '<p class="muted" style="padding:10px">No species by that name in the city’s records.</p>'
  }
  inp.oninput = run
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); draw(); e.preventDefault() }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault() }
    if (e.key === 'Enter' && results[sel]) onPick(results[sel])
    if (e.key === 'Escape') onPick(null)
  }
  $('#s-results').onclick = e => { const r = e.target.closest('.sr'); if (r) onPick(results[+r.dataset.k]) }
  run()
}
