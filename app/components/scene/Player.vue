<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const s = useDesign()
const player = usePlayer()

const root = ref<any>(null)
const body = ref<any>(null)
const legL = ref<any>(null)
const legR = ref<any>(null)
const armL = ref<any>(null)
const armR = ref<any>(null)
const ring = ref<any>(null)
// the tractor (from plantafoodforest): its body, the four wheels (spin), the two front steering knuckles, the
// steering wheel, and three exhaust puffs
const rig = ref<any>(null)
const chassis = ref<any>(null)
const spin: any[] = []
const knuckles: any[] = []
const helm = ref<any>(null)
const puffs: any[] = []

// ↑ ↓ (and W S) walk forward and back; ← → spin the camera; A D sidestep; + − zoom.
// In bird's-eye the camera is locked, so all four arrows walk (← → step left and right).
// On the tractor (spacebar): ↑ ↓ / W S are throttle and reverse, ← → / A D steer.
const keyMap: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', KeyD: 'right',
}
const camKeys: Record<string, 'rotL' | 'rotR' | 'zoomIn' | 'zoomOut'> = {
  ArrowLeft: 'rotL', ArrowRight: 'rotR', Equal: 'zoomIn', NumpadAdd: 'zoomIn', Minus: 'zoomOut', NumpadSubtract: 'zoomOut',
}
const canMove = () => s.stage.value === 'forest' && s.selected.value === null
function onKey(down: boolean) {
  return (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
    if (e.code === 'Escape' && down) {
      s.selected.value = null
      player.focus = null
      return
    }
    if (e.code === 'Space') {
      if (s.stage.value !== 'forest') return
      e.preventDefault()
      // a focused button would also "click" on space and undo the toggle
      if ((e.target as HTMLElement)?.closest?.('button')) (e.target as HTMLElement).blur()
      if (down && !e.repeat) s.ui.tractor = !s.ui.tractor
      return
    }
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      if (s.stage.value === 'forest') s.input[e.code === 'KeyQ' ? 'rotL' : 'rotR'] = down
      return
    }
    if ((s.ui.birdseye || s.ui.tractor) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault()
      s.input.rotL = s.input.rotR = false
      const side = e.code === 'ArrowLeft' ? 'left' : 'right'
      if (down && !canMove()) return
      s.input[side] = down
      return
    }
    const ck = camKeys[e.code]
    if (ck) {
      if (s.stage.value !== 'forest') return
      e.preventDefault()
      s.input[ck] = down
      return
    }
    const k = keyMap[e.code]
    if (!k) return
    e.preventDefault()
    if (down && !canMove()) return
    s.input[k] = down
  }
}
const kd = onKey(true)
const ku = onKey(false)
onMounted(() => {
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', kd)
  window.removeEventListener('keyup', ku)
})

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function bounds() {
  const p = s.scene.value
  return { hw: Math.max(p.width / 2 + 14, 15), hd: Math.max(p.depth / 2 + 14, 15) }
}

const { onBeforeRender } = useLoop()
let walk = 0
// arriving in the forest: stand where the map dive was aimed, or at the land's southern edge
if (s.stage.value === 'forest') {
  const f = s.forestFocus.value
  const b = bounds()
  player.x = f ? Math.max(-b.hw, Math.min(b.hw, f.x)) : 0
  player.z = f ? Math.max(-b.hd, Math.min(b.hd, f.z)) : s.scene.value.depth / 2 + 5
  player.target = null
  player.facing = Math.PI
} else {
  player.x = 0
  player.z = 16
}
// ── the tractor's driving: a small utility tractor, handled like one ──
// It can't step sideways: the throttle speeds it up and it coasts down, the front wheels steer, and it only turns
// while rolling, round a turning circle set by its wheelbase. Top speed a little over the gardener's walk.
const WALK = 6
const TOP = 7.5 // m/s forward
const REV = 2.8 // m/s in reverse
const WHEELBASE = 2 // m between the axles (front −1.25, rear +0.75)
const LOCK = 0.62 // rad, full steering lock
const R_REAR = 0.75
const R_FRONT = 0.42
const drive = { v: 0, steer: 0, accel: 0, mount: 0 }
let wasOn = false

function angleTo(from: number, to: number) {
  let d = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function driveTractor(dt: number, elapsed: number) {
  const i = s.input
  let throttle = canMove() ? (i.forward ? 1 : 0) - (i.back ? 1 : 0) : 0
  let steerIn = canMove() ? (i.right ? 1 : 0) - (i.left ? 1 : 0) : 0
  if (throttle || steerIn) player.target = null
  // a tap on the ground: steer toward it, slow down as it gets close, stop on it
  const tgt = player.target
  if (tgt && canMove() && !throttle && !steerIn) {
    const tx = tgt.x - player.x
    const tz = tgt.z - player.z
    const dist = Math.hypot(tx, tz)
    if (dist < 1.4) player.target = null
    else {
      const want = Math.atan2(-tx, -tz)
      const diff = angleTo(player.facing, want)
      steerIn = Math.max(-1, Math.min(1, -diff * 2.2))
      throttle = Math.min(1, dist / 6) * (Math.abs(diff) > 1.8 ? 0.45 : 1)
    }
  }
  // speed: engine pull, braking when the throttle opposes the motion, rolling drag when coasting
  const v0 = drive.v
  const target = throttle > 0 ? TOP * throttle : throttle < 0 ? -REV : 0
  const opposing = throttle !== 0 && Math.sign(target) !== Math.sign(drive.v) && Math.abs(drive.v) > 0.05
  const rate = opposing ? 9 : throttle ? (Math.abs(drive.v) < Math.abs(target) ? 3.2 : 2) : 2.6
  const dv = target - drive.v
  drive.v += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt)
  drive.accel += ((drive.v - v0) / Math.max(dt, 1e-4) - drive.accel) * Math.min(1, dt * 6)
  // the front wheels turn toward the stick and centre themselves when let go
  const steerWant = steerIn * LOCK * (1 - Math.min(0.45, Math.abs(drive.v) / TOP * 0.45)) // less lock at speed
  drive.steer += (steerWant - drive.steer) * Math.min(1, dt * (steerIn ? 5 : 3.5))
  // bicycle model: heading changes with speed × tan(steer) / wheelbase. Right steer turns clockwise from above.
  player.facing -= (drive.v * Math.tan(drive.steer) / WHEELBASE) * dt
  const fx = -Math.sin(player.facing)
  const fz = -Math.cos(player.facing)
  const b = bounds()
  const nx = player.x + fx * drive.v * dt
  const nz = player.z + fz * drive.v * dt
  const cx = Math.max(-b.hw, Math.min(b.hw, nx))
  const cz = Math.max(-b.hd, Math.min(b.hd, nz))
  if (cx !== nx || cz !== nz) drive.v *= 0.4 // nosed into the edge of the clearing
  player.x = cx
  player.z = cz
  const rolling = Math.abs(drive.v) > 0.05
  player.moving = rolling
  // the camera eases round behind the tractor as it drives (unless you're spinning it with Q / E)
  if (rolling && !s.ui.birdseye && !s.input.rotL && !s.input.rotR && player.yawTarget === null) {
    const back = drive.v < 0 ? 0 : angleTo(player.yaw, player.facing)
    player.yaw += back * Math.min(1, dt * 1.4)
  }

  // ── animation ──
  for (let k = 0; k < 4; k++) if (spin[k]) spin[k].rotation.x -= (drive.v * dt) / (k < 2 ? R_REAR : R_FRONT)
  for (const kn of knuckles) if (kn) kn.rotation.y = -drive.steer
  if (helm.value) helm.value.rotation.z = drive.steer * 2.4
  const load = Math.min(1, Math.abs(throttle) * 0.6 + Math.max(0, drive.accel * Math.sign(drive.v || 1)) * 0.25)
  if (chassis.value) {
    // engine shake (harder under load), a squat on acceleration and a dip under braking, a rock over rough ground
    const shake = 0.012 + load * 0.02
    chassis.value.position.y = Math.sin(elapsed * 41) * shake + (rolling ? Math.sin(elapsed * 7.3 + player.x) * 0.02 : 0)
    chassis.value.rotation.x = Math.max(-0.05, Math.min(0.05, drive.accel * 0.012))
    chassis.value.rotation.z = Math.sin(elapsed * 5.1 + player.z) * (rolling ? 0.012 : 0.003) + drive.steer * Math.abs(drive.v) * -0.006
  }
  // exhaust: puffs leave the stack faster and thicker under load, and trail behind as it drives
  puffs.forEach((p, k) => {
    if (!p) return
    const t = (elapsed * (1.1 + load * 1.6) + k / 3) % 1
    p.position.set(0.4 + t * 0.15, 3 + t * 1.3, -1.25 + t * drive.v * 0.25)
    p.scale.setScalar((0.16 + t * 0.4) * (0.7 + load * 0.6))
    p.material.opacity = (1 - t) * (0.35 + load * 0.35)
  })
  // the gardener sits on the seat, hands on the wheel
  if (legL.value) legL.value.rotation.x = -1.25
  if (legR.value) legR.value.rotation.x = -1.25
  if (armL.value) armL.value.rotation.x = -1.05
  if (armR.value) armR.value.rotation.x = -1.05
  if (body.value) {
    body.value.position.y = 0.95 + (chassis.value?.position.y ?? 0)
    body.value.position.z = 0.35
  }
}

onBeforeRender(({ delta, elapsed }) => {
  const dt = Math.min(delta, 0.05)
  // hopping on: the tractor appears pointing away from the camera, so ↑ drives into the view
  if (s.ui.tractor && !wasOn) player.facing = player.yaw
  wasOn = s.ui.tractor
  // hopping on and off: the tractor rolls up out of the ground and back
  drive.mount += ((s.ui.tractor ? 1 : 0) - drive.mount) * Math.min(1, dt * 7)
  if (rig.value) {
    rig.value.visible = drive.mount > 0.02
    const m = drive.mount
    rig.value.scale.setScalar(Math.max(0.001, m * (1 + Math.sin(m * Math.PI) * 0.12)))
  }
  if (s.ui.tractor && s.stage.value === 'forest') {
    driveTractor(dt, elapsed)
    if (ring.value) {
      ring.value.visible = !!player.target
      if (player.target) {
        ring.value.position.set(player.target.x, 0.08, player.target.z)
        ring.value.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.15)
      }
    }
    if (root.value) {
      root.value.position.set(player.x, 0, player.z)
      root.value.rotation.y = player.facing
    }
    return
  }
  drive.v = 0
  drive.steer = 0
  if (body.value) body.value.position.z = 0
  const i = s.input
  let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0)
  let dz = (i.back ? 1 : 0) - (i.forward ? 1 : 0)
  if (dx !== 0 || dz !== 0) {
    player.target = null
    // W always means "away from the screen", however the view has been spun
    const yaw = s.stage.value === 'intro' ? 0 : player.yaw
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    ;[dx, dz] = [dx * c + dz * sn, -dx * sn + dz * c]
  }
  const tgt = player.target
  if (tgt && !(dx !== 0 || dz !== 0)) {
    const tx = tgt.x - player.x
    const tz = tgt.z - player.z
    if (Math.hypot(tx, tz) < 0.25) player.target = null
    else {
      dx = tx
      dz = tz
    }
  }
  const active = canMove() && (dx !== 0 || dz !== 0)
  const speed = WALK
  if (active) {
    const len = Math.hypot(dx, dz)
    dx /= len
    dz /= len
    const b = bounds()
    player.x = Math.max(-b.hw, Math.min(b.hw, player.x + dx * speed * dt))
    player.z = Math.max(-b.hd, Math.min(b.hd, player.z + dz * speed * dt))
    player.facing = lerpAngle(player.facing, Math.atan2(-dx, -dz), 0.2)
  }
  if (s.stage.value === 'intro') player.facing = Math.PI
  player.moving = active

  walk += dt * (active ? 11 : 0)
  const swing = active ? Math.sin(walk) * 0.7 : 0
  if (legL.value) legL.value.rotation.x = swing
  if (legR.value) legR.value.rotation.x = -swing
  if (armL.value) armL.value.rotation.x = -swing * 0.8
  if (armR.value) armR.value.rotation.x = swing * 0.8
  if (body.value) body.value.position.y = active ? Math.abs(Math.sin(walk)) * 0.1 : Math.sin(elapsed * 2) * 0.025
  if (ring.value) {
    ring.value.visible = !!player.target
    if (player.target) {
      ring.value.position.set(player.target.x, 0.08, player.target.z)
      ring.value.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.15)
    }
  }
  if (root.value) {
    root.value.position.set(player.x, 0, player.z)
    root.value.rotation.y = player.facing
  }
})
</script>

<template>
  <!-- tap destination marker -->
  <TresMesh ref="ring" :rotation="[-Math.PI / 2, 0, 0]" :visible="false">
    <TresRingGeometry :args="[0.3, 0.45, 28]" />
    <TresMeshBasicMaterial color="#fff3cf" :transparent="true" :opacity="0.9" :depth-write="false" :tone-mapped="false" />
  </TresMesh>

  <TresGroup ref="root" :position="[0, 0, 16]">
    <TresMesh :position="[0, 0.03, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresCircleGeometry :args="[s.ui.tractor ? 1.7 : 0.7, 20]" />
      <TresMeshBasicMaterial color="#5b4a9a" :transparent="true" :opacity="0.35" />
    </TresMesh>

    <!-- the tractor, from plantafoodforest: a little round-shouldered red machine (front is -z) -->
    <TresGroup ref="rig" :visible="false">
      <TresGroup ref="chassis">
        <TresMesh :position="[0, 1.05, 0.2]" :scale="[1, 0.75, 1.5]">
          <TresSphereGeometry :args="[0.95, 14, 10]" />
          <TresMeshStandardMaterial color="#d94b3b" :flat-shading="true" />
        </TresMesh>
        <TresMesh :position="[0, 1.15, -1.0]" :scale="[0.8, 0.65, 1.1]">
          <TresSphereGeometry :args="[0.75, 12, 8]" />
          <TresMeshStandardMaterial color="#e8604a" :flat-shading="true" />
        </TresMesh>
        <!-- grille and headlights -->
        <TresMesh :position="[0, 1.12, -1.78]" :scale="[0.55, 0.42, 0.12]">
          <TresSphereGeometry :args="[0.6, 10, 6]" />
          <TresMeshStandardMaterial color="#3b2a1a" :flat-shading="true" />
        </TresMesh>
        <TresMesh v-for="x in [-0.32, 0.32]" :key="'lamp' + x" :position="[x, 1.32, -1.74]">
          <TresSphereGeometry :args="[0.1, 8, 6]" />
          <TresMeshStandardMaterial color="#fff3cf" emissive="#ffe08a" :emissive-intensity="0.5" />
        </TresMesh>
        <!-- exhaust stack -->
        <TresMesh :position="[0.4, 2.3, -1.25]">
          <TresCylinderGeometry :args="[0.08, 0.1, 1.2, 6]" />
          <TresMeshStandardMaterial color="#4a3a3a" />
        </TresMesh>
        <!-- seat and steering wheel -->
        <TresMesh :position="[0, 1.62, 0.55]" :scale="[1, 0.35, 1]">
          <TresSphereGeometry :args="[0.42, 10, 6]" />
          <TresMeshStandardMaterial color="#3b2a1a" :flat-shading="true" />
        </TresMesh>
        <TresMesh :position="[0, 1.7, -0.25]" :rotation="[-0.9, 0, 0]">
          <TresCylinderGeometry :args="[0.04, 0.04, 0.6, 5]" />
          <TresMeshStandardMaterial color="#3b2a1a" />
        </TresMesh>
        <TresGroup :position="[0, 1.95, -0.05]" :rotation="[-0.9, 0, 0]">
          <TresMesh ref="helm" :rotation="[Math.PI / 2, 0, 0]">
            <TresTorusGeometry :args="[0.22, 0.035, 6, 14]" />
            <TresMeshStandardMaterial color="#2f2a2a" />
          </TresMesh>
        </TresGroup>
        <!-- rounded canopy roof on four posts -->
        <TresMesh v-for="(p, i) in [[-0.7, 0.55], [0.7, 0.55], [-0.7, 1.4], [0.7, 1.4]]" :key="'post' + i" :position="[p[0]!, 2.3, p[1]!]">
          <TresCylinderGeometry :args="[0.05, 0.05, 1.6, 5]" />
          <TresMeshStandardMaterial color="#3b2a1a" />
        </TresMesh>
        <TresMesh :position="[0, 3.15, 0.95]" :scale="[1, 0.22, 1]">
          <TresSphereGeometry :args="[1.05, 12, 8]" />
          <TresMeshStandardMaterial color="#ffcf4a" :flat-shading="true" />
        </TresMesh>
      </TresGroup>
      <!-- big rear wheels; small front wheels on steering knuckles. Each tyre has tread blocks so the spin shows -->
      <TresGroup v-for="(w, i) in [[-1.05, 0.75, 0.75, 0.75], [1.05, 0.75, 0.75, 0.75], [-0.85, 0.42, -1.25, 0.42], [0.85, 0.42, -1.25, 0.42]]" :key="'wh' + i" :position="[w[0]!, w[1]!, w[2]!]">
        <TresGroup :ref="(el: any) => i >= 2 && (knuckles[i - 2] = el)">
          <TresGroup :ref="(el: any) => (spin[i] = el)">
            <TresMesh :rotation="[0, 0, Math.PI / 2]">
              <TresCylinderGeometry :args="[w[3]!, w[3]!, 0.36, 12]" />
              <TresMeshStandardMaterial color="#2f2a2a" :flat-shading="true" />
            </TresMesh>
            <TresMesh :rotation="[0, 0, Math.PI / 2]">
              <TresCylinderGeometry :args="[w[3]! * 0.5, w[3]! * 0.5, 0.4, 8]" />
              <TresMeshStandardMaterial color="#ffcf4a" :flat-shading="true" />
            </TresMesh>
            <TresMesh v-for="k in 8" :key="'lug' + k" :position="[0, Math.cos((k * Math.PI) / 4) * w[3]!, Math.sin((k * Math.PI) / 4) * w[3]!]" :rotation="[(k * Math.PI) / 4, 0, 0]">
              <TresBoxGeometry :args="[0.38, 0.07, w[3]! * 0.32]" />
              <TresMeshStandardMaterial color="#1f1b1b" :flat-shading="true" />
            </TresMesh>
          </TresGroup>
        </TresGroup>
      </TresGroup>
      <!-- exhaust puffs -->
      <TresMesh v-for="k in 3" :key="'puff' + k" :ref="(el: any) => (puffs[k - 1] = el)">
        <TresIcosahedronGeometry :args="[1, 0]" />
        <TresMeshStandardMaterial color="#f4f0ff" :transparent="true" :opacity="0.5" :flat-shading="true" :depth-write="false" />
      </TresMesh>
    </TresGroup>

    <TresGroup ref="body">
      <!-- legs -->
      <TresGroup ref="legL" :position="[-0.17, 0.62, 0]">
        <TresMesh :position="[0, -0.28, 0]">
          <TresCapsuleGeometry :args="[0.11, 0.34, 4, 8]" />
          <TresMeshStandardMaterial color="#3b5fa8" :flat-shading="true" />
        </TresMesh>
        <TresMesh :position="[0, -0.56, -0.05]" :scale="[1, 0.65, 1.5]">
          <TresSphereGeometry :args="[0.17, 10, 8]" />
          <TresMeshStandardMaterial color="#5b3a1e" :flat-shading="true" />
        </TresMesh>
      </TresGroup>
      <TresGroup ref="legR" :position="[0.17, 0.62, 0]">
        <TresMesh :position="[0, -0.28, 0]">
          <TresCapsuleGeometry :args="[0.11, 0.34, 4, 8]" />
          <TresMeshStandardMaterial color="#3b5fa8" :flat-shading="true" />
        </TresMesh>
        <TresMesh :position="[0, -0.56, -0.05]" :scale="[1, 0.65, 1.5]">
          <TresSphereGeometry :args="[0.17, 10, 8]" />
          <TresMeshStandardMaterial color="#5b3a1e" :flat-shading="true" />
        </TresMesh>
      </TresGroup>
      <!-- torso + overalls bib -->
      <TresMesh :position="[0, 1.0, 0]">
        <TresCapsuleGeometry :args="[0.34, 0.4, 4, 10]" />
        <TresMeshStandardMaterial color="#ff7a59" :flat-shading="true" />
      </TresMesh>
      <TresMesh :position="[0, 0.92, -0.3]" :scale="[1.0, 1.0, 0.3]">
        <TresSphereGeometry :args="[0.22, 12, 10]" />
        <TresMeshStandardMaterial color="#3b5fa8" :flat-shading="true" />
      </TresMesh>
      <!-- arms -->
      <TresGroup ref="armL" :position="[-0.46, 1.25, 0]">
        <TresMesh :position="[0, -0.25, 0]">
          <TresCapsuleGeometry :args="[0.1, 0.34, 3, 6]" />
          <TresMeshStandardMaterial color="#ff7a59" :flat-shading="true" />
        </TresMesh>
      </TresGroup>
      <TresGroup ref="armR" :position="[0.46, 1.25, 0]">
        <TresMesh :position="[0, -0.25, 0]">
          <TresCapsuleGeometry :args="[0.1, 0.34, 3, 6]" />
          <TresMeshStandardMaterial color="#ff7a59" :flat-shading="true" />
        </TresMesh>
      </TresGroup>
      <!-- head, eyes (front is -z), cheeks, hair, straw hat -->
      <TresMesh :position="[0, 1.78, 0]">
        <TresSphereGeometry :args="[0.46, 20, 16]" />
        <TresMeshStandardMaterial color="#ffd9b3" />
      </TresMesh>
      <TresMesh :position="[-0.16, 1.82, -0.41]" :scale="[1, 1.3, 0.6]">
        <TresSphereGeometry :args="[0.06, 8, 8]" />
        <TresMeshBasicMaterial color="#2b1b12" />
      </TresMesh>
      <TresMesh :position="[0.16, 1.82, -0.41]" :scale="[1, 1.3, 0.6]">
        <TresSphereGeometry :args="[0.06, 8, 8]" />
        <TresMeshBasicMaterial color="#2b1b12" />
      </TresMesh>
      <TresMesh :position="[-0.28, 1.7, -0.36]" :scale="[1, 0.7, 0.4]">
        <TresSphereGeometry :args="[0.07, 8, 8]" />
        <TresMeshBasicMaterial color="#ff9d9d" />
      </TresMesh>
      <TresMesh :position="[0.28, 1.7, -0.36]" :scale="[1, 0.7, 0.4]">
        <TresSphereGeometry :args="[0.07, 8, 8]" />
        <TresMeshBasicMaterial color="#ff9d9d" />
      </TresMesh>
      <TresMesh :position="[0, 1.95, 0.22]">
        <TresSphereGeometry :args="[0.34, 12, 10]" />
        <TresMeshStandardMaterial color="#6b3e22" :flat-shading="true" />
      </TresMesh>
      <TresMesh :position="[0, 2.1, 0]">
        <TresCylinderGeometry :args="[0.78, 0.78, 0.07, 18]" />
        <TresMeshStandardMaterial color="#f2cf6b" :flat-shading="true" />
      </TresMesh>
      <TresMesh :position="[0, 2.3, 0]">
        <TresCylinderGeometry :args="[0.34, 0.42, 0.4, 14]" />
        <TresMeshStandardMaterial color="#f2cf6b" :flat-shading="true" />
      </TresMesh>
      <TresMesh :position="[0, 2.22, 0]">
        <TresCylinderGeometry :args="[0.43, 0.43, 0.1, 14]" />
        <TresMeshStandardMaterial color="#d94b4b" :flat-shading="true" />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
