<script setup lang="ts">
import { computed, ref } from 'vue'
import { Vector3 } from 'three'
import { plantGrowth } from '~/utils/growth'

// Title: low and close on the gardener. Forest: arrive looking straight down (as the map did), then
// tilt down into the walking view, so the satellite designer and the forest read as one continuous zoom.
const s = useDesign()
const player = usePlayer()
const cam = ref<any>(null)
const look = new Vector3()
const want = new Vector3()
const from = new Vector3()
const fromLook = new Vector3()
let ready = false
let dive = s.stage.value === 'forest' ? 0 : 1 // 0 → 1 over the first seconds in the forest

// the top of the canopy this year: the walking camera floats just above it, like a drone following you
const canopyTop = computed(() => {
  let top = 0
  for (const sp of s.scene.value.species) top = Math.max(top, sp.heightM * plantGrowth(sp, s.year.value) * (sp.pollard && sp.form !== 'pollard' ? 0.75 : 1))
  return top
})

const { onBeforeRender } = useLoop()
onBeforeRender(({ delta }) => {
  const c = cam.value
  if (!c) return
  const k = 1 - Math.pow(0.003, Math.min(delta, 0.1)) // frame-rate independent ease

  // keep roughly the same horizontal view on tall phone screens by widening the vertical FOV
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1)
  const fov = aspect < 1 ? Math.min(90, 55 + (1 - aspect) * 60) : 55
  if (Math.abs(c.fov - fov) > 0.05) {
    c.fov = fov
    c.updateProjectionMatrix()
  }
  const forest = s.stage.value === 'forest'
  const sc = s.scene.value
  if (!forest) {
    want.set(player.x + 1.4, 1.9, player.z + 5.6)
    look.set(player.x, 3.0, player.z - 2)
  } else if (s.ui.birdseye && s.ui.lockOn) {
    // locked on: high above the gardener, following as they walk, so the arrows move them, not the view
    const h = Math.max(26, canopyTop.value * 2.2 + 14)
    want.set(player.x, h, player.z + h * 0.55)
    look.set(player.x, 0, player.z - 1)
  } else if (s.ui.birdseye) {
    // rise up so the whole design reads at once
    const span = Math.max(sc.width, sc.depth * 1.2)
    const h = Math.max(18, span * 0.7 + 8)
    want.set(0, h, sc.depth / 2 + Math.max(14, span * 0.5))
    look.set(0, 0, sc.depth * 0.05)
  } else if (s.selected.value !== null && player.focus) {
    const f = player.focus
    const back = Math.max(7, f.h * 1.15 + 4)
    want.set(f.x + (s.ui.mobile ? 0 : back * 0.35), Math.max(3, f.h * 1.1 + 2, canopyTop.value * 0.8), f.z + back)
    look.set(f.x + (s.ui.mobile ? 0 : back * 0.22), f.h * (s.ui.mobile ? 0.25 : 0.5), f.z)
  } else {
    const top = canopyTop.value
    want.set(player.x, Math.max(6.5, top + 2.5), player.z + Math.max(11, top * 1.1 + 4))
    look.set(player.x, top > 4 ? 0.8 : 2.2, player.z - 6)
  }
  if (forest) {
    // zoom: ↑ ↓ keys (and the wheel) pull the camera in toward what it is looking at, or out away from it
    const z = (s.input.zoomOut ? 1 : 0) - (s.input.zoomIn ? 1 : 0)
    if (z) player.zoom = Math.min(2.6, Math.max(0.3, player.zoom * Math.exp(z * 1.1 * Math.min(delta, 0.05))))
    want.sub(look).multiplyScalar(player.zoom).add(look)
    // spin the view: Q/E, the on-screen arrows, right-drag, or the slow auto-orbit
    const spin = (s.input.rotR ? 1 : 0) - (s.input.rotL ? 1 : 0)
    if (spin !== 0) player.yawTarget = null
    if (player.yawTarget !== null) {
      // ease the long way round only as far as needed (shortest turn)
      let diff = ((player.yawTarget - player.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      if (Math.abs(diff) < 0.003) {
        player.yaw += diff
        player.yawTarget = null
      } else player.yaw += diff * Math.min(1, delta * 5)
    }
    player.yaw += (spin * 0.85 + (s.ui.autoOrbit ? 0.2 : 0)) * Math.min(delta, 0.05)
    if (player.yaw > Math.PI * 2) player.yaw -= Math.PI * 2
    else if (player.yaw < -Math.PI * 2) player.yaw += Math.PI * 2
    const f = s.selected.value !== null ? player.focus : null
    const free = s.ui.birdseye && !s.ui.lockOn
    const px = f ? f.x : free ? look.x : player.x
    const pz = f ? f.z : free ? look.z : player.z
    const cs = Math.cos(player.yaw)
    const sn = Math.sin(player.yaw)
    const turn = (v: Vector3) => {
      const dx = v.x - px
      const dz = v.z - pz
      v.x = px + dx * cs + dz * sn
      v.z = pz - dx * sn + dz * cs
    }
    turn(want)
    if (!free) turn(look)
  }
  const cur = (c.userData.look ??= look.clone()) as Vector3
  if (!ready) {
    if (forest) {
      // start where the map left off: high above the spot, looking straight down
      from.set(player.x, 70, player.z + 0.01)
      fromLook.set(player.x, 0, player.z)
      c.position.copy(from)
      cur.copy(fromLook)
    } else {
      c.position.copy(want)
      cur.copy(look)
    }
    ready = true
  }
  if (dive < 1) {
    dive = Math.min(1, dive + delta / 2.6)
    const t = dive < 0.5 ? 4 * dive ** 3 : 1 - (-2 * dive + 2) ** 3 / 2 // ease in-out
    c.position.lerpVectors(from, want, t)
    cur.lerpVectors(fromLook, look, t)
  } else {
    c.position.lerp(want, k)
    cur.lerp(look, k)
  }
  c.lookAt(cur)
})
</script>

<template>
  <TresPerspectiveCamera ref="cam" :position="[1.4, 1.9, 22]" :fov="55" :near="0.1" :far="900" make-default />
</template>
