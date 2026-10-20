// The month the 3D scene is showing, eased: when the month changes (the slider, ▶, or the live clock) the trees don't
// jump to it, they glide through the days in between, leafing out or dropping leaves as they go. Non-reactive and
// stepped once per frame by whichever scene component asks first (the farm's plants and the wild forest share it).
const state = { m: NaN, at: -1, moving: false }

export function useSeason() {
  return state
}

// move the shown month toward `target` (1..12, the shortest way round the year); returns whether it changed this frame
export function stepSeason(target: number, elapsed: number, dt: number) {
  if (state.at === elapsed) return state.moving
  state.at = elapsed
  if (!Number.isFinite(state.m)) {
    state.m = target
    state.moving = true // first frame: draw once
    return true
  }
  const d = ((((target - state.m) % 12) + 18) % 12) - 6 // −6 … 6 months
  if (Math.abs(d) < 0.01) {
    state.moving = state.m !== target // one last frame to land exactly
    state.m = target
    return state.moving
  }
  // ease, with a floor so a long jump doesn't crawl at the end (about 2 s for a six-month swing)
  const step = Math.sign(d) * Math.min(Math.abs(d), Math.max(Math.abs(d) * dt * 1.8, dt * 0.6))
  state.m = ((((state.m + step - 1) % 12) + 12) % 12) + 1
  state.moving = true
  return true
}
