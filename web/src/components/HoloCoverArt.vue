<script setup lang="ts">
import type { CoverEffectPreset } from '../constants/coverEffects'
import { useIdle, useMouseInElement } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { coverEffectAttributesByPreset, defaultCoverEffectPreset } from '../constants/coverEffects'
import ParallaxCard from './ParallaxCard.vue'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  alt: string
  effect?: CoverEffectPreset
  foregroundMaskUrl?: string
  imageUrl?: string
  playing?: boolean
}>()

const target = ref<HTMLDivElement | null>(null)
const idle = useIdle(2000)
const {
  elementX,
  elementY,
  elementWidth,
  elementHeight,
} = useMouseInElement(target, { handleOutside: true })

function normalizePointer(value: number, size: number): number {
  if (!size) {
    return 50
  }
  return Math.min(100, Math.max(0, (value / size) * 100))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const normalizedEffect = computed(() => props.effect ?? defaultCoverEffectPreset)
const effectAttributes = computed(() => coverEffectAttributesByPreset[normalizedEffect.value])
const pointerX = computed(() => idle.idle.value ? 50 : normalizePointer(elementX.value, elementWidth.value))
const pointerY = computed(() => idle.idle.value ? 50 : normalizePointer(elementY.value, elementHeight.value))
const coverStyle = computed(() => ({
  '--pointer-x': `${pointerX.value}%`,
  '--pointer-y': `${pointerY.value}%`,
  '--pointer-from-center': String(clamp(
    Math.sqrt(
      (pointerY.value - 50) * (pointerY.value - 50)
      + (pointerX.value - 50) * (pointerX.value - 50),
    ) / 50,
    0,
    1,
  )),
  '--pointer-from-top': String(pointerY.value / 100),
  '--pointer-from-left': String(pointerX.value / 100),
  '--card-opacity': idle.idle.value ? '0' : '1',
  '--background-x': `${37 + pointerX.value * 0.26}%`,
  '--background-y': `${33 + pointerY.value * 0.34}%`,
}))

const foregroundMaskReady = ref(false)

function createDirectMaskStyle(maskUrl?: string) {
  if (!maskUrl) {
    return {}
  }
  return {
    '-webkit-mask-image': `url(${maskUrl})`,
    'mask-image': `url(${maskUrl})`,
  }
}

const foregroundMaskStyle = computed(() => createDirectMaskStyle(props.foregroundMaskUrl))

function watchMaskReady(source: () => string | undefined, state: typeof foregroundMaskReady) {
  let requestId = 0

  watch(source, (url) => {
    requestId += 1
    const currentRequestId = requestId
    state.value = false

    if (!url) {
      return
    }

    if (typeof Image === 'undefined') {
      state.value = true
      return
    }

    const image = new Image()
    image.decoding = 'async'
    image.addEventListener('load', () => {
      if (currentRequestId === requestId) {
        state.value = true
      }
    })
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    image.onerror = () => {
      if (currentRequestId === requestId) {
        state.value = false
      }
    }
    image.src = url
  }, { immediate: true })
}
watchMaskReady(() => props.foregroundMaskUrl, foregroundMaskReady)
</script>

<template>
  <div
    class="holo-cover-root"
    v-bind="$attrs"
  >
    <ParallaxCard class="holo-cover-card">
      <div
        ref="target"
        class="holo-cover card"
        :class="{ 'holo-cover--playing': playing }"
        :data-number="effectAttributes.number"
        :data-rarity="effectAttributes.rarity"
        :data-set="effectAttributes.set"
        :data-subtypes="effectAttributes.subtypes"
        :data-supertype="effectAttributes.supertype"
        :data-trainer-gallery="effectAttributes.trainerGallery"
        :style="coverStyle"
      >
        <img
          v-if="imageUrl"
          :src="imageUrl"
          :alt="alt"
          class="holo-cover__image holo-cover__image--base"
          width="1200"
          height="1200"
          decoding="async"
        >
        <div
          v-if="imageUrl"
          class="holo-cover__foil card__shine"
          aria-hidden="true"
        />
        <div
          v-if="imageUrl"
          class="holo-cover__glare card__glare"
          aria-hidden="true"
        />
        <img
          v-if="imageUrl && foregroundMaskUrl && foregroundMaskReady"
          :src="imageUrl"
          :alt="alt"
          class="holo-cover__image holo-cover__image--foreground holo-cover__masked"
          :style="foregroundMaskStyle"
          width="1200"
          height="1200"
          decoding="async"
        >
        <div
          v-if="!imageUrl"
          class="holo-cover__placeholder"
        >
          <span class="i-tabler-music text-5xl text-white/15" />
        </div>
      </div>
    </ParallaxCard>
  </div>
</template>

<style scoped>
@import "../styles/pokemon-card-effects.css";

.holo-cover-root {
  width: 100%;
  aspect-ratio: 1;
  flex-shrink: 0;
}

.holo-cover-card {
  width: 100%;
  height: 100%;
}

.holo-cover {
  --glitter: url("/img/glitter.png");
  --glittersize: 25%;
  --space: 5%;
  --angle: 133deg;
  --imgsize: cover;
  --red: #f80e35;
  --yellow: #eedf10;
  --green: #21e985;
  --blue: #0dbde9;
  --violet: #c929f1;
  --clip: inset(9.85% 8% 52.85% 8%);
  --clip-invert: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0 47.15%, 91.5% 47.15%, 91.5% 9.85%, 8% 9.85%, 8% 47.15%, 0 50%);
  --clip-stage: polygon(91.5% 9.85%, 57% 9.85%, 54% 12%, 17% 12%, 16% 14%, 12% 16%, 8% 16%, 8% 47.15%, 92% 47.15%);
  --clip-stage-invert: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0 47.15%, 91.5% 47.15%, 91.5% 9.85%, 57% 9.85%, 54% 12%, 17% 12%, 16% 14%, 12% 16%, 8% 16%, 8% 47.15%, 0 50%);
  --clip-trainer: inset(14.5% 8.5% 48.2% 8.5%);
  --clip-borders: inset(2.8% 4% round 2.55% / 1.5%);
  --card-glow: hsl(175, 100%, 90%);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--cover-radius, 0.75rem);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #18181b;
  isolation: isolate;
  transition: border-color 220ms ease;
}

.holo-cover--playing {
  border-color: rgba(255, 255, 255, 0.16);
}

.holo-cover__image,
.holo-cover__foil,
.holo-cover__glare,
.holo-cover__placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.holo-cover__image {
  display: block;
  object-fit: cover;
}

.holo-cover__masked {
  -webkit-mask-size: cover;
  mask-size: cover;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-mode: luminance;
  mask-mode: luminance;
}

.holo-cover__image--base {
  z-index: 1;
  filter: brightness(0.92) contrast(1.04);
}

.holo-cover__image--foreground {
  z-index: 4;
  transform: translateZ(18px) scale(1.015);
}

.card__shine,
.card__glare {
  will-change:
    transform,
    opacity,
    background-image,
    background-size,
    background-position,
    background-blend-mode,
    filter;
  pointer-events: none;
}

.card__shine {
  z-index: 2;
  background: transparent;
  background-size: cover;
  background-position: center;
  filter: brightness(.58) contrast(1.7) saturate(.38);
  mix-blend-mode: color-dodge;
  opacity: calc(var(--card-opacity) * 0.3);
}

.card__shine::before,
.card__shine::after,
.card__glare::before,
.card__glare::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.card__shine::before,
.card__shine::after {
  --sunpillar-1: hsl(2, 100%, 73%);
  --sunpillar-2: hsl(53, 100%, 69%);
  --sunpillar-3: hsl(93, 100%, 69%);
  --sunpillar-4: hsl(176, 100%, 76%);
  --sunpillar-5: hsl(228, 100%, 74%);
  --sunpillar-6: hsl(283, 100%, 73%);
  --sunpillar-clr-1: var(--sunpillar-5);
  --sunpillar-clr-2: var(--sunpillar-6);
  --sunpillar-clr-3: var(--sunpillar-1);
  --sunpillar-clr-4: var(--sunpillar-2);
  --sunpillar-clr-5: var(--sunpillar-3);
  --sunpillar-clr-6: var(--sunpillar-4);
  transform: translateZ(1px);
}

.card__shine::after {
  --sunpillar-clr-1: var(--sunpillar-6);
  --sunpillar-clr-2: var(--sunpillar-1);
  --sunpillar-clr-3: var(--sunpillar-2);
  --sunpillar-clr-4: var(--sunpillar-3);
  --sunpillar-clr-5: var(--sunpillar-4);
  --sunpillar-clr-6: var(--sunpillar-5);
  transform: translateZ(1.2px);
}

.card__glare {
  z-index: 3;
  transform: translateZ(1.41px);
  overflow: hidden;
  background-image: radial-gradient(
    farthest-corner circle at var(--pointer-x) var(--pointer-y),
    hsla(0, 0%, 100%, 0.1) 5%,
    hsla(0, 0%, 100%, 0.035) 12%,
    hsla(0, 0%, 0%, 0.04) 90%
  );
  opacity: calc(var(--card-opacity) * 0.16);
  mix-blend-mode: overlay;
}

.card[data-rarity="rare holo"] .card__glare::after,
.card[data-rarity="rare holo cosmos"] .card__glare::after,
.card[data-rarity$="reverse holo"] .card__glare::after {
  clip-path: var(--clip);
}

.card[data-rarity="rare holo"][data-subtypes^="stage"] .card__glare::after,
.card[data-rarity="rare holo cosmos"][data-subtypes^="stage"] .card__glare::after,
.card[data-rarity$="reverse holo"][data-subtypes^="stage"] .card__glare::after {
  clip-path: var(--clip-stage);
}

.card[data-rarity="rare holo"][data-supertype="trainer"] .card__glare::after,
.card[data-rarity="rare holo cosmos"][data-supertype="trainer"] .card__glare::after,
.card[data-rarity$="reverse holo"][data-supertype="trainer"] .card__glare::after {
  clip-path: var(--clip-trainer);
}

.holo-cover__placeholder {
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-elevated), var(--bg-surface));
}

@media (min-width: 768px) {
  .holo-cover {
    border-radius: var(--cover-radius, 1rem);
  }
}
</style>
