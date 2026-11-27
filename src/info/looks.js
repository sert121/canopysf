// Visual identity per genus/species: leaf texture, bark texture, flower colour.
// Leaf tiles (atlas index)
export const LEAF = { broad: 0, palmate: 1, small: 2, needle: 3, scale: 4, feather: 5, sickle: 6, heart: 7, fan: 8, oak: 9, palmfeather: 10, palmfan: 11, blossom: 12, strap: 13, brush: 14, willow: 15 }
// Bark tiles
export const BARK = { furrowed: 0, smooth: 1, camo: 2, white: 3, redpeel: 4, plates: 5, diamond: 6, rings: 7, fiber: 8 }

// genus -> [leaf, bark, flower colour?]
const G = {
  Platanus: ['palmate', 'camo'], Lophostemon: ['broad', 'redpeel'], Tristania: ['broad', 'redpeel'], Tristaniopsis: ['broad', 'camo'],
  Metrosideros: ['brush', 'furrowed', '#c8302a'], Magnolia: ['broad', 'smooth'], Michelia: ['broad', 'smooth'], Pittosporum: ['broad', 'smooth'],
  Prunus: ['broad', 'smooth', '#f2b6c8'], Ficus: ['broad', 'smooth'], Arbutus: ['broad', 'redpeel', '#f1d9d6'], Olea: ['small', 'furrowed'],
  Pyrus: ['broad', 'furrowed', '#f4f1ea'], Acacia: ['sickle', 'furrowed', '#ecd23a'], Maytenus: ['willow', 'furrowed'], Ginkgo: ['fan', 'furrowed'],
  Corymbia: ['sickle', 'white', '#e04a34'], Callistemon: ['brush', 'furrowed', '#cc2a2a'], Ulmus: ['small', 'camo'], Eriobotrya: ['broad', 'smooth', '#f2ecdc'],
  Pinus: ['needle', 'plates'], Ligustrum: ['broad', 'smooth', '#f3efe2'], Privet: ['broad', 'smooth'], Cupressus: ['scale', 'fiber'], Hesperocyparis: ['scale', 'fiber'],
  Cupressocyparis: ['scale', 'fiber'], Melaleuca: ['sickle', 'white', '#f3efdc'], Cordyline: ['strap', 'fiber', '#f1ead0'], Liquidambar: ['palmate', 'furrowed'],
  Myoporum: ['broad', 'furrowed'], Juniperus: ['scale', 'fiber'], Jacaranda: ['feather', 'smooth', '#8d78d8'], Lagunaria: ['broad', 'furrowed', '#e8a6b8'],
  Acer: ['palmate', 'smooth'], Agonis: ['willow', 'furrowed'], Schinus: ['feather', 'furrowed', '#d24a5a'], Washingtonia: ['palmfan', 'fiber'],
  Eucalyptus: ['sickle', 'white', '#f1ecd4'], Angophora: ['sickle', 'white'], Angohpora: ['sickle', 'white'], Phoenix: ['palmfeather', 'diamond'], Laurus: ['broad', 'smooth'],
  Syagrus: ['palmfeather', 'rings'], Arecastrum: ['palmfeather', 'rings'], Archontophoenix: ['palmfeather', 'rings'], Howea: ['palmfeather', 'rings'],
  Ceratonia: ['broad', 'furrowed'], Rhaphiolepis: ['broad', 'smooth', '#f1c4d0'], Dodonaea: ['small', 'furrowed'], Crataegus: ['oak', 'furrowed', '#f4f0e6'], Crateagus: ['oak', 'furrowed'],
  Leptospermum: ['small', 'fiber', '#f3d6de'], Afrocarpus: ['willow', 'fiber'], Podocarpus: ['sickle', 'fiber'], Quercus: ['oak', 'furrowed'], Rhamnus: ['small', 'smooth'],
  Lyonothamnus: ['feather', 'redpeel'], Fraxinus: ['feather', 'furrowed'], Geijera: ['willow', 'furrowed'], Syzygium: ['broad', 'smooth', '#e2508a'], Pistacia: ['feather', 'furrowed'],
  Photinia: ['broad', 'smooth', '#f2eee2'], Yucca: ['strap', 'fiber', '#f3efe0'], Trachycarpus: ['palmfan', 'fiber'], Chamaerops: ['palmfan', 'fiber'], Brahea: ['palmfan', 'fiber'],
  Livistona: ['palmfan', 'rings'], Ceanothus: ['small', 'smooth', '#6f80d0'], Taxus: ['scale', 'redpeel'], Sequoia: ['scale', 'fiber'], Sequoiadendron: ['scale', 'fiber'],
  Metasequoia: ['feather', 'fiber'], Taxodium: ['feather', 'fiber'], Populus: ['heart', 'smooth'], Robinia: ['feather', 'furrowed', '#c98ab9'], Liriodendron: ['palmate', 'furrowed'],
  Koelreuteria: ['feather', 'furrowed', '#e8cf3e'], Cupaniopsis: ['broad', 'smooth'], Hymenosporum: ['broad', 'smooth', '#f2df8a'], Celtis: ['broad', 'smooth'],
  Cotoneaster: ['small', 'smooth'], Betula: ['small', 'white'], Tilia: ['heart', 'furrowed'], Aesculus: ['palmate', 'smooth', '#ef9a94'], Thuja: ['scale', 'fiber'], Platycladus: ['scale', 'fiber'],
  Cedrus: ['needle', 'plates'], Malus: ['broad', 'furrowed', '#f4c6d4'], Citrus: ['broad', 'smooth', '#f6f2e4'], Fortunella: ['broad', 'smooth'], Cinnamomum: ['broad', 'furrowed'],
  Gleditsia: ['feather', 'furrowed'], Zelkova: ['small', 'smooth'], Grevillea: ['feather', 'furrowed', '#e3a33a'], Lagerstroemia: ['small', 'camo', '#d77fae'], Hakea: ['needle', 'furrowed'],
  Morus: ['heart', 'furrowed'], Ceiba: ['palmate', 'smooth', '#e57ab0'], Chorisia: ['palmate', 'smooth', '#e57ab0'], Carpinus: ['broad', 'smooth'], Salix: ['willow', 'furrowed'],
  Alnus: ['broad', 'smooth'], Elaeocarpus: ['broad', 'smooth'], Heteromeles: ['broad', 'smooth', '#f1ecd6'], Albizia: ['feather', 'smooth', '#ef9fc0'], Calocedrus: ['scale', 'redpeel'],
  Cassia: ['feather', 'smooth', '#f0cf3a'], Tibouchina: ['broad', 'smooth', '#7a3fb0'], Tibochina: ['broad', 'smooth', '#7a3fb0'], Casuarina: ['needle', 'furrowed'], Casurina: ['needle', 'furrowed'],
  Azara: ['small', 'smooth'], Dracaena: ['strap', 'smooth'], Juglans: ['feather', 'furrowed'], Nerium: ['sickle', 'smooth', '#ee9fb0'], Araucaria: ['needle', 'plates'],
  Persea: ['broad', 'furrowed'], Cercis: ['heart', 'smooth', '#c84d9a'], Brachychiton: ['broad', 'smooth'], Nyssa: ['broad', 'furrowed'], Quillaja: ['broad', 'furrowed'],
  Umbellularia: ['broad', 'smooth'], Bambusa: ['willow', 'rings'], Fremontodendron: ['palmate', 'furrowed', '#eec43a'], Banksia: ['sickle', 'furrowed'], Fagus: ['broad', 'smooth'],
  Dicksonia: ['palmfeather', 'fiber'], Chitalpa: ['heart', 'smooth', '#ebc6dc'], Cussonia: ['palmate', 'smooth'], Styphnolobium: ['feather', 'furrowed'], Cotinus: ['broad', 'smooth'],
  Chamaecyparis: ['scale', 'fiber'], Musa: ['palmfeather', 'rings'], Sophora: ['feather', 'smooth', '#eacb3a'], Dypsis: ['palmfeather', 'rings'], Cryptomeria: ['scale', 'fiber'],
  Psidium: ['broad', 'camo'], Leucadendron: ['small', 'smooth'], Ailanthus: ['feather', 'smooth'], Aloe: ['strap', 'fiber', '#e8782e'], Arctostaphylos: ['small', 'redpeel'],
  Garrya: ['broad', 'smooth'], Sambucus: ['feather', 'furrowed'], Chionanthus: ['broad', 'smooth'], Syringa: ['heart', 'smooth', '#b598d6'], Chiranthodendron: ['palmate', 'furrowed', '#c8302a'],
  Griselinia: ['broad', 'smooth'], Butia: ['palmfeather', 'diamond'], Jubaea: ['palmfeather', 'diamond'], Rhopalostylis: ['palmfeather', 'rings'], Wodyetia: ['palmfeather', 'rings'],
  Caryota: ['palmfeather', 'rings'], Schefflera: ['palmate', 'smooth'], Myrica: ['small', 'smooth'], Abutilon: ['palmate', 'smooth', '#ef8a3a'], Punica: ['small', 'smooth', '#e0452e'],
  Viburnum: ['broad', 'smooth', '#f3efe2'], Sapium: ['heart', 'furrowed'], Acca: ['broad', 'smooth', '#d83a4a'], Paulownia: ['heart', 'smooth'], Radermachera: ['feather', 'smooth'],
  Diospyros: ['broad', 'plates'], Escallonia: ['small', 'smooth', '#e88aa8'], Melia: ['feather', 'furrowed'], Beaucarnea: ['strap', 'furrowed'], Ziziphus: ['small', 'furrowed'],
  Corynocarpus: ['broad', 'smooth'], Cycas: ['palmfeather', 'fiber'], Meryta: ['broad', 'smooth'], Tecoma: ['feather', 'smooth', '#eec23a'], Corylus: ['heart', 'smooth'],
  Erythrina: ['heart', 'smooth', '#e0402e'], Styrax: ['broad', 'smooth'], Xylosma: ['small', 'smooth'], Cercidiphyllum: ['heart', 'furrowed'], Castanea: ['broad', 'furrowed'],
  Sorbus: ['feather', 'smooth'], Pseudopanax: ['strap', 'smooth'], Elaeagnus: ['small', 'furrowed'], Carya: ['feather', 'furrowed'], Macadamia: ['broad', 'smooth'],
  Mangifera: ['broad', 'furrowed'], Torreya: ['scale', 'fiber'], Euphorbia: ['strap', 'smooth'], Cercocarpus: ['small', 'furrowed'], Moringa: ['feather', 'smooth'],
  Catalpa: ['heart', 'furrowed'], Chilopsis: ['willow', 'furrowed'], Crinodendron: ['small', 'smooth', '#c8302a'], Lithocarpus: ['broad', 'furrowed'], Notholithocarpus: ['broad', 'furrowed'],
  Stenocarpus: ['broad', 'smooth'], Ilex: ['oak', 'smooth'], Pseudotsuga: ['scale', 'plates'], Picea: ['needle', 'plates'], Cornus: ['broad', 'smooth', '#f3efe2'], Rhus: ['feather', 'furrowed'],
  Solanum: ['broad', 'smooth', '#8a7ad6'], Brugmansia: ['broad', 'smooth', '#f2e2b8'], Pyracantha: ['small', 'smooth'],
}
// per-species overrides (base name)
const S = {
  'Acacia baileyana': ['feather'], 'Acacia stenophylla': ['willow'], 'Schinus molle': ['willow'], 'Eucalyptus sideroxylon': [, 'plates'],
  'Eucalyptus polyanthemos': ['broad'], 'Pittosporum tenuifolium': ['small'], 'Pittosporum crassifolium': ['small'], 'Callistemon viminalis': ['willow'],
  'Corymbia ficifolia': ['broad', 'furrowed'], 'Melaleuca quinquenervia': ['broad'], 'Pinus pinea': [, 'redpeel'], 'Pinus canariensis': [, 'plates'],
  'Ulmus americana': ['broad', 'furrowed'], 'Ulmus pumila': ['small', 'furrowed'], 'Quercus suber': [, 'plates'], 'Cupressus sempervirens': ['scale'],
  'Ligustrum lucidum': ['broad'], 'Magnolia x soulangiana': ['broad', 'smooth', '#f0c6d6'],
}
const BY_ARCH = { round: 'broad', oval: 'broad', column: 'small', spread: 'broad', umbrella: 'needle', vase: 'small', cone: 'scale', araucaria: 'needle', cypress: 'scale', pine: 'needle', gum: 'sickle', weep: 'willow', palmfan: 'palmfan', palmfeather: 'palmfeather', tuft: 'strap' }

export function lookFor(info) {
  const g = G[info.genus] || []
  const s = S[info.base] || []
  const leaf = s[0] || g[0] || BY_ARCH[info.a] || 'broad'
  const bark = s[1] || g[1] || (info.k === 'palm' ? 'rings' : 'furrowed')
  const flower = (info.bloom && info.bloom.c) || s[2] || g[2] || null
  return { leaf: LEAF[leaf], bark: BARK[bark], flower, leafName: leaf }
}
