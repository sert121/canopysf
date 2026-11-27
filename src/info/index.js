import { GENERA } from './genera.js'
import { SPECIES } from './species.js'

const GENERIC = {
  tree: { f: '—', a: 'round', c: '#6a8a4c', t: '#5d5248', h: 8, k: 'ever', o: '—', n: 'The city has not recorded a species for this tree.' },
  palm: { f: 'Arecaceae', a: 'palmfeather', c: '#5f8a42', t: '#8a7a62', h: 9, k: 'palm', o: '—', n: 'A palm the city lists without a genus.' },
}

function follow(tbl, key) {
  let e = tbl[key], guard = 0
  while (e && e.alias && guard++ < 5) { key = e.alias; e = tbl[key] }
  return e ? { e, key } : null
}

export function cleanSci(sci) {
  return sci.replace(/'[^']*'/g, '').replace(/\s+/g, ' ').trim()
}
export function baseName(sci) {
  const w = cleanSci(sci).split(' ').filter(Boolean)
  if (!w.length) return ''
  if (w.length >= 3 && w[1] === 'x') return w.slice(0, 3).join(' ')
  return w.slice(0, 2).join(' ')
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
function prettyCommon(c) {
  if (!c) return ''
  // dataset uses "A: B" for alternatives; keep the most specific readable part
  const parts = c.split(':').map(s => s.trim()).filter(Boolean)
  return cap(parts.length > 1 ? parts[parts.length - 1] : parts[0])
}

// Resolve one dataset species record to a merged, display-ready description.
export function resolve(rec) {
  const sci = rec.sci || ''
  const genus = cleanSci(sci).split(' ')[0] || ''
  const base = baseName(sci)
  let g = follow(GENERA, genus)
  let gen = g ? g.e : null
  if (gen && gen.generic) gen = GENERIC[gen.generic]
  if (!gen) gen = GENERIC.tree
  const s = follow(SPECIES, base) || follow(SPECIES, genus)
  const sp = s ? s.e : {}
  const unknown = !sci || /^tree/i.test(sci) || sci === '' || (gen === GENERIC.tree && !s)
  const cultivar = (sci.match(/'[^']*'/) || [''])[0]
  const out = {
    sci: unknown ? '' : cleanSci(sci) + (cultivar ? ' ' + cultivar : ''),
    rawSci: sci,
    base,
    genus: unknown ? '' : (g ? g.key : genus),
    name: unknown ? 'Unidentified tree' : (sp.name ? sp.name + (cultivar && !sp.name.includes(cultivar) ? ' ' + cultivar : '') : prettyCommon(rec.common) || cleanSci(sci)),
    datasetName: prettyCommon(rec.common),
    family: sp.f || gen.f,
    a: sp.a || gen.a, c: sp.c || gen.c, t: sp.t || gen.t, h: sp.h || gen.h, k: sp.k || gen.k,
    origin: sp.o || gen.o,
    facts: sp.facts || [],
    sf: sp.sf || '',
    note: gen.n || '',
    bloom: sp.bloom !== undefined ? sp.bloom : gen.bloom,
    fall: sp.fall || gen.fall,
    bare: sp.bare !== undefined ? sp.bare : gen.bare,
    unknown,
  }
  if (out.k === 'ever' || out.k === 'palm' || out.k === 'con') { if (!sp.bare) out.bare = [] }
  return out
}

export const HABIT = { dec: 'Deciduous', ever: 'Evergreen', con: 'Conifer', palm: 'Palm', semi: 'Semi-evergreen' }

// Seasonal canopy colour for a month (1..12). Returns {color:[r,g,b], bare:bool, bloom:bool}
export function seasonal(info, month, rnd) {
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
  let col = hex(info.c)
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const bare = !!(info.bare && info.bare.includes(month)) && rnd > 0.12
  if (info.bloom && info.bloom.m.includes(month) && !bare) {
    return { color: mix(col, hex(info.bloom.c), 0.55 + 0.3 * rnd), bare: false, bloom: true }
  }
  if (info.fall && (info.k === 'dec' || info.k === 'semi')) {
    const ft = { 10: 0.25, 11: 0.75, 12: 0.95, 1: 0.9 }[month] || 0
    if (ft > 0) col = mix(col, hex(info.fall), Math.min(1, ft * (0.6 + 0.8 * rnd)))
  }
  if (bare) col = mix(col, [0.45, 0.38, 0.33], 0.75)
  return { color: col, bare, bloom: false }
}
