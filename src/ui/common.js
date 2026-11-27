// Shared UI helpers: species silhouettes, journal storage, toasts, formatting.
import { D } from '../data.js'
import { T } from '../world/trees.js'

export const $ = s => document.querySelector(s)
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function sil(arch, c = '#5f8a48', t = '#5d5248') {
  const tr = (x, y0, y1, w = 6) => `<rect x="${x - w / 2}" y="${y0}" width="${w}" height="${y1 - y0}" rx="2" fill="${t}"/>`
  const S = {
    round: tr(50, 60, 108) + `<circle cx="50" cy="46" r="34" fill="${c}"/><circle cx="30" cy="56" r="18" fill="${c}"/><circle cx="70" cy="56" r="18" fill="${c}"/>`,
    oval: tr(50, 70, 108) + `<ellipse cx="50" cy="46" rx="26" ry="40" fill="${c}"/>`,
    column: tr(50, 90, 108) + `<ellipse cx="50" cy="52" rx="13" ry="46" fill="${c}"/>`,
    spread: tr(50, 56, 108, 7) + `<ellipse cx="50" cy="44" rx="46" ry="22" fill="${c}"/><ellipse cx="28" cy="52" rx="20" ry="12" fill="${c}"/><ellipse cx="72" cy="50" rx="20" ry="12" fill="${c}"/>`,
    umbrella: tr(50, 30, 108, 6) + `<ellipse cx="50" cy="24" rx="46" ry="14" fill="${c}"/>`,
    vase: tr(50, 64, 108, 7) + `<path d="M50 66 L22 34 M50 66 L78 34" stroke="${t}" stroke-width="5"/><ellipse cx="50" cy="30" rx="44" ry="22" fill="${c}"/>`,
    cone: tr(50, 92, 108) + `<path d="M50 6 L82 94 L18 94 Z" fill="${c}"/>`,
    araucaria: tr(50, 8, 108, 4) + [20, 34, 48, 62, 76].map((y, i) => `<path d="M${50 - (10 + i * 7)} ${y + 6} L50 ${y} L${50 + 10 + i * 7} ${y + 6} Z" fill="${c}"/>`).join(''),
    cypress: `<path d="M50 108 C48 80 46 60 56 40" stroke="${t}" stroke-width="7" fill="none"/><ellipse cx="54" cy="30" rx="44" ry="14" fill="${c}"/><ellipse cx="74" cy="46" rx="20" ry="9" fill="${c}"/><ellipse cx="30" cy="50" rx="16" ry="8" fill="${c}"/>`,
    pine: tr(50, 24, 108, 5) + `<ellipse cx="50" cy="20" rx="30" ry="14" fill="${c}"/><ellipse cx="26" cy="44" rx="16" ry="9" fill="${c}"/><ellipse cx="72" cy="38" rx="17" ry="9" fill="${c}"/>`,
    gum: `<path d="M50 108 L50 50 M50 56 L32 22 M50 54 L70 18" stroke="${t}" stroke-width="5" fill="none"/><ellipse cx="32" cy="18" rx="17" ry="10" fill="${c}"/><ellipse cx="70" cy="14" rx="18" ry="10" fill="${c}"/><ellipse cx="52" cy="34" rx="12" ry="8" fill="${c}"/>`,
    weep: tr(50, 50, 108) + `<path d="M50 10 C10 10 8 50 14 80 C26 70 34 64 50 62 C66 64 74 70 86 80 C92 50 90 10 50 10Z" fill="${c}"/>`,
    palmfan: tr(50, 20, 108, 5) + `<circle cx="50" cy="16" r="16" fill="${c}"/>` + [0, 1, 2, 3, 4, 5].map(i => `<path d="M50 16 L${50 + Math.cos(i * 1.05) * 26} ${16 + Math.sin(i * 1.05) * 18}" stroke="${c}" stroke-width="6"/>`).join(''),
    palmfeather: tr(50, 26, 108, 6) + [-1, -0.5, 0, 0.5, 1].map(k => `<path d="M50 24 Q${50 + k * 30} ${8} ${50 + k * 46} ${34 + Math.abs(k) * 6}" stroke="${c}" stroke-width="5" fill="none"/>`).join(''),
    tuft: `<path d="M50 108 L50 60 L36 40 M50 62 L64 36" stroke="${t}" stroke-width="5" fill="none"/>` + [[36, 36], [64, 32]].map(([x, y]) => [0, 1, 2, 3, 4, 5, 6].map(i => `<path d="M${x} ${y} L${x + Math.cos(i * 0.9 - 2.6) * 18} ${y + Math.sin(i * 0.9 - 2.6) * 14}" stroke="${c}" stroke-width="3"/>`).join('')).join(''),
  }
  return `<svg class="sil" viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">${S[arch] || S.round}</svg>`
}

export function speciesColor(sp) {
  const info = T.info[sp]; return info ? info.c : '#6a8a4c'
}

// ---- journal store ----
const KEY = 'canopy-journal-v1'
let J = { species: {}, trees: 0 }
try { const s = localStorage.getItem(KEY); if (s) J = JSON.parse(s) } catch (e) { }
export function journal() { return J }
export function record(sp) {
  const first = !J.species[sp]
  J.species[sp] = J.species[sp] || { n: 0, t: Date.now() }
  J.species[sp].n++
  J.trees++
  try { localStorage.setItem(KEY, JSON.stringify(J)) } catch (e) { }
  return first
}
// species "keys" collapse raw dataset variants that resolve to the same display name
export function speciesTotal() { return D.species.length }

export function toast(html, color) {
  const el = document.createElement('div'); el.className = 'toast'
  el.innerHTML = (color ? `<span class="sw" style="background:${color}"></span>` : '') + html
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4400)
}

export const fmt = n => n.toLocaleString('en-US')
export function bearingWord(deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8] }
