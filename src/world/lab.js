import * as THREE from 'three'
import { D, heightAt } from '../data.js'
import { T, MINFO, grow, setDistances } from './trees.js'
import { MODEL_KEYS } from './models.js'
import { P } from '../player.js'
import { shadowScene } from './shadow.js'

// ?lab=N : a lineup of growth models on the Polo Field, for tuning by eye. Page N shows models N*8 .. N*8+7.
// ?lab=N&lod=1 shows the mid LOD; &v=2 the third variant.
export function labRow() {
  const qs = new URLSearchParams(location.search)
  const page = +qs.get('lab') || 0, lod = qs.has('lod') ? +qs.get('lod') : 2, v = +(qs.get('v') || 0)
  setDistances(0, 0, 0)
  const lat = 37.7685, lon = -122.4935
  const cx = (lon - D.world.lon0) * D.world.mlon, cy = (lat - D.world.lat0) * D.world.mlat
  const per = +(qs.get('per') || 8)
  const keys = MODEL_KEYS.slice(page * per, page * per + per)
  const sp = D.trees.sp
  keys.forEach((key, k) => {
    const m = MODEL_KEYS.indexOf(key)
    // the most common real tree of this model supplies its colours and size
    let best = -1, bestN = -1
    for (let i = 0; i < D.trees.n; i += 7) if (T.model[i] === m) { const n = D.species[sp[i]].n; if (n > bestN || (n === bestN && T.H[i] > T.H[best])) { bestN = n; best = i } }
    if (best < 0) return
    const r = grow(key, v + 1, lod)
    const g = new THREE.InstancedBufferGeometry()
    for (const a of ['position', 'normal', 'uv', 'aPart', 'aShade']) g.setAttribute(a, r.geo.attributes[a])
    g.setIndex(r.geo.index)
    const x = cx + (k - (keys.length - 1) / 2) * 30, y = cy
    const i = best
    const one = (arr) => new THREE.InstancedBufferAttribute(new Float32Array(arr), arr.length)
    g.setAttribute('iPos', one([x, heightAt(x, y), -y]))
    g.setAttribute('iScale', one([T.SX[i] * (lod === 2 ? 1 : MINFO[m].corr[lod === 1 ? 'mid' : 'lo']), T.H[i], 0.3 * k]))
    g.setAttribute('iColor', one([T.col[i * 3], T.col[i * 3 + 1], T.col[i * 3 + 2]]))
    g.setAttribute('iTrunk', one([T.trunk[i * 3], T.trunk[i * 3 + 1], T.trunk[i * 3 + 2]]))
    g.setAttribute('iMisc', one([T.seed[i], 0, T.state[i]]))
    g.setAttribute('iTex', one([T.leaf[i], T.bark[i]]))
    g.setAttribute('iFlower', one([T.flw[i * 3], T.flw[i * 3 + 1], T.flw[i * 3 + 2]]))
    g.instanceCount = 1
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)
    const mesh = new THREE.Mesh(g, T.material); mesh.frustumCulled = false
    T.material.userData.scene.add(mesh)
    const sm = new THREE.Mesh(g, T.depthMat); sm.frustumCulled = false; shadowScene.add(sm)
    console.log('lab', key, D.species[sp[i]].q || D.species[sp[i]].name, 'H', T.H[i].toFixed(1), 'W', T.W[i].toFixed(1), 'tris', r.tris)
  })
  P.x = cx; P.y = cy - (+qs.get('back') || 95); P.yaw = 0
}
