import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial,
  Object3D, Quaternion, SphereGeometry, Vector3, DynamicDrawUsage, type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Form } from '#shared/types'

// Every plant is drawn from a handful of unit-sized shapes (canopy fits x/z ±0.5, y 0..1) that are
// stretched per instance to the plant's height and width. Thousands of plants → ~20 draw calls.

export const FORMS: Form[] = ['round', 'spreading', 'columnar', 'conifer', 'palm', 'shrub', 'pollard', 'vine', 'herb']

export const TRUNK_FRAC: Record<Form, number> = {
  round: 0.42, spreading: 0.42, columnar: 0.3, conifer: 0.22, palm: 0.88, shrub: 0, pollard: 0.86, vine: 0.95, herb: 0,
}

function blob(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, detail = 1) {
  const g = new IcosahedronGeometry(r, detail)
  g.scale(sx, sy, sz)
  g.translate(x, y, z)
  return g
}
function clean(g: BufferGeometry) {
  // merged parts must share the same attribute set
  g.deleteAttribute('uv')
  return g.index ? g.toNonIndexed() : g
}
function merge(parts: BufferGeometry[]) {
  const out = mergeGeometries(parts.map(clean))!
  out.computeVertexNormals()
  return out
}

export function canopyGeometry(form: Form): BufferGeometry {
  switch (form) {
    case 'round':
      return merge([blob(0.5, 0, 0.66, 0, 1, 0.62, 1), blob(0.3, 0.26, 0.56, 0.12, 1, 0.8, 1), blob(0.3, -0.24, 0.6, -0.14, 1, 0.8, 1), blob(0.26, 0.04, 0.9, 0, 1, 0.7, 1)])
    case 'spreading':
      return merge([blob(0.5, 0, 0.7, 0, 1, 0.48, 1), blob(0.28, 0.3, 0.62, 0.15, 1, 0.6, 1), blob(0.28, -0.3, 0.66, -0.1, 1, 0.6, 1), blob(0.3, 0, 0.86, 0.05, 1, 0.55, 1)])
    case 'columnar':
      return merge([blob(0.5, 0, 0.6, 0, 0.85, 0.82, 0.85), blob(0.3, 0.1, 0.92, 0, 1, 0.9, 1)])
    case 'conifer': {
      const parts = [0, 1, 2].map((i) => {
        const c = new ConeGeometry(0.5 - i * 0.12, 0.42, 9)
        c.translate(0, 0.38 + i * 0.22, 0)
        return c
      })
      return merge(parts)
    }
    case 'palm': {
      const parts: BufferGeometry[] = []
      for (let i = 0; i < 8; i++) {
        const leaf = new SphereGeometry(0.5, 8, 4)
        leaf.scale(0.55, 0.05, 0.14)
        leaf.translate(0.27, 0, 0)
        leaf.rotateZ(-0.35 - (i % 2) * 0.25)
        leaf.rotateY((i / 8) * Math.PI * 2)
        leaf.translate(0, 0.94, 0)
        parts.push(leaf)
      }
      parts.push(blob(0.08, 0, 0.93, 0))
      return merge(parts)
    }
    case 'shrub':
      return merge([blob(0.5, 0, 0.45, 0, 1, 0.85, 1), blob(0.3, 0.24, 0.32, 0.18, 1, 0.9, 1), blob(0.28, -0.22, 0.36, -0.18, 1, 0.9, 1)])
    case 'pollard':
      return merge([blob(0.32, 0, 0.92, 0, 1, 0.5, 1, 0), blob(0.2, 0.22, 0.98, 0.1, 1, 0.8, 1, 0), blob(0.2, -0.2, 0.99, -0.1, 1, 0.8, 1, 0), blob(0.18, 0.02, 1.04, -0.22, 1, 0.8, 1, 0)])
    case 'vine':
      return merge([blob(0.35, 0, 0.55, 0, 0.9, 1.4, 0.9, 0), blob(0.3, 0.15, 0.85, 0.1, 1, 0.8, 1, 0), blob(0.28, -0.15, 0.3, -0.1, 1, 0.8, 1, 0)])
    case 'herb':
      return merge([blob(0.32, 0.12, 0.35, 0, 1, 1.1, 1, 0), blob(0.3, -0.15, 0.3, 0.1, 1, 1, 1, 0), blob(0.26, 0, 0.3, -0.2, 1, 1.1, 1, 0)])
  }
}

// ── bare branches: what a deciduous tree is in winter ─────────────────────────
// A leader, a ring of main branches reaching up and out to the crown's edge, and a pair of twigs off each, in the same
// unit space as the canopy (so the same instance matrix fits them to the plant). Low-poly sticks, like the rest.
const UP = new Vector3(0, 1, 0)
function stick(a: Vector3, b: Vector3, r0: number, r1: number) {
  const dir = new Vector3().subVectors(b, a)
  const len = dir.length()
  const g = new CylinderGeometry(r1, r0, len, 4, 1)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()))
  g.translate(a.x, a.y, a.z)
  return g
}
export const TWIG_FORMS: Form[] = ['round', 'spreading', 'columnar', 'shrub', 'pollard', 'vine', 'conifer']
export function twigGeometry(form: Form): BufferGeometry {
  const r = rng(form.length * 97 + form.charCodeAt(0))
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
  const parts: BufferGeometry[] = []
  if (form === 'pollard') {
    // a knuckle at the top of the trunk with a crown of straight whips
    parts.push(stick(V(0, 0.8, 0), V(0, 0.9, 0), 0.06, 0.05))
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + r() * 0.4
      const out = 0.08 + r() * 0.14
      parts.push(stick(V(Math.cos(a) * 0.03, 0.88, Math.sin(a) * 0.03), V(Math.cos(a) * out, 1.02 + r() * 0.12, Math.sin(a) * out), 0.012, 0.004))
    }
    return merge(parts)
  }
  const spread = form === 'columnar' ? 0.26 : form === 'conifer' ? 0.32 : form === 'spreading' ? 0.5 : form === 'shrub' ? 0.46 : 0.43
  const shrubby = form === 'shrub' || form === 'vine'
  if (!shrubby) parts.push(stick(V(0, 0, 0), V(0, 0.96, 0), 0.034, 0.01))
  const n = shrubby ? 8 : form === 'columnar' ? 7 : 6
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.7
    const y0 = shrubby ? 0.02 : 0.04 + (i / n) * 0.4 + r() * 0.08
    const reach = spread * (0.7 + r() * 0.3)
    const tipY = Math.min(0.99, y0 + (form === 'columnar' ? 0.55 : form === 'spreading' ? 0.3 : 0.4) + r() * 0.25)
    const from = V(0, y0, 0)
    const tip = V(Math.cos(a) * reach, tipY, Math.sin(a) * reach)
    parts.push(stick(from, tip, shrubby ? 0.016 : 0.024, 0.007))
    for (const side of [-1, 1]) {
      const mid = from.clone().lerp(tip, 0.45 + r() * 0.2)
      const b = a + side * (0.5 + r() * 0.4)
      const t = V(mid.x + Math.cos(b) * reach * 0.38, Math.min(1, mid.y + 0.12 + r() * 0.16), mid.z + Math.sin(b) * reach * 0.38)
      parts.push(stick(mid, t, 0.01, 0.004))
    }
  }
  return merge(parts)
}

export function trunkGeometry() {
  const g = new CylinderGeometry(0.35, 0.5, 1, 6)
  g.translate(0, 0.5, 0)
  return g
}

// ── materials with a slow eurythmic sway (a breathing wave travelling across the forest) ──
export const swayUniforms = { uTime: { value: 0 } }

export function swayMaterial(opts: ConstructorParameters<typeof MeshStandardMaterial>[0], amount = 1): Material {
  const m = new MeshStandardMaterial({ flatShading: true, ...opts })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swayUniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float wave = sin(uTime * 0.9 - ip.z * 0.22 + ip.x * 0.07);
          transformed.x += wave * 0.035 * ${amount.toFixed(2)} * position.y;
          transformed.z += cos(uTime * 0.7 - ip.x * 0.18) * 0.02 * ${amount.toFixed(2)} * position.y;
        #endif`,
      )
  }
  return m
}

export function makeInstanced(geo: BufferGeometry, mat: Material, count: number) {
  const m = new InstancedMesh(geo, mat, Math.max(1, count))
  m.instanceMatrix.setUsage(DynamicDrawUsage)
  m.count = 0
  m.frustumCulled = false
  return m
}

// ── the deciduous year ───────────────────────────────────────────────────────
// Month curves for the Northern Hemisphere, one value per mid-month (Jan … Dec), sampled smoothly in between so the
// trees can glide from one month to the next. Southern sites read them six months on.
const LEAF = [0, 0, 0.06, 0.45, 0.9, 1, 1, 1, 0.95, 0.68, 0.18, 0] // how much of the crown is in leaf
const TURN = [0, 0, 0, 0, 0, 0, 0, 0.04, 0.25, 0.75, 1, 1] // autumn colour
const FRESH = [0, 0, 0.7, 1, 0.55, 0.1, 0, 0, 0, 0, 0, 0] // spring: fresh green, and blossom on some
const DULL = [1, 1, 0.55, 0, 0, 0, 0, 0, 0, 0.2, 0.6, 1] // evergreens look a little dull in winter
function sampleYear(t: number[], month: number, south: boolean) {
  const x = ((((month - 1 + (south ? 6 : 0)) % 12) + 12) % 12)
  const i = Math.floor(x)
  const f = x - i
  return t[i]! + (t[(i + 1) % 12]! - t[i]!) * f
}
// 0 = bare twigs, 1 = full leaf. Evergreens and anything in the lush tropics are always 1.
export function leafiness(month: number, south: boolean, deciduous: boolean, lush: boolean) {
  return !deciduous || lush ? 1 : sampleYear(LEAF, month, south)
}
const tmp = new Color()
const AUTUMN = ['#e8a33a', '#d9622b', '#c9402a', '#f0c94a', '#b85a2a']
export function leafColour(base: string, deciduous: boolean, month: number, south: boolean, lush: boolean, seed: number, out = new Color()) {
  out.set(base)
  if (lush) return out
  if (!deciduous) return out.lerp(tmp.set('#6f8f7a'), 0.25 * sampleYear(DULL, month, south))
  const fresh = sampleYear(FRESH, month, south)
  if (fresh > 0) out.lerp(tmp.set(seed % 3 === 0 ? '#ffd3e6' : '#c9ef7a'), fresh * (seed % 3 === 0 ? 0.55 : 0.35))
  const turn = sampleYear(TURN, month, south)
  if (turn > 0) out.lerp(tmp.set(AUTUMN[seed % AUTUMN.length]!), turn * 0.8)
  return out
}
export const BARK = ['#7a4e2d', '#6b4a35', '#8a5a3a', '#5e4636']
export const TWIG_BARK = ['#6e5a4c', '#5f4c40', '#7a6555', '#57483f']

// ── shared scratch objects for matrix composition ──
export const scratch = { m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3(), o: new Object3D(), up: new Vector3(0, 1, 0) }
export function setInstance(mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) {
  scratch.p.set(x, y, z)
  scratch.q.setFromAxisAngle(scratch.up, rotY)
  scratch.s.set(sx, sy, sz)
  scratch.m.compose(scratch.p, scratch.q, scratch.s)
  mesh.setMatrixAt(i, scratch.m)
}

export function hash(n: number) {
  let t = (n * 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
