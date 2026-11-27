// Species growth models for San Francisco's trees. Units are arbitrary (normalised later to height 1).
// trunk.length ≈ clear trunk + leader; crownStart = where scaffold limbs begin (0..1 along trunk).
// Shapes follow Weber & Penn: conical, spherical, hemispherical, cylindrical, tapered, flame, inverse, tendflame, oval.

const L = (children, angle, length, o = {}) => ({ children, angle, length, angleVar: 12, gnarl: 0.12, taper: 0.7, radius: 0.55, sections: 5, segs: 5, ...o })

export const MODELS = {
  // London plane: tall, clean trunk; broad oval crown of heavy scaffold limbs; big maple-like leaves
  plane: { trunk: { length: 1.05, radius: 0.055, flare: 0.35, taper: 0.55, gnarl: 0.03, sections: 10, segs: 10, crownStart: 0.32 }, shape: 'oval',
    levels: [L(8, 50, 0.66, { gnarl: 0.1, force: 0.02, sections: 6, segs: 7 }), L(5, 42, 0.5, { gnarl: 0.14, sections: 4, segs: 4 }), L(4, 38, 0.42, { gnarl: 0.18, force: -0.01, sections: 2, segs: 3, start: 0.3 })],
    leaves: { count: 6, size: 0.22, start: 0.2 }, core: 0.4 },
  // Brisbane box: straight trunk, upright dense oval; leaves in whorls at branch tips
  brisbane: { trunk: { length: 1.1, radius: 0.05, flare: 0.25, taper: 0.6, gnarl: 0.015, sections: 10, segs: 9, crownStart: 0.38 }, shape: 'tendflame',
    levels: [L(12, 34, 0.46, { force: 0.025, gnarl: 0.08, sections: 5, segs: 6 }), L(4, 38, 0.5, { sections: 3, segs: 4 }), L(3, 34, 0.42, { sections: 2, segs: 3, start: 0.4 })],
    leaves: { count: 4, size: 0.16, start: 0.55, cluster: 2 }, core: 0.72 },
  // Water gum: narrow, dense, upright; small glossy leaves
  watergum: { trunk: { length: 0.8, radius: 0.04, flare: 0.25, taper: 0.6, gnarl: 0.04, sections: 8, segs: 8, crownStart: 0.25 }, shape: 'oval',
    levels: [L(14, 28, 0.32, { force: 0.03, sections: 4, segs: 5 }), L(4, 34, 0.55, { sections: 3, segs: 3 }), L(3, 30, 0.45, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.13, start: 0.3, cluster: 2 }, core: 0.78 },
  // New Zealand Christmas tree: several trunks, low broad dense dome
  nzxmas: { stems: 3, stemSpread: 0.5, trunk: { length: 0.45, radius: 0.07, flare: 0.3, taper: 0.5, gnarl: 0.08, sections: 6, segs: 8, crownStart: 0.25 }, shape: 'hemispherical',
    levels: [L(6, 62, 1.25, { gnarl: 0.14, sections: 6, segs: 6 }), L(5, 44, 0.48, { sections: 4, segs: 4 }), L(4, 40, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 3, size: 0.22, start: 0.25, cluster: 2 }, core: 0.8, coreFlat: 0.8 },
  // Southern magnolia: dense, dark, broadly pyramidal; big leathery leaves
  magnolia: { trunk: { length: 1.3, radius: 0.05, flare: 0.25, taper: 0.7, gnarl: 0.02, sections: 10, segs: 9, crownStart: 0.12 }, shape: 'tendflame',
    levels: [L(16, 60, 0.52, { force: 0.03, sections: 5, segs: 5 }), L(4, 42, 0.45, { sections: 3, segs: 3 }), L(3, 38, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.21, start: 0.2, cluster: 2 }, core: 0.82 },
  // Victorian box / pittosporum / loquat: round, dense, evergreen
  pittosporum: { trunk: { length: 0.62, radius: 0.05, flare: 0.3, taper: 0.6, gnarl: 0.06, sections: 7, segs: 8, crownStart: 0.35 }, shape: 'spherical',
    levels: [L(8, 50, 0.95, { sections: 5, segs: 5 }), L(5, 42, 0.5, { sections: 3, segs: 3 }), L(3, 38, 0.42, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.17, start: 0.25, cluster: 2 }, core: 0.78 },
  // Cherry plum / flowering cherry: short trunk, vase of ascending limbs, rounded head
  cherry: { trunk: { length: 0.42, radius: 0.05, flare: 0.25, taper: 0.5, gnarl: 0.06, sections: 5, segs: 8, crownStart: 0.9 }, shape: 'spherical',
    levels: [L(5, 38, 1.35, { force: 0.015, gnarl: 0.13, sections: 6, segs: 5 }), L(5, 42, 0.5, { sections: 3, segs: 3 }), L(4, 40, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.17, start: 0.25, cluster: 2 }, core: 0.62 },
  // Indian laurel fig: sheared into a dense block or dome
  ficus: { trunk: { length: 0.6, radius: 0.06, flare: 0.35, taper: 0.5, gnarl: 0.05, sections: 6, segs: 9, crownStart: 0.55 }, shape: 'cylindrical',
    levels: [L(10, 55, 0.78, { sections: 4, segs: 5 }), L(6, 45, 0.45, { sections: 3, segs: 3 }), L(4, 40, 0.38, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.16, start: 0.2, cluster: 2 }, core: 0.92, coreFlat: 0.85 },
  // Strawberry tree 'Marina': two or three sinuous red trunks, rounded crown
  arbutus: { stems: 2, stemSpread: 0.4, trunk: { length: 0.62, radius: 0.05, flare: 0.25, taper: 0.5, gnarl: 0.14, sections: 7, segs: 8, crownStart: 0.5 }, shape: 'spherical',
    levels: [L(6, 45, 1.0, { gnarl: 0.2, sections: 5, segs: 5 }), L(5, 42, 0.5, { gnarl: 0.18, sections: 3, segs: 3 }), L(3, 38, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.16, start: 0.3, cluster: 2 }, core: 0.72 },
  // Olive: gnarled, leaning, open silvery dome
  olive: { stems: 2, stemSpread: 0.45, trunk: { length: 0.45, radius: 0.07, flare: 0.35, taper: 0.5, gnarl: 0.24, sections: 7, segs: 8, crownStart: 0.7 }, shape: 'hemispherical',
    levels: [L(7, 55, 1.1, { gnarl: 0.25, sections: 6, segs: 5 }), L(5, 45, 0.5, { gnarl: 0.25, sections: 3, segs: 3 }), L(4, 40, 0.42, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.15, start: 0.35 }, core: 0.5 },
  // Callery pear: upright teardrop, ascending branches
  pear: { trunk: { length: 0.62, radius: 0.045, flare: 0.25, taper: 0.6, gnarl: 0.04, sections: 7, segs: 8, crownStart: 0.3 }, shape: 'tendflame',
    levels: [L(10, 27, 1.05, { force: 0.03, gnarl: 0.08, sections: 6, segs: 5 }), L(4, 34, 0.45, { sections: 3, segs: 3 }), L(3, 32, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.16, start: 0.25, cluster: 2 }, core: 0.68 },
  // Blackwood acacia, mayten-free evergreens of dense upright habit
  acacia: { trunk: { length: 0.95, radius: 0.05, flare: 0.25, taper: 0.6, gnarl: 0.05, sections: 9, segs: 8, crownStart: 0.25 }, shape: 'oval',
    levels: [L(12, 45, 0.62, { force: 0.015, sections: 5, segs: 5 }), L(5, 40, 0.48, { sections: 3, segs: 3 }), L(3, 36, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.17, start: 0.25, cluster: 2 }, core: 0.78 },
  // Weeping fine-leaved evergreens: mayten, peppermint willow, Australian willow, weeping bottlebrush
  weeping: { trunk: { length: 0.75, radius: 0.045, flare: 0.25, taper: 0.6, gnarl: 0.08, sections: 8, segs: 8, crownStart: 0.45 }, shape: 'spherical',
    levels: [L(8, 50, 0.85, { gnarl: 0.12, sections: 5, segs: 5 }), L(5, 42, 0.65, { droop: 0.5, sections: 4, segs: 3 }), L(5, 30, 0.55, { droop: 0.9, sections: 3, segs: 3 })],
    leaves: { count: 6, size: 0.15, start: 0.1, droop: 0.75, length: 1.7, aspect: 0.55 }, core: 0.45 },
  // Ginkgo: open, irregular, upswept scaffold; leaves on short spurs
  ginkgo: { trunk: { length: 1.25, radius: 0.045, flare: 0.25, taper: 0.7, gnarl: 0.03, sections: 10, segs: 8, crownStart: 0.25 }, shape: 'tendflame',
    levels: [L(9, 50, 0.52, { force: 0.045, gnarl: 0.08, sections: 5, segs: 5 }), L(3, 50, 0.42, { sections: 3, segs: 3 }), L(2, 45, 0.35, { sections: 2, segs: 3 })],
    leaves: { count: 7, size: 0.15, start: 0.15, cluster: 2 }, core: 0.3 },
  // Bottlebrush: small, multi-stemmed, arching
  bottlebrush: { stems: 2, stemSpread: 0.45, trunk: { length: 0.5, radius: 0.04, flare: 0.25, taper: 0.5, gnarl: 0.1, sections: 6, segs: 7, crownStart: 0.4 }, shape: 'spherical',
    levels: [L(6, 50, 0.95, { droop: 0.2, sections: 5, segs: 4 }), L(4, 42, 0.55, { droop: 0.3, sections: 3, segs: 3 }), L(3, 38, 0.45, { droop: 0.4, sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.16, start: 0.25, droop: 0.3, cluster: 2 }, core: 0.6 },
  // Chinese elm: broad, arching to weeping canopy
  elm: { trunk: { length: 0.8, radius: 0.05, flare: 0.3, taper: 0.6, gnarl: 0.06, sections: 8, segs: 8, crownStart: 0.42 }, shape: 'hemispherical',
    levels: [L(7, 58, 1.1, { force: 0.01, gnarl: 0.12, sections: 6, segs: 5 }), L(5, 44, 0.58, { droop: 0.25, sections: 4, segs: 3 }), L(4, 38, 0.48, { droop: 0.45, sections: 2, segs: 3 })],
    leaves: { count: 8, size: 0.17, start: 0.15, droop: 0.35 }, core: 0.55 },
  // Tasmanian blue gum: very tall, straight pale trunk, high open crown of hanging leaves
  bluegum: { trunk: { length: 2.4, radius: 0.06, flare: 0.3, taper: 0.7, gnarl: 0.035, sections: 14, segs: 9, crownStart: 0.45 }, shape: 'tendflame',
    levels: [L(10, 32, 0.46, { force: 0.035, gnarl: 0.1, sections: 6, segs: 5 }), L(5, 45, 0.55, { droop: 0.15, sections: 4, segs: 3 }), L(4, 35, 0.45, { droop: 0.35, sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.24, start: 0.3, droop: 0.6, length: 1.4, aspect: 0.75 }, core: 0.32 },
  // Monterey pine: big, dark, irregular dome of needle clumps on stout limbs
  mpine: { trunk: { length: 1.2, radius: 0.07, flare: 0.35, taper: 0.65, gnarl: 0.07, sections: 10, segs: 9, crownStart: 0.35 }, shape: 'hemispherical',
    levels: [L(10, 66, 0.78, { force: 0.03, gnarl: 0.15, sections: 6, segs: 5 }), L(4, 44, 0.46, { sections: 3, segs: 3 }), L(3, 40, 0.38, { sections: 2, segs: 3 })],
    leaves: { count: 3, size: 0.24, start: 0.55, cluster: 2, rise: 0.35 }, core: 0.7 },
  // Monterey cypress: leaning trunk, wind-flattened horizontal tiers, dense dark pads on top
  mcypress: { trunk: { length: 0.6, radius: 0.09, flare: 0.4, taper: 0.55, gnarl: 0.1, sections: 8, segs: 9, crownStart: 0.4 }, lean: 0.18, shape: 'hemispherical',
    levels: [L(10, 82, 1.35, { force: 0.022, gnarl: 0.12, sections: 7, segs: 5 }), L(6, 62, 0.42, { force: 0.01, sections: 3, segs: 3 }), L(4, 52, 0.36, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.3, start: 0.15, flat: true, cluster: 2 }, core: 0.8, coreFlat: 0.6 },
  // Coast redwood: tall cone, branches sweeping down then up
  redwood: { trunk: { length: 2.2, radius: 0.07, flare: 0.4, taper: 0.9, gnarl: 0.02, sections: 16, segs: 10, crownStart: 0.1 }, shape: 'conical',
    levels: [L(30, 98, 0.36, { droop: 0.12, gnarl: 0.06, sections: 4, segs: 4 }), L(4, 50, 0.45, { droop: 0.2, sections: 2, segs: 3 })],
    leaves: { count: 8, size: 0.24, start: 0.1, droop: 0.2, cluster: 2 }, core: 0.88 },
  // Generic conifers (cedar, cypress relatives, juniper, spruce): dense cone
  conifer: { trunk: { length: 1.6, radius: 0.06, flare: 0.35, taper: 0.9, gnarl: 0.03, sections: 12, segs: 9, crownStart: 0.08 }, shape: 'conical',
    levels: [L(24, 84, 0.42, { droop: 0.05, gnarl: 0.08, sections: 4, segs: 4 }), L(4, 48, 0.45, { sections: 2, segs: 3 })],
    leaves: { count: 8, size: 0.22, start: 0.1, cluster: 2 }, core: 0.88 },
  // Italian cypress / columnar junipers: pencil columns
  italian: { trunk: { length: 1.5, radius: 0.05, flare: 0.25, taper: 0.9, gnarl: 0.02, sections: 12, segs: 8, crownStart: 0.04 }, shape: 'tapered',
    levels: [L(30, 14, 0.16, { force: 0.05, sections: 3, segs: 3 }), L(3, 20, 0.5, { sections: 2, segs: 3 })],
    leaves: { count: 8, size: 0.16, start: 0.05, rise: 0.6, cluster: 2 }, core: 1.0 },
  // Norfolk Island pine: symmetric tiers of horizontal branches
  norfolk: { trunk: { length: 2.0, radius: 0.045, flare: 0.3, taper: 0.95, gnarl: 0.01, sections: 14, segs: 8, crownStart: 0.15 }, shape: 'conical',
    levels: [L(34, 88, 0.36, { gnarl: 0.03, angleVar: 4, sections: 4, segs: 4 }), L(5, 70, 0.3, { sections: 2, segs: 3 })],
    leaves: { count: 7, size: 0.13, start: 0.15, flat: true }, core: 0.18 },
  // Jacaranda / silk tree: open umbrella, fine feathery foliage
  jacaranda: { trunk: { length: 0.7, radius: 0.05, flare: 0.3, taper: 0.6, gnarl: 0.08, sections: 7, segs: 8, crownStart: 0.55 }, shape: 'hemispherical',
    levels: [L(6, 55, 1.25, { gnarl: 0.13, sections: 6, segs: 5 }), L(5, 45, 0.52, { sections: 3, segs: 3 }), L(4, 40, 0.42, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.22, start: 0.3, rise: 0.25 }, core: 0.42 },
  // Sweetgum: excurrent, pyramidal when young, oval later
  sweetgum: { trunk: { length: 1.45, radius: 0.05, flare: 0.3, taper: 0.75, gnarl: 0.02, sections: 12, segs: 9, crownStart: 0.15 }, shape: 'conical',
    levels: [L(18, 55, 0.5, { force: 0.02, sections: 5, segs: 4 }), L(4, 44, 0.45, { sections: 3, segs: 3 }), L(3, 40, 0.38, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.17, start: 0.2 }, core: 0.62 },
  // Maples, ashes, pistache, hawthorn, linden: rounded deciduous
  maple: { trunk: { length: 0.75, radius: 0.05, flare: 0.3, taper: 0.6, gnarl: 0.05, sections: 8, segs: 8, crownStart: 0.38 }, shape: 'spherical',
    levels: [L(8, 46, 0.9, { force: 0.015, sections: 6, segs: 5 }), L(5, 42, 0.5, { sections: 3, segs: 3 }), L(4, 38, 0.42, { sections: 2, segs: 3 })],
    leaves: { count: 4, size: 0.18, start: 0.25, cluster: 2 }, core: 0.64 },
  // Broad-leaved paperbark: dense, irregular, upright; papery white trunk
  melaleuca: { trunk: { length: 0.85, radius: 0.055, flare: 0.3, taper: 0.6, gnarl: 0.09, sections: 9, segs: 8, crownStart: 0.35 }, shape: 'tendflame',
    levels: [L(10, 36, 0.62, { force: 0.02, gnarl: 0.15, sections: 5, segs: 5 }), L(4, 40, 0.48, { sections: 3, segs: 3 }), L(3, 36, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.15, start: 0.3, cluster: 2 }, core: 0.74 },
  // Broadleaf evergreens of rounded habit: laurel, privet, carob, camphor, myoporum
  broadleaf: { trunk: { length: 0.72, radius: 0.05, flare: 0.3, taper: 0.6, gnarl: 0.06, sections: 8, segs: 8, crownStart: 0.36 }, shape: 'spherical',
    levels: [L(9, 48, 0.9, { sections: 5, segs: 5 }), L(5, 42, 0.5, { sections: 3, segs: 3 }), L(3, 38, 0.42, { sections: 2, segs: 3 })],
    leaves: { count: 5, size: 0.17, start: 0.25, cluster: 2 }, core: 0.78 },
  // Coast live oak: short trunk, massive sinuous limbs, broad dense dome
  liveoak: { trunk: { length: 0.42, radius: 0.08, flare: 0.4, taper: 0.5, gnarl: 0.12, sections: 6, segs: 9, crownStart: 0.6 }, shape: 'hemispherical',
    levels: [L(6, 68, 1.5, { gnarl: 0.2, force: 0.005, sections: 7, segs: 6 }), L(5, 46, 0.48, { gnarl: 0.18, sections: 3, segs: 3 }), L(4, 40, 0.4, { sections: 2, segs: 3 })],
    leaves: { count: 6, size: 0.15, start: 0.2, cluster: 2 }, core: 0.74, coreFlat: 0.7 },
  // Pepper tree / willow: weeping curtains
  willow: { trunk: { length: 0.7, radius: 0.06, flare: 0.3, taper: 0.6, gnarl: 0.1, sections: 7, segs: 8, crownStart: 0.5 }, shape: 'spherical',
    levels: [L(7, 55, 1.0, { gnarl: 0.14, sections: 6, segs: 5 }), L(5, 40, 0.62, { droop: 0.55, sections: 4, segs: 3 }), L(5, 22, 0.6, { droop: 1.0, sections: 3, segs: 3 })],
    leaves: { count: 6, size: 0.16, start: 0.05, droop: 0.85, length: 1.9, aspect: 0.5 }, core: 0.32 },
  // Shrubby small trees: tea tree, photinia, rhaphiolepis, hopbush, cotoneaster
  shrubby: { stems: 3, stemSpread: 0.5, trunk: { length: 0.32, radius: 0.035, flare: 0.25, taper: 0.5, gnarl: 0.1, sections: 5, segs: 6, crownStart: 0.5 }, shape: 'spherical',
    levels: [L(6, 45, 1.1, { gnarl: 0.15, sections: 4, segs: 4 }), L(5, 42, 0.5, { sections: 3, segs: 3 })],
    leaves: { count: 7, size: 0.18, start: 0.2, cluster: 2 }, core: 0.8 },
  // Lombardy poplar: columnar deciduous
  poplar: { trunk: { length: 1.5, radius: 0.045, flare: 0.25, taper: 0.85, gnarl: 0.02, sections: 12, segs: 8, crownStart: 0.08 }, shape: 'tapered',
    levels: [L(26, 16, 0.24, { force: 0.05, sections: 3, segs: 3 }), L(3, 22, 0.5, { sections: 2, segs: 3 })],
    leaves: { count: 6, size: 0.13, start: 0.1, rise: 0.4 }, core: 0.8 },
  // Italian stone pine: tall bare trunk, flat umbrella
  stonepine: { trunk: { length: 1.4, radius: 0.06, flare: 0.3, taper: 0.6, gnarl: 0.05, sections: 10, segs: 9, crownStart: 0.85 }, lean: 0.05, shape: 'inverse',
    levels: [L(7, 52, 0.62, { force: 0.03, gnarl: 0.1, sections: 5, segs: 5 }), L(4, 50, 0.45, { sections: 3, segs: 3 }), L(3, 45, 0.38, { sections: 2, segs: 3 })],
    leaves: { count: 3, size: 0.24, start: 0.6, flat: true, cluster: 2 }, core: 0.55, coreFlat: 0.45 },
}

// Palms and rosettes
export const PALMS = {
  canary: { palm: true, kind: 'feather', height: 1, radius: 0.085, base: 0.25, taper: 0.1, bulge: 0.12, fronds: 110, frondLen: 0.6, frondW: 0.07, tiltTop: 1.2, tiltLow: -0.6, droop: 0.7, ball: 0.13, curve: 0.02 },
  washingtonia: { palm: true, kind: 'fan', height: 1, radius: 0.028, base: 0.7, taper: 0.25, fronds: 34, frondLen: 0.19, tiltTop: 1.3, tiltLow: -0.25, skirt: 0.16, curve: 0.07 },
  queen: { palm: true, kind: 'feather', height: 1, radius: 0.036, base: 0.3, taper: 0.06, fronds: 15, frondLen: 0.36, frondW: 0.08, tiltTop: 1.25, tiltLow: -0.1, droop: 1.0, curve: 0.06 },
  fanpalm: { palm: true, kind: 'fan', height: 1, radius: 0.06, base: 0.3, taper: 0.1, fronds: 22, frondLen: 0.34, tiltTop: 1.2, tiltLow: -0.4, curve: 0.04 },
  cordyline: { rosette: true, trunk: 0.5, radius: 0.04, heads: 4, leaves: 34, leafW: 0.09, leafL: 0.3 },
}

// species / genus -> model
const BY_BASE = {
  'Cupressus macrocarpa': 'mcypress', 'Cupressus sempervirens': 'italian', 'Pinus pinea': 'stonepine', 'Pinus radiata': 'mpine',
  'Acacia baileyana': 'jacaranda', 'Schinus molle': 'willow', 'Schinus terebinthifolius': 'olive', 'Callistemon viminalis': 'weeping',
  'Magnolia grandiflora': 'magnolia', 'Phoenix canariensis': 'canary', 'Phoenix dactylifera': 'canary', 'Washingtonia robusta': 'washingtonia',
  'Washingtonia filifera': 'fanpalm', 'Eucalyptus polyanthemos': 'olive', 'Eucalyptus nicholii': 'weeping', 'Populus nigra': 'poplar',
  'Juniperus chinensis': 'italian', 'Platanus racemosa': 'liveoak', 'Quercus suber': 'liveoak', 'Ulmus americana': 'elm',
  'Prunus lyonii': 'broadleaf', 'Prunus laurocerasus': 'broadleaf', 'Corymbia ficifolia': 'pittosporum',
}
const BY_GENUS = {
  Platanus: 'plane', Lophostemon: 'brisbane', Tristania: 'brisbane', Tristaniopsis: 'watergum', Metrosideros: 'nzxmas', Magnolia: 'maple', Michelia: 'broadleaf',
  Pittosporum: 'pittosporum', Prunus: 'cherry', Malus: 'cherry', Ficus: 'ficus', Arbutus: 'arbutus', Olea: 'olive', Pyrus: 'pear', Acacia: 'acacia', Maytenus: 'weeping',
  Ginkgo: 'ginkgo', Corymbia: 'pittosporum', Callistemon: 'bottlebrush', Ulmus: 'elm', Zelkova: 'elm', Celtis: 'elm', Eriobotrya: 'pittosporum', Pinus: 'mpine',
  Ligustrum: 'broadleaf', Privet: 'broadleaf', Cupressus: 'mcypress', Hesperocyparis: 'mcypress', Cupressocyparis: 'conifer', Juniperus: 'conifer', Thuja: 'italian',
  Calocedrus: 'conifer', Chamaecyparis: 'conifer', Cedrus: 'conifer', Picea: 'conifer', Pseudotsuga: 'conifer', Taxus: 'conifer', Torreya: 'conifer', Cryptomeria: 'redwood',
  Melaleuca: 'melaleuca', Cordyline: 'cordyline', Yucca: 'cordyline', Dracaena: 'cordyline', Beaucarnea: 'cordyline', Aloe: 'cordyline',
  Liquidambar: 'sweetgum', Liriodendron: 'sweetgum', Myoporum: 'broadleaf', Jacaranda: 'jacaranda', Albizia: 'jacaranda', Lagunaria: 'brisbane', Acer: 'maple', Agonis: 'weeping',
  Schinus: 'olive', Washingtonia: 'washingtonia', Eucalyptus: 'bluegum', Angophora: 'bluegum', Angohpora: 'bluegum', Phoenix: 'canary', Laurus: 'broadleaf',
  Syagrus: 'queen', Arecastrum: 'queen', Archontophoenix: 'queen', Howea: 'queen', Dypsis: 'queen', Rhopalostylis: 'queen', Wodyetia: 'queen', Butia: 'fanpalm', Jubaea: 'canary',
  Ceratonia: 'broadleaf', Rhaphiolepis: 'shrubby', Photinia: 'shrubby', Leptospermum: 'shrubby', Dodonaea: 'shrubby', Cotoneaster: 'shrubby', Pyracantha: 'shrubby',
  Ceanothus: 'shrubby', Heteromeles: 'shrubby', Escallonia: 'shrubby', Viburnum: 'shrubby', Nerium: 'shrubby', Tibouchina: 'shrubby', Tibochina: 'shrubby',
  Crataegus: 'maple', Afrocarpus: 'watergum', Podocarpus: 'watergum', Quercus: 'liveoak', Rhamnus: 'shrubby', Lyonothamnus: 'watergum', Fraxinus: 'maple', Geijera: 'weeping',
  Syzygium: 'watergum', Pistacia: 'maple', Trachycarpus: 'fanpalm', Chamaerops: 'fanpalm', Brahea: 'fanpalm', Livistona: 'fanpalm',
  Sequoia: 'redwood', Sequoiadendron: 'redwood', Metasequoia: 'redwood', Taxodium: 'redwood', Populus: 'poplar', Robinia: 'jacaranda', Koelreuteria: 'maple',
  Cupaniopsis: 'broadleaf', Hymenosporum: 'watergum', Betula: 'weeping', Tilia: 'maple', Aesculus: 'maple', Cinnamomum: 'broadleaf', Gleditsia: 'jacaranda',
  Grevillea: 'acacia', Lagerstroemia: 'cherry', Hakea: 'shrubby', Morus: 'maple', Ceiba: 'jacaranda', Chorisia: 'jacaranda', Carpinus: 'maple', Salix: 'willow',
  Alnus: 'pear', Elaeocarpus: 'watergum', Calocedrus2: 'conifer', Cassia: 'jacaranda', Casuarina: 'mpine', Casurina: 'mpine', Azara: 'watergum', Juglans: 'maple',
  Araucaria: 'norfolk', Persea: 'broadleaf', Cercis: 'cherry', Brachychiton: 'pear', Nyssa: 'pear', Quillaja: 'watergum', Umbellularia: 'liveoak',
  Fagus: 'maple', Dicksonia: 'fanpalm', Chitalpa: 'maple', Styphnolobium: 'maple', Sophora: 'jacaranda', Paulownia: 'maple', Catalpa: 'maple', Chilopsis: 'weeping',
  Punica: 'shrubby', Acca: 'shrubby', Citrus: 'shrubby', Fortunella: 'shrubby', Myrica: 'shrubby', Morella: 'shrubby', Arctostaphylos: 'shrubby',
}
const BY_ARCH = { round: 'broadleaf', oval: 'pear', column: 'italian', spread: 'jacaranda', umbrella: 'stonepine', vase: 'elm', cone: 'conifer', araucaria: 'norfolk',
  cypress: 'mcypress', pine: 'mpine', gum: 'bluegum', weep: 'willow', palmfan: 'fanpalm', palmfeather: 'queen', tuft: 'cordyline' }

export function modelFor(info) {
  return BY_BASE[info.base] || BY_GENUS[info.genus] || BY_ARCH[info.a] || 'broadleaf'
}
export const MODEL_KEYS = [...Object.keys(MODELS), ...Object.keys(PALMS)]
