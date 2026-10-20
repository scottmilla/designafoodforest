<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const d = useDesign()
if (import.meta.dev) {
  ;(window as any).__d = d
  ;(window as any).__player = usePlayer()
  import('~/utils/suggest').then((m) => ((window as any).__suggest = m.suggestDesign)) // dev only: lets the console drive the engine
}
const root = ref<HTMLElement | null>(null)
// Pin the whole app to exactly what is visible: the visual viewport's size and position. Whatever the window,
// zoom or Dock does, nothing renders (or can be panned to) outside it.
function pin() {
  const el = root.value
  if (!el) return
  const v = window.visualViewport
  const w = v?.width ?? window.innerWidth
  const h = v?.height ?? window.innerHeight
  el.style.left = (v?.offsetLeft ?? 0) + 'px'
  el.style.top = (v?.offsetTop ?? 0) + 'px'
  el.style.width = w + 'px'
  el.style.height = h + 'px'
  document.documentElement.style.setProperty('--vh', h + 'px')
  document.documentElement.style.setProperty('--vw', w + 'px')
}
const noScroll = () => {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
  pin()
}
const mapRef = ref<{ fit(): void; diveHere(): void } | null>(null)
const detect = () => window.matchMedia('(max-width: 700px), (max-height: 480px)').matches
d.ui.mobile = detect()
const onResize = () => (d.ui.mobile = detect())

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
  if (d.stage.value !== 'map') return
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.shiftKey ? d.redo() : d.undo()
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault()
      d.redo()
    }
    return
  }
  if (e.key === 'Escape') {
    if (d.drawPts.value.length) d.drawPts.value = []
    else if (d.ui.card || d.inspect.value) {
      d.ui.card = null
      d.inspect.value = null
    } else d.setTool('pan')
  } else if (e.key === 'Enter' && d.drawPts.value.length) d.finishDraw()
  else if (e.key === 'Backspace' && d.drawPts.value.length) d.drawPts.value = d.drawPts.value.slice(0, -1)
}
// A trackpad pinch (or ⌘/Ctrl + scroll) over a panel would zoom the whole page and push the right-hand
// panels off-screen. The map and the forest have their own zoom, so the page itself never zooms.
const noPageZoom = (e: Event) => {
  if (e.type !== 'wheel' || (e as WheelEvent).ctrlKey) e.preventDefault()
}
const noZoomKeys = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '_'].includes(e.key)) e.preventDefault()
}
onMounted(() => {
  pin()
  window.addEventListener('resize', pin)
  window.addEventListener('scroll', noScroll, { passive: true })
  window.visualViewport?.addEventListener('resize', pin)
  window.visualViewport?.addEventListener('scroll', pin)
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keydown', noZoomKeys)
  window.addEventListener('wheel', noPageZoom, { passive: false })
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(t, noPageZoom, { passive: false })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', pin)
  window.removeEventListener('scroll', noScroll)
  window.visualViewport?.removeEventListener('resize', pin)
  window.visualViewport?.removeEventListener('scroll', pin)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', noZoomKeys)
  window.removeEventListener('wheel', noPageZoom)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.removeEventListener(t, noPageZoom)
})
</script>

<template>
  <div ref="root" class="game" :class="`stage-${d.stage.value}`">
    <ClientOnly>
      <Transition name="stage">
        <div v-if="d.stage.value === 'intro'" key="intro" class="layer">
          <Forest />
          <Intro />
        </div>
        <div v-else-if="d.stage.value === 'map'" key="map" class="layer">
          <DesignMap ref="mapRef" />
          <MapHud @dive="mapRef?.diveHere()" @fit="mapRef?.fit()" />
          <StepDock />
        </div>
        <div v-else key="forest" class="layer">
          <Forest />
          <ForestHud />
        </div>
      </Transition>
      <SpeciesCard />
    </ClientOnly>
  </div>
</template>
