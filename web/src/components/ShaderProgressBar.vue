<script setup lang="ts">
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface FilamentConfig {
  gain: number
  count: number
  amp: number
  freq: number
  speed: number
  pulseDepth: number
  pulseFreq: number
  density: number // how spread-out neighbouring strands are in y
  smoothness: number // 0 = razor thin, 2 = fat and soft
  converge: number // 0 = strands parallel to the bar; 1 = funnel into the head
  // 0 Aurora (smooth sine), 1 Lightning (jagged sawtooth + noise),
  // 2 DNA helix (alternating mirrored sines), 3 Circuit (stepped stair)
  style: number
}

const props = withDefaults(defineProps<{
  progress: number
  colors: string[]
  playing?: boolean
  scrubbing?: boolean
  hovered?: boolean
  height?: number
  // Incremented by the parent whenever a lyric line changes; each increment
  // triggers a sweeping highlight + glow pulse on the played region.
  lyricTick?: number
  // Horizontal overflow in px on each side. The canvas extends past the
  // parent's content box so filaments and the head glow can trail off
  // without being clipped. Does not affect the click hit-region.
  padX?: number
  filament?: FilamentConfig
}>(), {
  playing: false,
  scrubbing: false,
  hovered: false,
  height: 44,
  lyricTick: 0,
  padX: 56,
  filament: (): FilamentConfig => ({
    gain: 1,
    count: 3,
    amp: 1,
    freq: 1,
    speed: 1,
    pulseDepth: 0,
    pulseFreq: 1.2,
    density: 1,
    smoothness: 1,
    converge: 1,
    style: 0,
  }),
})

const container = ref<HTMLDivElement | null>(null)

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Fragment shader: flowing gradient on played side, faint track on unplayed,
// pulsing glow at the playhead, reacts to scrubbing/hover intensity.
const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uProgress;  // progress in the hit region [0, 1]
  uniform float uIntensity;
  uniform float uAlive;     // 0 = paused (dim), 1 = playing; gates filaments and playhead decorations
  uniform float uAspect;
  uniform float uPulse;
  uniform float uSweep;     // 0 = idle, rises 0 → 1.2 then decays; drives a travelling highlight
  uniform float uSweepLife; // remaining life of the current sweep in [0, 1]
  uniform float uPad;       // horizontal padding in uv.x (each side of the hit region)
  uniform float uFGain;       // filament brightness multiplier
  uniform float uFCount;      // active filament count (1..6)
  uniform float uFAmp;        // y amplitude multiplier
  uniform float uFFreq;       // wave frequency multiplier
  uniform float uFSpeed;      // wave time-speed multiplier
  uniform float uFPulseDepth; // 0 = steady, 1 = fully pumping
  uniform float uFPulseFreq;  // pulse cycles per second
  uniform float uFDensity;    // y-spread between strands (1 = default)
  uniform float uFSmooth;     // 0.3 = razor-thin, 2 = soft & fat
  uniform float uFConverge;   // 0 = parallel, 1 = funnel to playhead
  uniform float uStyle;       // 0..5 selects the filament sampling strategy
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;

  // cheap hash-based 2D noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * noise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return v;
  }

  // Vertical offset of the bar's center line (soft snaking warp).
  float barCenter(float x) {
    return sin(x * 5.5 - uTime * 1.1) * 0.08
         + sin(x * 11.3 + uTime * 0.7) * 0.04
         + sin(x * 2.1 - uTime * 0.4) * 0.05;
  }

  void main() {
    vec2 uv = vUv;
    float y = (uv.y - 0.5) * 2.0; // [-1, 1]

    // The canvas is wider than the clickable track by uPad on each side.
    // Map uProgress (in track space) to the canvas x coordinate.
    float barStart = uPad;
    float barEnd = 1.0 - uPad;
    float barRange = max(barEnd - barStart, 1e-4);
    float progX = barStart + uProgress * barRange;
    float dHead = uv.x - progX;

    // whether this pixel is inside the clickable track area horizontally
    float trackLR = smoothstep(barStart - 0.002, barStart + 0.002, uv.x)
                  * smoothstep(barEnd + 0.002, barEnd - 0.002, uv.x);
    float playedMask = smoothstep(0.0, 0.003, progX - uv.x) * trackLR;

    // --- bar warp ---
    float center = barCenter(uv.x) * (0.55 + 0.35 * uIntensity);
    float yRel = y - center;

    // --- played-side gradient, mapped to bar-local x for natural palette flow ---
    float bx = clamp((uv.x - barStart) / barRange, 0.0, 1.0);
    vec2 flowUv = vec2(uv.x * uAspect, uv.y);
    float flow = fbm(flowUv * 2.4 + vec2(-uTime * 0.22, uTime * 0.08));
    float wave = sin(bx * 11.0 - uTime * 0.8 + flow * 2.2) * 0.5 + 0.5;

    vec3 grad = mix(uColor1, uColor2, smoothstep(0.0, 0.6, bx));
    grad = mix(grad, uColor3, smoothstep(0.4, 1.0, bx));
    grad = mix(grad, grad * 1.35 + 0.04, wave * 0.45);
    grad += flow * 0.08;

    // --- unplayed track: thin straight midline ---
    float trackBand = smoothstep(0.07, 0.0, abs(y));
    vec3 trackCol = mix(uColor1, vec3(1.0), 0.12) * 0.22;
    float trackA = trackBand * 0.45 * trackLR * (1.0 - playedMask * 0.92);

    // --- played bar body: thinner capsule around warped center ---
    float barHalf = 0.09 + 0.04 * uIntensity;
    float capsule = smoothstep(barHalf, barHalf * 0.2, abs(yRel));
    vec3 playedCol = grad * (0.8 + 0.3 * uIntensity);
    float playedA = capsule * playedMask;

    // --- light filaments: up to 6 strands, with multiple shader styles ---
    vec3 filamentCol = vec3(0.0);
    float filamentA = 0.0;

    // Shared convergence funnel (fades amplitude toward the playhead)
    float distToHead = progX - uv.x;
    float funnel = smoothstep(0.0, 0.45, distToHead);
    float ampScale = mix(1.0, funnel, clamp(uFConverge, 0.0, 1.0));

    float smoothK = max(uFSmooth * uFSmooth, 0.05);

    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float enabled = step(fi, uFCount - 0.5);

      float fy = center;
      float strand = 0.0;

      if (uStyle < 0.5) {
        // 0 Aurora — smooth sine wave strands
        float freq = (3.4 + fi * 2.0) * uFFreq;
        float speed = (0.55 + fi * 0.2) * uFSpeed;
        float phase = fi * 1.9 + flow * 1.2;
        fy = center + sin(uv.x * freq - uTime * speed + phase)
                   * (0.18 + fi * 0.12 * uFDensity) * uFAmp * ampScale;
        float d = abs(y - fy);
        float thickness = (180.0 + fi * 60.0) / smoothK;
        strand = exp(-d * d * thickness);
      }
      else if (uStyle < 1.5) {
        // 1 Lightning — sawtooth + noise jitter, sharp bolts
        float freq = (5.5 + fi * 1.4) * uFFreq;
        float speed = (1.6 + fi * 0.4) * uFSpeed;
        float ph = uv.x * freq - uTime * speed + fi * 1.3;
        float saw = abs(fract(ph * 0.5) - 0.5) * 4.0 - 1.0;
        float jit = (noise(vec2(uv.x * 14.0 + fi * 7.3, uTime * 3.2)) - 0.5) * 0.9;
        fy = center + (saw + jit) * (0.22 + fi * 0.08 * uFDensity) * uFAmp * ampScale;
        float d = abs(y - fy);
        float thickness = (260.0 + fi * 80.0) / smoothK;
        strand = exp(-d * d * thickness);
      }
      else if (uStyle < 2.5) {
        // 2 DNA — mirrored sine pairs weaving across each other
        float freq = (3.6 + fi * 0.8) * uFFreq;
        float speed = (1.0 + fi * 0.15) * uFSpeed;
        float flip = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
        float s = sin(uv.x * freq - uTime * speed + fi * 0.7);
        fy = center + s * flip * (0.38 - fi * 0.03) * uFDensity * uFAmp * ampScale;
        float d = abs(y - fy);
        float thickness = (220.0 + fi * 40.0) / smoothK;
        strand = exp(-d * d * thickness);
      }
      else {
        // 3 Circuit — stepped / quantized paths, HUD feel
        float steps = 7.0 + fi * 2.0;
        float freq = (2.2 + fi * 0.9) * uFFreq;
        float speed = (0.4 + fi * 0.12) * uFSpeed;
        float raw = sin(uv.x * freq - uTime * speed + fi * 1.1);
        float quant = floor(raw * steps) / steps;
        fy = center + quant * (0.3 + fi * 0.06 * uFDensity) * uFAmp * ampScale;
        float d = abs(y - fy);
        float thickness = (300.0 + fi * 80.0) / smoothK;
        strand = exp(-d * d * thickness);
      }

      float lenMask = smoothstep(0.0, 0.05, uv.x)
                   * smoothstep(1.0, 0.95, uv.x)
                   * smoothstep(progX + 0.05, progX - 0.04, uv.x);

      float pulsePhase = uTime * uFPulseFreq * 6.28318 + fi * 0.85;
      float rhythm = 1.0 - uFPulseDepth + uFPulseDepth * (0.5 + 0.5 * sin(pulsePhase));

      float aContrib = strand * (0.32 - fi * 0.045) * lenMask * uFGain * rhythm * enabled * uAlive;
      filamentA += aContrib;

      vec3 strandCol = mix(uColor2, uColor3, fract(fi * 0.37 + uTime * 0.07));
      strandCol = mix(strandCol, vec3(1.0), 0.22);
      filamentCol += strandCol * aContrib * 1.2;
    }
    filamentA = clamp(filamentA, 0.0, 1.0);

    // --- playhead: layered lens-flare style (ellipse core + streak + ring) ---
    // normalize to "height/2" units so shapes are aspect-aware
    float aspX = dHead * uAspect;
    float aspY = y - center;
    float rx = 0.55; // horizontal half-axis for the core
    float ry = 0.18; // vertical half-axis for the core
    float e = (aspX * aspX) / (rx * rx) + (aspY * aspY) / (ry * ry);

    // Asymmetric side mask: the halo arm that points past either end of the
    // bar shrinks as the playhead nears that end, so the whole head (bloom,
    // ring, horizontal streak) looks anchored to the track.
    float leftFade = smoothstep(0.0, 0.14, uProgress);
    float rightFade = smoothstep(1.0, 0.86, uProgress);
    // soft side selector around aspX=0 avoids a visible seam at the playhead
    float side = smoothstep(-0.01, 0.01, aspX);
    float armMask = mix(leftFade, rightFade, side);

    // Bright elongated core (symmetric, never clipped)
    float headCore = exp(-e * 5.5);
    // Bloom spreads horizontally → side-masked
    float headBloom = exp(-e * 1.2) * (0.25 + 0.3 * uIntensity) * armMask;

    // Cross-shaped star burst: horizontal + vertical streaks share one
    // twinkle envelope so both arms flicker in sync.
    float twinkle = clamp(
      0.88 + 0.10 * sin(uTime * 2.4) + 0.07 * sin(uTime * 5.3 + 0.7),
      0.7,
      1.05
    );
    // Horizontal: thin in y, moderately wide in x; also side-masked
    float streakH = exp(-(aspY * aspY) * 200.0) * exp(-(aspX * aspX) * 1.4) * twinkle * armMask;
    // Vertical: shorter spark in y, very thin in x (stays symmetric)
    float streakV = exp(-(aspX * aspX) * 260.0) * exp(-(aspY * aspY) * 3.0) * 0.7 * twinkle;

    // Breathing ring around the core — pumps with the pulse; side-masked
    float breath = 0.5 + 0.5 * sin(uTime * 2.6);
    float distE = sqrt(e);
    float ring = exp(-pow((distE - 1.05) * 4.5, 2.0))
               * (0.3 + 0.6 * uPulse + 0.18 * breath) * armMask;

    float head = headCore * 0.9
               + headBloom * 0.35 * uAlive
               + streakH * (0.5 + 0.2 * uIntensity) * uAlive
               + streakV * (0.65 + 0.25 * uIntensity) * uAlive
               + ring * 0.55 * uAlive;

    vec3 headCol = mix(uColor3, vec3(1.0), 0.6);
    vec3 flareCol = mix(uColor3, vec3(1.0), 0.85);

    // --- composite ---
    vec3 col = trackCol * trackA;
    col = mix(col, playedCol, playedA);
    col += filamentCol * 0.8;
    col += headCol * head;
    // extra hot glow along the cross streaks so the star reads clearly
    col += flareCol * streakH * 0.18 * uAlive;
    col += flareCol * streakV * 0.25 * uAlive;

    float shimmer = sin((uv.x - uTime * 0.12) * 80.0) * 0.02 * playedA * uAlive;
    col += shimmer;

    // lyric sweep: travelling highlight band (in canvas x)
    float sweepX = barStart + uSweep * barRange;
    float sweepBand = exp(-pow((uv.x - sweepX) * 22.0, 2.0));
    float sweepA = sweepBand * capsule * playedMask * uSweepLife;
    vec3 sweepCol = mix(headCol, vec3(1.0), 0.3);
    col += sweepCol * sweepA * 1.1;

    float alpha = clamp(trackA + playedA + head + sweepA + filamentA * 0.75, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`

interface ShaderUniforms {
  uTime: { value: number }
  uProgress: { value: number }
  uIntensity: { value: number }
  uAlive: { value: number }
  uAspect: { value: number }
  uPulse: { value: number }
  uSweep: { value: number }
  uSweepLife: { value: number }
  uPad: { value: number }
  uFGain: { value: number }
  uFCount: { value: number }
  uFAmp: { value: number }
  uFFreq: { value: number }
  uFSpeed: { value: number }
  uFPulseDepth: { value: number }
  uFPulseFreq: { value: number }
  uFDensity: { value: number }
  uFSmooth: { value: number }
  uFConverge: { value: number }
  uStyle: { value: number }
  uColor1: { value: THREE.Color }
  uColor2: { value: THREE.Color }
  uColor3: { value: THREE.Color }
}

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let material: THREE.ShaderMaterial | null = null
let geometry: THREE.BufferGeometry | null = null
let mesh: THREE.Mesh | null = null
let uniforms: ShaderUniforms | null = null
let rafId = 0
let resizeObserver: ResizeObserver | null = null
let lastFrameTs = 0
let renderedProgress = 0
let pulseStrength = 0
// Sweep animation state: sweepTarget = end X in uv space, sweepT ∈ [0, 1] eases 0 → 1
let sweepActive = false
let sweepT = 0
let sweepTarget = 1
const SWEEP_DURATION = 1.1 // seconds for the highlight to travel end-to-end

function parseColor(input: string | undefined, fallback: string): THREE.Color {
  try {
    return new THREE.Color(input || fallback)
  }
  catch {
    return new THREE.Color(fallback)
  }
}

function applyColors(cs: string[]): void {
  if (!uniforms) {
    return
  }
  uniforms.uColor1.value = parseColor(cs[0], '#1a2a4a')
  uniforms.uColor2.value = parseColor(cs[1], '#2d5a8f')
  uniforms.uColor3.value = parseColor(cs[2], '#6fb8d0')
}

function resize(width: number, height: number): void {
  if (!renderer || !uniforms) {
    return
  }
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height, false)
  uniforms.uAspect.value = height > 0 ? width / height : 1
  // horizontal padding in uv space = pixel padding / canvas width
  uniforms.uPad.value = width > 0 ? Math.min(0.25, props.padX / width) : 0
}

function animate(ts: number): void {
  rafId = requestAnimationFrame(animate)
  if (!renderer || !scene || !camera || !uniforms) {
    return
  }
  const dt = lastFrameTs === 0 ? 0 : Math.min(0.05, (ts - lastFrameTs) / 1000)
  lastFrameTs = ts

  // target intensity: hover < playing < scrubbing
  let targetIntensity = 0.35
  if (props.playing) {
    targetIntensity = 0.7
  }
  if (props.hovered) {
    targetIntensity = Math.max(targetIntensity, 0.85)
  }
  if (props.scrubbing) {
    targetIntensity = 1.2
  }
  uniforms.uIntensity.value += (targetIntensity - uniforms.uIntensity.value) * Math.min(1, dt * 6)

  // Fade filaments and playhead decorations when paused; hover/scrub keep them alive.
  let targetAlive = 0
  if (props.playing) {
    targetAlive = 1
  }
  if (props.hovered) {
    targetAlive = Math.max(targetAlive, 0.7)
  }
  if (props.scrubbing) {
    targetAlive = 1
  }
  uniforms.uAlive.value += (targetAlive - uniforms.uAlive.value) * Math.min(1, dt * 2.5)

  // smooth progress so seeking doesn't look teleporty in the shader
  const diff = props.progress - renderedProgress
  if (Math.abs(diff) > 0.0005) {
    // bigger jumps imply a seek → trigger pulse
    if (Math.abs(diff) > 0.02) {
      pulseStrength = Math.min(1, pulseStrength + Math.min(1, Math.abs(diff) * 4))
    }
    renderedProgress += diff * Math.min(1, dt * 12)
  }
  else {
    renderedProgress = props.progress
  }
  uniforms.uProgress.value = renderedProgress

  pulseStrength *= Math.max(0, 1 - dt * 3.5)
  uniforms.uPulse.value = pulseStrength

  // Push current filament settings each frame (cheap, keeps the control panel live).
  uniforms.uFGain.value = props.filament.gain
  uniforms.uFCount.value = props.filament.count
  uniforms.uFAmp.value = props.filament.amp
  uniforms.uFFreq.value = props.filament.freq
  uniforms.uFSpeed.value = props.filament.speed
  uniforms.uFPulseDepth.value = props.filament.pulseDepth
  uniforms.uFPulseFreq.value = props.filament.pulseFreq
  uniforms.uFDensity.value = props.filament.density
  uniforms.uFSmooth.value = props.filament.smoothness
  uniforms.uFConverge.value = props.filament.converge
  uniforms.uStyle.value = props.filament.style

  // sweep animation: travel from 0 to sweepTarget (slightly past the playhead
  // so the band continues off-screen), fade life over second half
  if (sweepActive) {
    sweepT += dt / SWEEP_DURATION
    if (sweepT >= 1) {
      sweepActive = false
      sweepT = 1
    }
    // ease out cubic for a natural deceleration
    const e = 1 - (1 - sweepT) ** 3
    uniforms.uSweep.value = e * sweepTarget
    // life: full first 60%, then fade
    uniforms.uSweepLife.value = sweepT < 0.6 ? 1 : Math.max(0, 1 - (sweepT - 0.6) / 0.4)
  }
  else {
    uniforms.uSweepLife.value = 0
  }

  // only advance time while alive; slower when paused for a calmer feel
  const timeSpeed = props.playing || props.scrubbing ? 1 : 0.35
  uniforms.uTime.value += dt * timeSpeed

  renderer.render(scene, camera)
}

function triggerLyricSweep(): void {
  sweepActive = true
  sweepT = 0
  // travel ~10% past the current playhead so the band exits off the played region
  sweepTarget = Math.min(1.1, Math.max(0.08, renderedProgress + 0.1))
  pulseStrength = Math.min(1, pulseStrength + 0.55)
}

onMounted(() => {
  const el = container.value
  if (!el) {
    return
  }

  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  uniforms = {
    uTime: { value: 0 },
    uProgress: { value: props.progress },
    uIntensity: { value: 0.4 },
    uAlive: { value: props.playing ? 1 : 0 },
    uAspect: { value: 1 },
    uPulse: { value: 0 },
    uSweep: { value: 0 },
    uSweepLife: { value: 0 },
    uPad: { value: 0.05 },
    uFGain: { value: props.filament.gain },
    uFCount: { value: props.filament.count },
    uFAmp: { value: props.filament.amp },
    uFFreq: { value: props.filament.freq },
    uFSpeed: { value: props.filament.speed },
    uFPulseDepth: { value: props.filament.pulseDepth },
    uFPulseFreq: { value: props.filament.pulseFreq },
    uFDensity: { value: props.filament.density },
    uFSmooth: { value: props.filament.smoothness },
    uFConverge: { value: props.filament.converge },
    uStyle: { value: props.filament.style },
    uColor1: { value: parseColor(props.colors[0], '#1a2a4a') },
    uColor2: { value: parseColor(props.colors[1], '#2d5a8f') },
    uColor3: { value: parseColor(props.colors[2], '#6fb8d0') },
  }

  geometry = new THREE.PlaneGeometry(2, 2)
  material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true })
  renderer.setClearColor(0x00_00_00, 0)
  el.append(renderer.domElement)
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'

  renderedProgress = props.progress
  resize(el.clientWidth || 1, el.clientHeight || props.height)

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      resize(width, height)
    }
  })
  resizeObserver.observe(el)

  rafId = requestAnimationFrame(animate)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (mesh && scene) {
    scene.remove(mesh)
  }
  geometry?.dispose()
  material?.dispose()
  renderer?.dispose()
  if (renderer?.domElement && renderer.domElement.parentElement) {
    renderer.domElement.remove()
  }
  renderer = null
  scene = null
  camera = null
  material = null
  geometry = null
  mesh = null
  uniforms = null
})

watch(() => props.colors, (next) => {
  applyColors(next)
}, { deep: true })

// Parent increments lyricTick on each lyric-line change; kick off a sweep.
watch(() => props.lyricTick, (next, prev) => {
  if (next !== prev && next > 0) {
    triggerLyricSweep()
  }
})
</script>

<template>
  <div
    ref="container"
    class="shader-progress"
    :style="{
      height: `${height}px`,
      width: `calc(100% + ${padX * 2}px)`,
      marginLeft: `-${padX}px`,
      marginRight: `-${padX}px`,
    }"
    aria-hidden="true"
  />
</template>

<style scoped>
.shader-progress {
  position: relative;
  overflow: visible;
  isolation: isolate;
  pointer-events: none;
}
</style>
