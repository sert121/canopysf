import * as THREE from 'three'
import { heightAt } from './data.js'
import { T, forEachInRadius } from './world/trees.js'
import { insideBuilding, freeSpot } from './world/buildings.js'

// First-person controller. World coords: x east, y north. Three: (x, up, -y).
export const P = {
  x: 0, y: 0, z: 0, yaw: 0, pitch: -0.05, mode: 'walk', vx: 0, vy: 0, vz: 0,
  keys: new Set(), padKeys: new Set(), locked: false, bob: 0, enabled: false, onGround: true, jumpV: 0,
  joy: { x: 0, y: 0, active: false }, touchUp: 0, touchLook: null, sens: 1, speedMul: 1, noLock: false, mouse: [0, 0],
}
const EYE = 1.7

export function initPlayer(camera, dom, { onLockChange } = {}) {
  camera.rotation.order = 'YXZ'
  addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
    P.keys.add(e.code)
    if (e.code === 'KeyF' && P.enabled) toggleFly()
    if (e.code === 'Space' && P.mode === 'walk' && P.onGround && P.enabled) { P.jumpV = 4.6; P.onGround = false }
  })
  addEventListener('keyup', e => P.keys.delete(e.code))
  // on-screen WASD pad (mouse / trackpad): hold a key to move; it also lights up as you type
  const pad = document.getElementById('kpad')
  if (pad) {
    const btns = [...pad.querySelectorAll('[data-k]')]
    btns.forEach(b => {
      const code = b.dataset.k
      const on = e => { e.preventDefault(); e.stopPropagation(); P.keys.add(code); P.padKeys.add(code); if (code === 'Space' && P.mode === 'walk' && P.onGround && P.enabled) { P.jumpV = 4.6; P.onGround = false } }
      const off = () => { if (P.padKeys.has(code)) { P.keys.delete(code); P.padKeys.delete(code) } }
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off)
      b.addEventListener('mousedown', e => e.stopPropagation())
    })
    const lit = () => { for (const b of btns) b.classList.toggle('on', P.keys.has(b.dataset.k)); pad.classList.toggle('active', P.keys.size > 0); requestAnimationFrame(lit) }
    lit()
  }
  addEventListener('blur', () => P.keys.clear())
  document.addEventListener('pointerlockchange', () => {
    P.locked = document.pointerLockElement === dom
    onLockChange && onLockChange(P.locked)
  })
  // fallback when the page can't capture the mouse: drag to look, click to inspect under the cursor
  let drag = null
  document.addEventListener('pointerlockerror', () => { P.noLock = true; onLockChange && onLockChange(false) })
  dom.addEventListener('mousedown', e => { if (!P.locked && (e.button === 0 || e.button === 2)) { drag = { x: e.clientX, y: e.clientY, moved: 0 }; document.body.classList.add('dragging') } })
  dom.addEventListener('contextmenu', e => { if (P.noLock) e.preventDefault() })
  addEventListener('mouseup', e => {
    if (drag && drag.moved < 6 && P.noLock && e.button === 0) dom.dispatchEvent(new CustomEvent('tap', { detail: { x: e.clientX, y: e.clientY } }))
    if (drag && drag.moved >= 6 && !P.hasLooked) { P.hasLooked = true; document.getElementById('resume')?.classList.add('hidden') }
    drag = null; document.body.classList.remove('dragging')
  })
  dom.addEventListener('mousemove', e => {
    P.mouse = [e.clientX, e.clientY]
    if (!P.locked && drag && P.enabled) {
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      P.yaw += e.movementX * 0.004 * P.sens
      P.pitch = THREE.MathUtils.clamp(P.pitch + e.movementY * 0.004 * P.sens, -1.45, 1.45)
      return
    }
    if (!P.locked) return
    P.yaw -= e.movementX * 0.0022 * P.sens
    P.pitch = THREE.MathUtils.clamp(P.pitch - e.movementY * 0.0022 * P.sens, -1.45, 1.45)
  })
  // touch: left half = joystick, right half = look
  const joyEl = document.getElementById('joy'), knob = document.getElementById('joyKnob')
  let joyId = null, joyC = [0, 0], lookId = null, lookLast = [0, 0], lookMoved = 0
  dom.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.4 && joyId === null) {
        joyId = t.identifier; joyC = [t.clientX, t.clientY]; P.joy.active = true
        if (joyEl) { joyEl.style.display = 'block'; joyEl.style.left = (t.clientX - 60) + 'px'; joyEl.style.top = (t.clientY - 60) + 'px' }
      } else if (lookId === null) { lookId = t.identifier; lookLast = [t.clientX, t.clientY]; lookMoved = 0 }
    }
    e.preventDefault()
  }, { passive: false })
  dom.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        // up to 1 = walk; pushing out to 1.4 (the dashed ring) breaks into a run
        let dx = (t.clientX - joyC[0]) / 50, dy = (t.clientY - joyC[1]) / 50
        const l = Math.hypot(dx, dy); if (l > 1.4) { dx *= 1.4 / l; dy *= 1.4 / l }
        P.joy.x = dx; P.joy.y = -dy
        if (knob) knob.style.transform = `translate(${dx * 40 / 1.4}px, ${dy * 40 / 1.4}px)`
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lookLast[0], dy = t.clientY - lookLast[1]
        lookMoved += Math.abs(dx) + Math.abs(dy)
        P.yaw -= dx * 0.0055 * P.sens; P.pitch = THREE.MathUtils.clamp(P.pitch - dy * 0.0055 * P.sens, -1.45, 1.45)
        lookLast = [t.clientX, t.clientY]
      }
    }
    e.preventDefault()
  }, { passive: false })
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; P.joy = { x: 0, y: 0, active: false }; if (joyEl) joyEl.style.display = 'none'; if (knob) knob.style.transform = '' }
      if (t.identifier === lookId) {
        lookId = null
        if (lookMoved < 10) dom.dispatchEvent(new CustomEvent('tap', { detail: { x: t.clientX, y: t.clientY } }))
      }
    }
  }
  dom.addEventListener('touchend', end); dom.addEventListener('touchcancel', end)
  // on-screen buttons: fly/walk, climb/descend while flying, jump while walking
  const hold = (id, v) => {
    const el = document.getElementById(id); if (!el) return
    const on = e => { e.preventDefault(); P.touchUp = v; el.classList.add('held') }
    const off = () => { if (P.touchUp === v) P.touchUp = 0; el.classList.remove('held') }
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off)
  }
  hold('tc-up', 1); hold('tc-down', -1)
  const flyBtn = document.getElementById('tc-fly')
  if (flyBtn) flyBtn.addEventListener('click', () => { if (P.enabled) toggleFly() })
  const jumpBtn = document.getElementById('tc-jump')
  if (jumpBtn) jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (P.enabled && P.mode === 'walk' && P.onGround) { P.jumpV = 4.6; P.onGround = false } })
  addEventListener('modechange', e => { if (flyBtn) flyBtn.textContent = e.detail === 'fly' ? 'Walk' : 'Fly' })
}

export function toggleFly(force) {
  P.mode = force || (P.mode === 'walk' ? 'fly' : 'walk')
  if (P.mode === 'walk') { const [x, y] = freeSpot(P.x, P.y); P.x = x; P.y = y }
  if (P.mode === 'fly') P.z = Math.max(P.z, heightAt(P.x, P.y) + 40)
  document.body.classList.toggle('flying', P.mode === 'fly')
  dispatchEvent(new CustomEvent('modechange', { detail: P.mode }))
}

export function teleport(x, y, opts = {}) {
  if (P.mode !== 'fly') [x, y] = freeSpot(x, y)
  P.x = x; P.y = y
  const g = heightAt(x, y)
  P.z = P.mode === 'fly' ? Math.max(g + 60, P.z) : g + EYE
  if (opts.yaw !== undefined) P.yaw = opts.yaw
  if (opts.pitch !== undefined) P.pitch = opts.pitch
  P.vx = P.vy = P.vz = 0
}

const fwd = new THREE.Vector2(), right = new THREE.Vector2()
export function updatePlayer(dt, camera) {
  if (P.enabled) {
    const k = P.keys
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    let run = 0
    if (P.joy.active) {
      const m = Math.hypot(P.joy.x, P.joy.y)
      run = Math.max(0, Math.min(1, (m - 1) / 0.35))
      const n = m > 1 ? 1 / m : 1
      f += P.joy.y * n; s += P.joy.x * n
    }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || run > 0.5
    fwd.set(-Math.sin(P.yaw), Math.cos(P.yaw)); right.set(Math.cos(P.yaw), Math.sin(P.yaw))
    if (P.mode === 'walk') {
      const speed = (sprint && run < 0.5 ? 30 : 9 + 21 * run) * P.speedMul
      const tx = (fwd.x * f + right.x * s) * speed, ty = (fwd.y * f + right.y * s) * speed
      const a = 1 - Math.exp(-dt * 12)
      P.vx += (tx - P.vx) * a; P.vy += (ty - P.vy) * a
      let nx = P.x + P.vx * dt, ny = P.y + P.vy * dt
      // keep feet on land
      if (heightAt(nx, ny) < 0.4) { nx = P.x; ny = P.y; P.vx = P.vy = 0 }
      // buildings: slide along walls
      if (insideBuilding(nx, ny)) {
        if (!insideBuilding(nx, P.y)) ny = P.y
        else if (!insideBuilding(P.x, ny)) nx = P.x
        else { nx = P.x; ny = P.y }
      }
      // trunks
      forEachInRadius(nx, ny, 6, i => {
        const r = Math.max(0.2, T.TR[i]) + 0.35
        const dx = nx - T.px[i], dy = ny + T.pz[i], d = Math.hypot(dx, dy)
        if (d < r && d > 1e-3) { nx = T.px[i] + dx / d * r; ny = -T.pz[i] + dy / d * r }
      })
      P.x = nx; P.y = ny
      const g = heightAt(P.x, P.y) + EYE
      if (!P.onGround) {
        P.jumpV -= 12 * dt; P.z += P.jumpV * dt
        if (P.z <= g) { P.z = g; P.onGround = true; P.jumpV = 0 }
      } else {
        P.z += (g - P.z) * (1 - Math.exp(-dt * 14))
      }
      const moving = Math.hypot(P.vx, P.vy)
      P.bob += dt * Math.min(moving, 9) * 1.6
      camera.position.set(P.x, P.z + Math.sin(P.bob) * 0.035 * Math.min(1, moving / 4), -P.y)
    } else {
      const speed = (sprint && run < 0.5 ? 260 : 70 + 190 * run) * P.speedMul
      const up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyC') || k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0) + P.touchUp
      const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch)
      const tx = (fwd.x * f * cp + right.x * s) * speed, ty = (fwd.y * f * cp + right.y * s) * speed
      const tz = (f * sp + up) * speed
      const a = 1 - Math.exp(-dt * 4)
      P.vx += (tx - P.vx) * a; P.vy += (ty - P.vy) * a; P.vz += (tz - P.vz) * a
      P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt
      const g = Math.max(heightAt(P.x, P.y), 0) + 3
      if (P.z < g) { P.z = g; P.vz = Math.max(0, P.vz) }
      P.z = Math.min(P.z, 1400)
      camera.position.set(P.x, P.z, -P.y)
    }
    // stay within the map
    P.x = THREE.MathUtils.clamp(P.x, -6600, 7400); P.y = THREE.MathUtils.clamp(P.y, -6300, 8300)
  }
  camera.rotation.set(P.pitch, P.yaw, 0)
}

export function heading() { let h = (-P.yaw * 180 / Math.PI) % 360; if (h < 0) h += 360; return h }
