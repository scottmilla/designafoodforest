<script setup lang="ts">
// A wet-on-wet watercolour sky (warm streams bleeding through cool blue-violet over paper grain),
// now painted for the person's real sky: night deepens it to indigo with stars, dusk floods the horizon
// rose-gold, and cloud cover washes it toward soft lilac-grey.
const s = useDesign()
const uniforms = { uTime: { value: 0 }, uDay: { value: 1 }, uDusk: { value: 0 }, uOver: { value: 0 } }
const { onBeforeRender } = useLoop()
onBeforeRender(({ elapsed, delta }) => {
  const e = s.env.value
  const k = Math.min(1, delta * 1.5)
  uniforms.uTime.value = elapsed
  uniforms.uDay.value += (e.day - uniforms.uDay.value) * k
  uniforms.uDusk.value += (e.dusk - uniforms.uDusk.value) * k
  uniforms.uOver.value += (e.overcast - uniforms.uOver.value) * k
})

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime, uDay, uDusk, uOver;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float el = max(d.y, 0.0);
    vec2 p = vec2(atan(d.x, -d.z) * 1.3, el * 2.2);
    float t = uTime * 0.025;

    vec2 q = vec2(fbm(p * 0.9 + vec2(0.0, t)), fbm(p * 0.9 + vec2(5.2, 1.3 - t)));
    vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + t), fbm(p + 2.0 * q + vec2(8.3, 2.8) - t));
    float f = fbm(p + 2.4 * r);
    float s = p.x * 0.8 + p.y * 1.6 + f * 2.6 + r.x * 1.2;
    float band = 0.5 + 0.5 * sin(s * 1.9);
    float band2 = 0.5 + 0.5 * sin(s * 0.8 + 1.7 + q.y * 1.2);

    // day palette: clear blues with soft warm streams
    vec3 blue = vec3(0.45, 0.66, 0.92);
    vec3 violet = vec3(0.62, 0.58, 0.88);
    vec3 rose = vec3(1.0, 0.70, 0.74);
    vec3 orange = vec3(1.0, 0.70, 0.40);
    vec3 yellow = vec3(1.0, 0.90, 0.55);

    vec3 col = mix(blue, violet, smoothstep(0.2, 0.8, band2) * 0.6);
    col = mix(col, rose, smoothstep(0.55, 0.85, band) * (0.25 + uDusk * 0.6));
    col = mix(col, orange, smoothstep(0.6, 0.95, band * band2 * 1.7) * (0.15 + uDusk * 0.7));
    col = mix(col, yellow, smoothstep(0.75, 0.98, f * band * 1.5) * 0.35);

    // horizon warmth, deeper blue at the zenith
    col = mix(col, mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.6, 0.45), uDusk), (1.0 - smoothstep(0.0, 0.45, el)) * (0.35 + uDusk * 0.5));
    col = mix(col, mix(blue * 0.8, violet, f), smoothstep(0.55, 1.0, el) * 0.45);

    // overcast: a lilac-grey wash with soft cloud mottling
    vec3 grey = mix(vec3(0.70, 0.71, 0.78), vec3(0.84, 0.82, 0.86), f);
    col = mix(col, grey, uOver * 0.8);

    // night: indigo lasur with violet streams and stars
    vec3 night = mix(vec3(0.07, 0.08, 0.22), vec3(0.20, 0.13, 0.36), smoothstep(0.2, 0.9, band2));
    night = mix(night, vec3(0.30, 0.18, 0.40), (1.0 - smoothstep(0.0, 0.35, el)) * 0.6);
    float star = step(0.9975, hash(floor(d.xz * 260.0 + d.y * 91.0))) * smoothstep(0.08, 0.4, el) * (1.0 - uOver);
    night += vec3(star) * (0.6 + 0.4 * sin(uTime * 3.0 + d.x * 50.0));
    col = mix(night, col, clamp(uDay + uDusk * 0.35, 0.0, 1.0));

    float grain = noise(gl_FragCoord.xy * 0.9) * 0.6 + noise(gl_FragCoord.xy * 0.25) * 0.4;
    col *= 0.94 + 0.08 * grain;
    gl_FragColor = vec4(col, 1.0);
  }
`
</script>

<template>
  <TresMesh :position="[0, -20, 0]" :scale="[1.6, 1.2, 1.6]">
    <TresSphereGeometry :args="[150, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2 + 0.25]" />
    <TresShaderMaterial :uniforms="uniforms" :vertex-shader="vertexShader" :fragment-shader="fragmentShader" :side="1" :depth-write="false" :fog="false" />
  </TresMesh>
</template>
