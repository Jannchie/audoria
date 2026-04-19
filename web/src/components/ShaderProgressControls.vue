<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface FilamentConfig {
  gain: number
  count: number
  amp: number
  freq: number
  speed: number
  pulseDepth: number
  pulseFreq: number
  density: number
  smoothness: number
  converge: number
  style: number
}

const STYLES: Array<{ id: number, key: 'aurora' | 'lightning' | 'dna' | 'circuit' }> = [
  { id: 0, key: 'aurora' },
  { id: 1, key: 'lightning' },
  { id: 2, key: 'dna' },
  { id: 3, key: 'circuit' },
]

const model = defineModel<FilamentConfig>({ required: true })
const { t } = useI18n()

interface Preset {
  key: 'aurora' | 'lightning' | 'dna' | 'circuit'
  config: FilamentConfig
}

const presets: Preset[] = [
  {
    key: 'aurora',
    config: { gain: 2.1, count: 6, amp: 2, freq: 3, speed: 1.5, pulseDepth: 0.66, pulseFreq: 0.65, density: 0.55, smoothness: 1.8, converge: 0.9, style: 0 },
  },
  {
    key: 'lightning',
    config: { gain: 2.2, count: 4, amp: 1.1, freq: 1.3, speed: 1.8, pulseDepth: 0.7, pulseFreq: 2.4, density: 1.1, smoothness: 0.7, converge: 0.95, style: 1 },
  },
  {
    key: 'dna',
    config: { gain: 2.4, count: 4, amp: 1.1, freq: 1.2, speed: 1.1, pulseDepth: 0.3, pulseFreq: 1, density: 1.2, smoothness: 1.3, converge: 0.8, style: 2 },
  },
  {
    key: 'circuit',
    config: { gain: 2.1, count: 4, amp: 1, freq: 1.1, speed: 0.9, pulseDepth: 0.45, pulseFreq: 1.8, density: 1.1, smoothness: 0.9, converge: 0.55, style: 3 },
  },
]

function applyPreset(p: Preset): void {
  model.value = { ...p.config }
}

const activePresetKey = computed(() => {
  for (const p of presets) {
    const c = p.config
    const m = model.value
    if (
      c.gain === m.gain
      && c.count === m.count
      && c.amp === m.amp
      && c.freq === m.freq
      && c.speed === m.speed
      && c.pulseDepth === m.pulseDepth
      && c.pulseFreq === m.pulseFreq
      && c.density === m.density
      && c.smoothness === m.smoothness
      && c.converge === m.converge
      && c.style === m.style
    ) {
      return p.key
    }
  }
  return null
})

function onInput(key: keyof FilamentConfig, event: Event): void {
  const t = event.target as HTMLInputElement
  const n = Number(t.value)
  model.value = { ...model.value, [key]: n }
}

const collapsed = ref(true)

const copyStatus = ref<'idle' | 'copied' | 'failed'>('idle')

function formatConfig(c: FilamentConfig): string {
  // Pretty TS object literal — paste-ready into a ref/default.
  const keys: (keyof FilamentConfig)[] = [
    'gain',
    'count',
    'amp',
    'freq',
    'speed',
    'pulseDepth',
    'pulseFreq',
    'density',
    'smoothness',
    'converge',
    'style',
  ]
  const body = keys.map((k) => {
    const v = c[k]
    const formatted = (k === 'count' || k === 'style') ? String(v) : Number(v).toFixed(2)
    return `  ${k}: ${formatted},`
  }).join('\n')
  return `{\n${body}\n}`
}

async function copyAll(): Promise<void> {
  const text = formatConfig(model.value)
  try {
    await navigator.clipboard.writeText(text)
    copyStatus.value = 'copied'
  }
  catch {
    copyStatus.value = 'failed'
  }
  setTimeout(() => {
    copyStatus.value = 'idle'
  }, 1400)
}

const copyLabel = computed(() => {
  if (copyStatus.value === 'copied') {
    return t('common.actions.copied')
  }
  if (copyStatus.value === 'failed') {
    return t('common.actions.failed')
  }
  return t('common.actions.copy')
})
</script>

<template>
  <Teleport to="body">
    <div
      class="shader-ctrl"
      :class="{ 'shader-ctrl--collapsed': collapsed }"
    >
      <div class="shader-ctrl__header">
        <button
          type="button"
          class="shader-ctrl__toggle"
          :aria-label="collapsed ? t('shader.expand') : t('shader.collapse')"
          @click="collapsed = !collapsed"
        >
          <span class="shader-ctrl__caret">{{ collapsed ? '▸' : '▾' }}</span>
          <span class="shader-ctrl__title">{{ t('shader.title') }}</span>
        </button>
        <button
          v-if="!collapsed"
          type="button"
          class="shader-ctrl__copy"
          :class="{ 'shader-ctrl__copy--done': copyStatus === 'copied', 'shader-ctrl__copy--fail': copyStatus === 'failed' }"
          @click="copyAll"
        >
          {{ copyLabel }}
        </button>
      </div>
      <template v-if="!collapsed">
        <div class="shader-ctrl__presets">
          <button
            v-for="p in presets"
            :key="p.key"
            type="button"
            class="shader-ctrl__preset"
            :class="{ 'shader-ctrl__preset--active': p.key === activePresetKey }"
            @click="applyPreset(p)"
          >
            {{ t(`shader.styles.${p.key}`) }}
          </button>
        </div>

        <div class="shader-ctrl__row">
          <label>{{ t('shader.shaderStyle') }}</label>
          <div class="shader-ctrl__styles">
            <button
              v-for="s in STYLES"
              :key="s.id"
              type="button"
              class="shader-ctrl__style"
              :class="{ 'shader-ctrl__style--active': model.style === s.id }"
              @click="model = { ...model, style: s.id }"
            >
              {{ t(`shader.styles.${s.key}`) }}
            </button>
          </div>
        </div>

        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.gain') }} <span>{{ model.gain.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="3"
            step="0.05"
            :value="model.gain"
            @input="onInput('gain', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.count') }} <span>{{ model.count }}</span></label>
          <input
            type="range"
            min="1"
            max="6"
            step="1"
            :value="model.count"
            @input="onInput('count', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.amp') }} <span>{{ model.amp.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            :value="model.amp"
            @input="onInput('amp', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.freq') }} <span>{{ model.freq.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0.3"
            max="3"
            step="0.05"
            :value="model.freq"
            @input="onInput('freq', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.speed') }} <span>{{ model.speed.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="3"
            step="0.05"
            :value="model.speed"
            @input="onInput('speed', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.pulseDepth') }} <span>{{ model.pulseDepth.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            :value="model.pulseDepth"
            @input="onInput('pulseDepth', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.pulseFreq') }} <span>{{ model.pulseFreq.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0.1"
            max="4"
            step="0.05"
            :value="model.pulseFreq"
            @input="onInput('pulseFreq', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.density') }} <span>{{ model.density.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0.2"
            max="2.5"
            step="0.05"
            :value="model.density"
            @input="onInput('density', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.smoothness') }} <span>{{ model.smoothness.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0.3"
            max="2.5"
            step="0.05"
            :value="model.smoothness"
            @input="onInput('smoothness', $event)"
          >
        </div>
        <div class="shader-ctrl__row">
          <label>{{ t('shader.controls.converge') }} <span>{{ model.converge.toFixed(2) }}</span></label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            :value="model.converge"
            @input="onInput('converge', $event)"
          >
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.shader-ctrl {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 100;
  width: 260px;
  padding: 12px 14px;
  background: rgba(14, 14, 16, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.85);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 11px;
  user-select: none;
  pointer-events: auto;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  transition: width 0.18s ease, padding 0.18s ease;
}
.shader-ctrl--collapsed {
  width: auto;
  padding: 6px 10px;
}

.shader-ctrl__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 6px;
}
.shader-ctrl--collapsed .shader-ctrl__header {
  margin-bottom: 0;
}

.shader-ctrl__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.shader-ctrl__caret {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1;
}

.shader-ctrl__title {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}

.shader-ctrl__copy {
  font: inherit;
  font-size: 10px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.shader-ctrl__copy:hover {
  background: rgba(255, 255, 255, 0.14);
}
.shader-ctrl__copy--done {
  background: rgba(52, 211, 153, 0.25);
  border-color: rgba(52, 211, 153, 0.5);
  color: #34d399;
}
.shader-ctrl__copy--fail {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
  color: #ef4444;
}

.shader-ctrl__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.shader-ctrl__preset {
  flex: 1 0 auto;
  font: inherit;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.shader-ctrl__preset:hover {
  background: rgba(255, 255, 255, 0.1);
}
.shader-ctrl__preset--active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.shader-ctrl__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.shader-ctrl__row label {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.7);
}
.shader-ctrl__row label span {
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.45);
}
.shader-ctrl__row input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.shader-ctrl__styles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.shader-ctrl__style {
  font: inherit;
  font-size: 10px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.shader-ctrl__style:hover {
  background: rgba(255, 255, 255, 0.1);
}
.shader-ctrl__style--active {
  background: rgba(232, 87, 74, 0.2);
  border-color: var(--accent);
  color: #ffd9d3;
}
</style>
