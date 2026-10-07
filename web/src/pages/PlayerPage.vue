<script setup lang="ts">
import type { LyricsDoc } from '@audoria/lyrics-core'
import type { FilamentConfig } from '../components/ShaderProgressBar.vue'
import type { RubySegment } from '../composables/useFurigana'
import { shiftLyricsDoc } from '@audoria/lyrics-core'
import { useRafFn } from '@vueuse/core'
import { computed, defineAsyncComponent, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import HoloCoverArt from '../components/HoloCoverArt.vue'
import MetadataEditDialog from '../components/MetadataEditDialog.vue'
import ProgressPreviewTooltip from '../components/ProgressPreviewTooltip.vue'
import ShaderProgressControls from '../components/ShaderProgressControls.vue'
import { useAuth } from '../composables/useAuth'
import { useCoverPalette } from '../composables/useCoverPalette'
import { useDragScroll } from '../composables/useDragScroll'
import { applyReadingCorrection, useFurigana } from '../composables/useFurigana'
import { findLyricLineAtTime, layoutLyricLine, useLyrics, useLyricsDoc } from '../composables/useLyrics'
import { resolveApiUrl, useMusicQuery, useUpdateLyrics } from '../composables/useMusic'
import { usePlaybackClock } from '../composables/usePlaybackClock'
import { usePlayerState } from '../composables/usePlayerState'
import { useSettings } from '../composables/useSettings'
import { useStableViewportHeight } from '../composables/useStableViewportHeight'
import { formatTrackSpecs } from '../utils/audio'
import { getSourceDisplay } from '../utils/source'

const ShaderGradient = defineAsyncComponent(() => import('@shader-gradient/vue').then(module => module.ShaderGradient))
const ShaderGradientCanvas = defineAsyncComponent(() => import('@shader-gradient/vue').then(module => module.ShaderGradientCanvas))
const ShaderProgressBar = defineAsyncComponent(() => import('../components/ShaderProgressBar.vue'))

const { data: tracks } = useMusicQuery()
const { t } = useI18n()
const { coverEffect, coverEffectEnabled, progressEffectEnabled } = useSettings()
const router = useRouter()
const isMobile = useMediaQuery('(max-width: 767px)')
const prefersReducedMotion = usePreferredReducedMotion()
useStableViewportHeight({ variableName: '--player-viewport-height' })
const isDev = import.meta.env.DEV
const filamentConfig = ref<FilamentConfig>({
  gain: 2.1,
  count: 6,
  amp: 2,
  freq: 3,
  speed: 1.5,
  pulseDepth: 0.66,
  pulseFreq: 0.65,
  density: 0.55,
  smoothness: 1.8,
  converge: 0.9,
  style: 0,
})
const progressTrack = ref<HTMLDivElement | null>(null)
const volumeSlider = ref<HTMLInputElement | null>(null)
const isScrubbing = ref(false)
const isVolumeDragging = ref(false)
const isProgressHovered = ref(false)
const previewRatio = ref<number | null>(null)
const hoverPreviewTime = ref<number | null>(null)
const scrubPreviewTime = ref<number | null>(null)
const volumePreview = ref<number | null>(null)
const lyricShiftMs = ref(100)
const lyricError = ref('')
const isLyricsToolbarOpen = ref(false)
const updateLyricsMutation = useUpdateLyrics()
const {
  currentTrackId,
  isPlaying,
  currentTime,
  duration,
  playMode,
  playbackContext,
  volume,
  muted,
  selectTrack,
  setPlaying,
  cyclePlayMode,
  requestSeek,
  setVolume,
  toggleMute,
  getNextTrackId,
  getPreviousTrackId,
  upNextQueue,
} = usePlayerState()

const lyricsContainer = ref<HTMLDivElement | null>(null)
const { isDragging: isLyricsDragging, isDragScrolling: isLyricsDragScrolling } = useDragScroll(lyricsContainer)

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  if (currentTrackId.value) {
    return items.find(item => item.id === currentTrackId.value) ?? null
  }
  const contextTrackIds = playbackContext.value?.trackIds ?? []
  for (const trackId of contextTrackIds) {
    const track = items.find(item => item.id === trackId)
    if (track) {
      return track
    }
  }
  return items[0]
})

const resolvedCurrentTrackId = computed(() => currentTrack.value?.id ?? null)

const currentTrackCoverUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) {
    return ''
  }
  return resolveApiUrl(currentTrack.value.coverUrl)
})
const currentTrackForegroundMaskUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) {
    return ''
  }
  return resolveApiUrl(`/music/${currentTrack.value.id}/cover/mask`)
})

const { colors: paletteColors } = useCoverPalette(currentTrackCoverUrl)

const canvasProps = {
  pixelDensity: 1.5,
  fov: 45,
  preserveDrawingBuffer: false,
} as const

const gradientProps = computed(() => ({
  preset: 'deepOcean' as const,
  type: 'sphere' as const,
  animate: (prefersReducedMotion.value === 'reduce' ? 'off' : 'on') as 'on' | 'off',
  uTime: 0,
  uSpeed: 0.15,
  uStrength: 1.8,
  uDensity: 0.9,
  uFrequency: 4,
  uAmplitude: 2.5,
  range: false,
  rangeStart: 0,
  rangeEnd: 40,
  loop: false,
  loopDuration: 8,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 120,
  color1: paletteColors.value[0],
  color2: paletteColors.value[1],
  color3: paletteColors.value[2],
  reflection: 0.4,
  wireframe: false,
  shader: 'aurora',
  cAzimuthAngle: 200,
  cPolarAngle: 110,
  cDistance: 1.8,
  cameraZoom: 13.5,
  lightType: '3d' as const,
  brightness: 1.4,
  envPreset: 'city' as const,
  grain: 'on' as const,
  grainBlending: 0.6,
  toggleAxis: false,
  smoothTime: 0.18,
  enableTransition: true,
  enableCameraControls: true,
  enableCameraUpdate: true,
}))

const title = computed(() => currentTrack.value?.title || currentTrack.value?.filename || t('player.noTrackSelected'))
const artist = computed(() => currentTrack.value?.artists || t('player.unknownArtist'))
const album = computed(() => currentTrack.value?.album || '')
const trackSpecs = computed(() => currentTrack.value ? formatTrackSpecs(currentTrack.value) : '')
const currentLyrics = computed(() => currentTrack.value?.lyrics)
const isSavingLyrics = computed(() => updateLyricsMutation.isPending.value)

const lyricsDoc = useLyricsDoc(() => currentTrack.value)
const ttmlExportUrl = computed(() => currentTrack.value ? resolveApiUrl(`/music/${encodeURIComponent(currentTrack.value.id)}/lyrics/ttml`) : undefined)
const { parsed, isTimeSynced, plainText, currentLineIndex } = useLyrics(() => lyricsDoc.value)

const hasLyrics = computed(() => Boolean(currentLyrics.value?.trim()))

const { isGuest } = useAuth()
const {
  enabled: isFuriganaEnabled,
  hasJapanese,
  segmentsByCue: furiganaByCue,
} = useFurigana(() => currentTrack.value?.id, () => currentLyrics.value)
const lineLayouts = computed(() => parsed.value?.map(line => layoutLyricLine(line.words, furiganaByCue.value[line.id])) ?? [])
const isFuriganaEditing = ref(false)
const editingReading = ref<{ cueId: string, index: number } | null>(null)
const editingReadingValue = ref('')
const KANJI_RE = /\p{Script=Han}/u
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

function lyricLang(text: string): string | undefined {
  return KANA_RE.test(text) ? 'ja' : undefined
}

function isRubyEditable(segment: RubySegment): boolean {
  return isFuriganaEditing.value && KANJI_RE.test(segment.text)
}

function isEditingReading(cueId: string, index: number): boolean {
  return editingReading.value?.cueId === cueId && editingReading.value.index === index
}

function toggleFurigana(): void {
  isFuriganaEnabled.value = !isFuriganaEnabled.value
  if (!isFuriganaEnabled.value) {
    isFuriganaEditing.value = false
    editingReading.value = null
  }
}

async function handleRubyClick(event: MouseEvent, cueId: string, index: number, segment: RubySegment): Promise<void> {
  if (!isRubyEditable(segment)) {
    return
  }
  // In edit mode a click on a word edits its reading instead of seeking to the line.
  event.stopPropagation()
  editingReading.value = { cueId, index }
  editingReadingValue.value = segment.ruby ?? ''
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.lyric-ruby-input')
  input?.focus()
  input?.select()
}

function cancelReadingEdit(): void {
  editingReading.value = null
}

function handleReadingEnter(event: KeyboardEvent): void {
  // Enter also confirms an IME candidate while composing kana; only a plain Enter saves.
  if (event.isComposing) {
    return
  }
  event.preventDefault()
  saveReadingEdit().catch(() => {})
}

async function saveReadingEdit(): Promise<void> {
  const target = editingReading.value
  const track = currentTrack.value
  const doc = lyricsDoc.value
  const segments = target ? furiganaByCue.value[target.cueId] : undefined
  editingReading.value = null
  if (!target || !track || !doc || !segments || isSavingLyrics.value) {
    return
  }
  await saveLyricsDoc(track.id, doc, applyReadingCorrection(doc, target.cueId, segments, target.index, editingReadingValue.value))
}

async function saveLyricsDoc(trackId: string, doc: LyricsDoc, nextDoc: LyricsDoc): Promise<void> {
  if (nextDoc === doc) {
    return
  }
  lyricError.value = ''
  try {
    await updateLyricsMutation.mutateAsync({ id: trackId, doc: nextDoc })
  }
  catch (error) {
    lyricError.value = error instanceof Error ? error.message : t('player.lyrics.saveFailed')
  }
}

const progress = computed(() => {
  if (isScrubbing.value && scrubPreviewTime.value !== null && duration.value) {
    return Math.min(100, (scrubPreviewTime.value / duration.value) * 100)
  }
  if (!duration.value) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

const playModeIcon = computed(() => {
  if (playMode.value === 'sequence') {
    return 'i-jannchie-list'
  }
  if (playMode.value === 'repeat-all') {
    return 'i-jannchie-repeat'
  }
  if (playMode.value === 'repeat-one') {
    return 'i-jannchie-repeat-one'
  }
  return 'i-jannchie-shuffle'
})

const playModeLabel = computed(() => {
  let mode: string
  switch (playMode.value) {
    case 'sequence': {
      mode = t('player.playModes.sequence')
      break
    }
    case 'repeat-all': {
      mode = t('player.playModes.repeatAll')
      break
    }
    case 'repeat-one': {
      mode = t('player.playModes.repeatOne')
      break
    }
    default: {
      mode = t('player.playModes.shuffle')
    }
  }
  return t('player.playModeLabel', { mode })
})

const volumeIcon = computed(() => {
  if (muted.value || volume.value === 0) {
    return 'i-jannchie-volume-mute'
  }
  if (volume.value < 0.5) {
    return 'i-jannchie-volume-low'
  }
  return 'i-jannchie-volume'
})

const displayedCurrentTime = computed(() => {
  if (isScrubbing.value && scrubPreviewTime.value !== null) {
    return scrubPreviewTime.value
  }
  return currentTime.value
})
const previewTooltipVisible = computed(() =>
  previewRatio.value !== null
  && (hoverPreviewTime.value !== null || scrubPreviewTime.value !== null)
  && (isScrubbing.value || isProgressHovered.value),
)
const previewTooltipLyric = computed(() => {
  const previewTime = isScrubbing.value
    ? scrubPreviewTime.value
    : hoverPreviewTime.value
  const line = findLyricLineAtTime(parsed.value, previewTime ?? currentTime.value)
  return line?.text || t('player.noSyncedLyric')
})
const previewTooltipTimeLabel = computed(() => {
  const previewTime = isScrubbing.value
    ? scrubPreviewTime.value
    : hoverPreviewTime.value
  return formattedTime(previewTime ?? currentTime.value)
})
const effectiveVolume = computed(() => {
  if (volumePreview.value !== null) {
    return volumePreview.value
  }
  return muted.value ? 0 : volume.value
})
const volumeSliderStyle = computed(() => {
  const percent = Math.round(effectiveVolume.value * 100)
  return {
    background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(255, 255, 255) ${percent}%, rgba(255, 255, 255, 0.12) ${percent}%, rgba(255, 255, 255, 0.12) 100%)`,
  }
})

function formattedTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// function getAudioElement(): HTMLAudioElement | null {
//   return document.querySelector('audio')
// }

function ratioFromPointer(event: PointerEvent | MouseEvent): number {
  const track = progressTrack.value
  if (!track) {
    return 0
  }
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
}

function setPreviewByRatio(ratio: number): void {
  const total = duration.value || 0
  if (!total) {
    previewRatio.value = null
    return
  }
  const clamped = Math.min(1, Math.max(0, ratio))
  previewRatio.value = clamped
  const previewTime = clamped * total
  if (isScrubbing.value) {
    scrubPreviewTime.value = previewTime
    hoverPreviewTime.value = null
  }
  else {
    hoverPreviewTime.value = previewTime
  }
}

function clearProgressPreview(): void {
  if (isScrubbing.value) {
    return
  }
  isProgressHovered.value = false
  previewRatio.value = null
  hoverPreviewTime.value = null
}

function isPointerWithinTrack(event: PointerEvent): boolean {
  const track = progressTrack.value
  if (!track) {
    return false
  }
  const rect = track.getBoundingClientRect()
  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom
}

function commitSeekByRatio(ratio: number): void {
  const total = duration.value || 0
  const newTime = Math.min(1, Math.max(0, ratio)) * total
  requestSeek(newTime)
  scrubPreviewTime.value = null
}

function handleProgressKeydown(event: KeyboardEvent): void {
  const total = duration.value || 0
  if (!total) {
    return
  }
  const step = event.shiftKey ? 10 : 5
  let next: number | null = null
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown': { next = currentTime.value - step; break
    }
    case 'ArrowRight':
    case 'ArrowUp': { next = currentTime.value + step; break
    }
    case 'Home': { next = 0; break
    }
    case 'End': { next = total; break
    }
    default: { return
    }
  }
  event.preventDefault()
  commitSeekByRatio(Math.min(1, Math.max(0, next / total)))
}

function handleProgressPointerDown(event: PointerEvent): void {
  isScrubbing.value = true
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
  globalThis.addEventListener('pointermove', handleProgressPointerMove)
  globalThis.addEventListener('pointerup', handleProgressPointerUp)
  globalThis.addEventListener('pointercancel', handleProgressPointerUp)
}

function handleProgressPointerMove(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }
  setPreviewByRatio(ratioFromPointer(event))
}

function handleProgressPointerUp(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }
  commitSeekByRatio(ratioFromPointer(event))
  isScrubbing.value = false
  if (isPointerWithinTrack(event)) {
    isProgressHovered.value = true
    hoverPreviewTime.value = null
    setPreviewByRatio(ratioFromPointer(event))
  }
  else {
    clearProgressPreview()
  }
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
  globalThis.removeEventListener('pointercancel', handleProgressPointerUp)
}

function handleProgressPointerEnter(event: PointerEvent): void {
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
}

function handleProgressHoverMove(event: PointerEvent): void {
  if (isScrubbing.value) {
    return
  }
  isProgressHovered.value = true
  setPreviewByRatio(ratioFromPointer(event))
}

const isEditOpen = ref(false)
function openEdit(): void {
  if (!currentTrack.value) {
    return
  }
  isEditOpen.value = true
}
function closeEdit(): void {
  isEditOpen.value = false
}

function toggleLyricsToolbar(): void {
  isLyricsToolbarOpen.value = !isLyricsToolbarOpen.value
}

function handleLyricClick(line: { time: number }): void {
  requestSeek(line.time)
  if (!isPlaying.value) {
    setPlaying(true)
  }
}

function handleLyricShiftInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const nextShift = Number(input.value)
  if (!Number.isFinite(nextShift)) {
    return
  }
  lyricShiftMs.value = Math.max(1, Math.round(Math.abs(nextShift)))
}

async function shiftCurrentLyrics(direction: -1 | 1): Promise<void> {
  const track = currentTrack.value
  const doc = lyricsDoc.value
  if (!track || !doc || isSavingLyrics.value) {
    return
  }
  await saveLyricsDoc(track.id, doc, shiftLyricsDoc(doc, direction * lyricShiftMs.value))
}

function handleVolumeInput(event: Event): void {
  const slider = event.target as HTMLInputElement
  const nextVolume = Number(slider.value) / 100
  if (isVolumeDragging.value) {
    volumePreview.value = nextVolume
    return
  }
  setVolume(nextVolume)
}

function handleVolumePointerDown(): void {
  isVolumeDragging.value = true
}

function handleVolumeCommit(event?: Event): void {
  const slider = event?.target instanceof HTMLInputElement
    ? event.target
    : volumeSlider.value
  if (!slider) {
    return
  }
  setVolume(Number(slider.value) / 100)
  volumePreview.value = null
  isVolumeDragging.value = false
}

function handleNext(): void {
  const nextId = getNextTrackId(tracks.value ?? [])
  if (nextId) {
    const isUpNext = upNextQueue.value[0] === nextId
    selectTrack(nextId, { contextTracks: tracks.value ?? [], consumeUpNext: isUpNext })
    setPlaying(true)
  }
}

function handlePrev(): void {
  const prevId = getPreviousTrackId(tracks.value ?? [])
  if (prevId) {
    selectTrack(prevId, { contextTracks: tracks.value ?? [], history: 'skip' })
    setPlaying(true)
  }
}

function togglePlayPause(): void {
  if (!currentTrackId.value && resolvedCurrentTrackId.value) {
    selectTrack(resolvedCurrentTrackId.value, { contextTracks: tracks.value ?? [] })
  }
  setPlaying(!isPlaying.value)
}

// Word-by-word highlighting: each frame, every timed piece of the active line gets its progress
// as `--p`, written straight to the DOM so Vue doesn't re-render at frame rate.
const readPlaybackTime = usePlaybackClock()
function updateWordProgress(): void {
  const index = currentLineIndex.value
  if (!parsed.value?.[index]?.wordTimed) {
    return
  }
  const line = lyricsContainer.value?.querySelector(`[data-lyric-index="${index}"]`)
  if (!line) {
    return
  }
  const timeMs = readPlaybackTime() * 1000
  for (const element of line.querySelectorAll<HTMLElement>('[data-begin]')) {
    const begin = Number(element.dataset.begin)
    const end = Number(element.dataset.end)
    const progress = end > begin ? Math.min(1, Math.max(0, (timeMs - begin) / (end - begin))) : Number(timeMs >= begin)
    element.style.setProperty('--p', progress.toFixed(3))
  }
}
// Animate only while playing; otherwise progress changes only when the line or lyrics do.
const wordProgressLoop = useRafFn(updateWordProgress, { immediate: false })
watch(isPlaying, playing => playing ? wordProgressLoop.resume() : wordProgressLoop.pause(), { immediate: true })
watch([currentLineIndex, lineLayouts, currentTime], updateWordProgress, { flush: 'post' })

const lyricTick = ref(0)
watch(currentLineIndex, async (idx, prev) => {
  if (idx >= 0 && idx !== prev) {
    lyricTick.value += 1
  }
  if (idx < 0) {
    return
  }
  await nextTick()
  // Wait for the browser to finish layout before measuring positions.
  // Mobile browsers may need an extra frame to settle after DOM updates.
  await new Promise(resolve => requestAnimationFrame(resolve))
  const container = lyricsContainer.value
  // Don't yank the lyrics away while the user is dragging through them.
  if (!container || isLyricsDragScrolling.value) {
    return
  }
  const activeLine = container.querySelector(`[data-lyric-index="${idx}"]`) as HTMLElement | null
  if (!activeLine) {
    return
  }
  // Use getBoundingClientRect for both elements to avoid offsetTop
  // discrepancies in flex layouts on mobile browsers.
  const containerRect = container.getBoundingClientRect()
  const activeRect = activeLine.getBoundingClientRect()
  const lineOffset = activeRect.top - containerRect.top + container.scrollTop
  const targetScroll = lineOffset - containerRect.height / 2 + activeRect.height / 2
  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
})

watch([resolvedCurrentTrackId, isTimeSynced], () => {
  lyricError.value = ''
  isLyricsToolbarOpen.value = false
  isFuriganaEditing.value = false
  editingReading.value = null
})

onUnmounted(() => {
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
  globalThis.removeEventListener('pointercancel', handleProgressPointerUp)
})
</script>

<template>
  <section class="player-page">
    <!-- Animated shader gradient background -->
    <div
      class="bg-shader"
      :class="{ 'bg-shader--paused': !isPlaying }"
    >
      <ShaderGradientCanvas
        v-bind="canvasProps"
        class="shader-canvas"
        pointer-events="none"
      >
        <ShaderGradient v-bind="gradientProps" />
      </ShaderGradientCanvas>
      <div
        v-if="currentTrackCoverUrl"
        class="bg-cover-image"
        :style="{ backgroundImage: `url(${currentTrackCoverUrl})` }"
      />
      <div class="bg-cover-overlay" />
    </div>

    <button
      type="button"
      class="player-back"
      :aria-label="t('common.actions.close')"
      @click="router.back()"
    >
      <span
        class="i-jannchie-chevron-left"
        aria-hidden="true"
      />
    </button>

    <div class="player-layout">
      <div class="player-main">
        <!-- Left: cover only, centered -->
        <div class="player-left">
          <HoloCoverArt
            class="cover-art"
            :alt="title"
            :effect="coverEffect"
            :effect-enabled="coverEffectEnabled"
            :foreground-mask-url="currentTrackForegroundMaskUrl"
            :image-url="currentTrackCoverUrl"
            :playing="isPlaying"
            :thumbhash="currentTrack?.coverThumbhash"
          />
        </div>

        <!-- Right: title + artist + lyrics -->
        <div class="player-right">
          <!-- Track info above lyrics -->
          <div class="track-info">
            <h1 class="track-title text-heading">
              {{ title }}
            </h1>
            <p class="track-artist">
              {{ artist }}
              <template v-if="album">
                · {{ album }}
              </template>
            </p>
            <p
              v-if="trackSpecs || currentTrack?.source"
              class="track-specs"
            >
              <span
                v-if="currentTrack?.source"
                class="track-source"
                :class="getSourceDisplay(currentTrack.source).icon"
                :title="getSourceDisplay(currentTrack.source).label"
                aria-hidden="true"
              />
              <span v-if="trackSpecs">{{ trackSpecs }}</span>
            </p>
          </div>

          <div
            v-if="currentTrack && hasLyrics && isLyricsToolbarOpen && !isGuest"
            class="lyrics-toolbar"
          >
            <div
              v-if="isTimeSynced"
              class="lyrics-offset-control"
              :aria-label="t('player.lyrics.offsetLabel')"
            >
              <button
                type="button"
                class="lyrics-tool-btn lyrics-tool-btn--icon"
                :aria-label="t('player.lyrics.earlier')"
                :title="t('player.lyrics.earlier')"
                :disabled="isSavingLyrics"
                @click="shiftCurrentLyrics(-1)"
              >
                <span
                  class="i-jannchie-minus"
                  aria-hidden="true"
                />
              </button>
              <label class="lyrics-offset-field">
                <span>{{ t('player.lyrics.shiftAmount') }}</span>
                <input
                  :value="lyricShiftMs"
                  type="number"
                  min="1"
                  step="50"
                  inputmode="numeric"
                  :aria-label="t('player.lyrics.offsetLabel')"
                  :disabled="isSavingLyrics"
                  @input="handleLyricShiftInput"
                >
                <span class="lyrics-offset-unit">ms</span>
              </label>
              <button
                type="button"
                class="lyrics-tool-btn lyrics-tool-btn--icon"
                :aria-label="t('player.lyrics.later')"
                :title="t('player.lyrics.later')"
                :disabled="isSavingLyrics"
                @click="shiftCurrentLyrics(1)"
              >
                <span
                  class="i-jannchie-plus"
                  aria-hidden="true"
                />
              </button>
              <span
                v-if="isSavingLyrics"
                class="lyrics-saving"
              >
                <span
                  class="i-jannchie-loading-spinner"
                  aria-hidden="true"
                />
              </span>
            </div>
            <div
              v-if="hasJapanese && isFuriganaEnabled && !isGuest"
              class="lyrics-furigana-control"
            >
              <button
                type="button"
                class="lyrics-tool-btn"
                :class="{ 'lyrics-tool-btn--active': isFuriganaEditing }"
                :aria-pressed="isFuriganaEditing"
                :title="t('player.lyrics.editFuriganaHint')"
                @click="isFuriganaEditing = !isFuriganaEditing"
              >
                <span
                  class="i-jannchie-pen"
                  aria-hidden="true"
                />
                {{ t('player.lyrics.editFurigana') }}
              </button>
            </div>
            <RouterLink
              v-if="currentTrack"
              class="lyrics-tool-btn"
              :to="`/lyrics-editor/${currentTrack.id}`"
            >
              <span
                class="i-jannchie-clock-edit"
                aria-hidden="true"
              />
              {{ t('player.lyrics.timing') }}
            </RouterLink>
            <a
              class="lyrics-tool-btn"
              :href="ttmlExportUrl"
              download
            >
              <span
                class="i-jannchie-download"
                aria-hidden="true"
              />
              {{ t('player.lyrics.exportTtml') }}
            </a>
          </div>

          <p
            v-if="lyricError"
            class="lyrics-error"
            role="alert"
          >
            {{ lyricError }}
          </p>

          <!-- Lyrics with fade edges -->
          <div class="lyrics-wrapper">
            <div
              v-if="isTimeSynced && parsed"
              ref="lyricsContainer"
              class="lyrics-scroll inner-scroll"
              :class="{ 'lyrics-scroll--dragging': isLyricsDragging }"
            >
              <div class="lyrics-pad">
                <div
                  v-for="(line, i) in parsed"
                  :key="i"
                  role="button"
                  tabindex="0"
                  :data-lyric-index="i"
                  class="lyric-line"
                  :class="[
                    { 'lyric-line--word-timed': line.wordTimed },
                    i === currentLineIndex
                      ? 'lyric-line--active'
                      : i < currentLineIndex
                        ? 'lyric-line--past'
                        : 'lyric-line--future',
                  ]"
                  :aria-label="t('player.playFromTime', { time: formattedTime(line.time) })"
                  :aria-current="i === currentLineIndex ? 'true' : undefined"
                  @click="handleLyricClick(line)"
                  @keydown.enter.self.prevent="handleLyricClick(line)"
                  @keydown.space.self.prevent="handleLyricClick(line)"
                >
                  <span
                    class="lyric-text"
                    :lang="lyricLang(line.text)"
                  >
                    <template v-if="!line.text">···</template>
                    <template
                      v-for="chunk in lineLayouts[i]"
                      v-else
                      :key="chunk.index"
                    >
                      <ruby
                        v-if="chunk.segment.ruby || isRubyEditable(chunk.segment)"
                        class="lyric-ruby"
                        :class="{
                          'lyric-ruby--editable': isRubyEditable(chunk.segment),
                          'lyric-ruby--explicit': isFuriganaEditing && chunk.segment.explicit,
                        }"
                        @click="handleRubyClick($event, line.id, chunk.index, chunk.segment)"
                      ><span
                        v-for="(piece, k) in chunk.pieces"
                        :key="k"
                        class="lyric-word"
                        :data-begin="piece.begin"
                        :data-end="piece.end"
                      >{{ piece.text }}</span><rt
                        v-if="chunk.rubyPieces && !isEditingReading(line.id, chunk.index)"
                      ><span
                        v-for="(beat, k) in chunk.rubyPieces"
                        :key="k"
                        class="lyric-word"
                        :data-begin="beat.begin"
                        :data-end="beat.end"
                      >{{ beat.text }}</span></rt><rt
                        v-else
                        class="lyric-word"
                        :data-begin="chunk.begin"
                        :data-end="chunk.end"
                      ><input
                        v-if="isEditingReading(line.id, chunk.index)"
                        v-model="editingReadingValue"
                        class="lyric-ruby-input"
                        :aria-label="t('player.lyrics.readingFor', { text: chunk.segment.text })"
                        @click.stop
                        @keydown.stop
                        @keydown.enter="handleReadingEnter"
                        @keydown.esc.prevent="cancelReadingEdit"
                        @blur="cancelReadingEdit"
                      ><template v-else>{{ chunk.segment.ruby }}</template></rt></ruby>
                      <template v-else><span
                        v-for="(piece, k) in chunk.pieces"
                        :key="k"
                        class="lyric-word"
                        :data-begin="piece.begin"
                        :data-end="piece.end"
                      >{{ piece.text }}</span></template>
                    </template>
                  </span>
                  <span
                    v-if="line.background.length > 0"
                    class="lyric-background"
                    :lang="lyricLang(line.text)"
                  ><span
                    v-for="(word, k) in line.background"
                    :key="k"
                    class="lyric-word"
                    :data-begin="word.begin"
                    :data-end="word.end"
                  >{{ word.text }}</span></span>
                  <span
                    v-for="(translation, j) in line.translations"
                    :key="j"
                    class="lyric-translation"
                  >{{ translation }}</span>
                </div>
              </div>
            </div>

            <div
              v-else-if="hasLyrics"
              ref="lyricsContainer"
              class="lyrics-scroll inner-scroll"
              :class="{ 'lyrics-scroll--dragging': isLyricsDragging }"
            >
              <p class="lyrics-plain">
                {{ plainText }}
              </p>
            </div>

            <div
              v-else
              class="lyrics-empty"
            >
              <span class="i-jannchie-music-off text-3xl text-white/10" />
              <p class="text-sm text-white/25 mt-3">
                {{ t('player.noLyricsAvailable') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="player-bottom">
        <div
          ref="progressTrack"
          class="progress-hit"
          role="slider"
          tabindex="0"
          :aria-label="t('common.actions.seek')"
          :aria-valuemin="0"
          :aria-valuemax="Math.max(1, Math.round(duration))"
          :aria-valuenow="Math.round(displayedCurrentTime)"
          :aria-valuetext="t('player.progressValue', { current: formattedTime(displayedCurrentTime), total: formattedTime(duration) })"
          @pointerenter="handleProgressPointerEnter"
          @pointerdown.prevent="handleProgressPointerDown"
          @pointerleave="clearProgressPreview"
          @pointermove="handleProgressHoverMove"
          @keydown="handleProgressKeydown"
        >
          <ShaderProgressBar
            v-if="progressEffectEnabled"
            :progress="progress / 100"
            :colors="paletteColors"
            :playing="isPlaying"
            :scrubbing="isScrubbing"
            :hovered="isProgressHovered"
            :lyric-tick="lyricTick"
            :filament="filamentConfig"
          />
          <div
            v-else
            class="plain-progress"
            :class="{ 'plain-progress--active': isProgressHovered || isScrubbing }"
          >
            <div class="plain-progress__track" />
            <div
              class="plain-progress__fill"
              :style="{ width: `${progress}%` }"
            />
            <div
              class="plain-progress__thumb"
              :style="{ left: `${progress}%` }"
            />
          </div>
          <ProgressPreviewTooltip
            :lyric="previewTooltipLyric"
            :ratio="previewRatio"
            :time-label="previewTooltipTimeLabel"
            :track-element="progressTrack"
            :visible="previewTooltipVisible"
          />
        </div>
        <div class="progress-time time-code">
          <span>{{ formattedTime(displayedCurrentTime) }}</span>
          <span>{{ formattedTime(duration) }}</span>
        </div>

        <div class="controls-row">
          <div class="controls-side controls-side--left">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--sm"
              :class="{ 'ctrl-btn--active': playMode !== 'sequence' }"
              :aria-label="playModeLabel"
              @click="cyclePlayMode"
            >
              <span
                :class="playModeIcon"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="controls-center">
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              :aria-label="t('common.actions.previousTrack')"
              @click="handlePrev"
            >
              <span
                class="i-jannchie-skip-back"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn-play"
              :aria-label="isPlaying ? t('common.actions.pause') : t('common.actions.play')"
              @click="togglePlayPause"
            >
              <span
                :class="isPlaying ? 'i-jannchie-pause' : 'i-jannchie-play'"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="ctrl-btn ctrl-btn--md"
              :aria-label="t('common.actions.nextTrack')"
              @click="handleNext"
            >
              <span
                class="i-jannchie-skip-forward"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="controls-side controls-side--right">
            <div class="player-actions">
              <button
                v-if="currentTrack && isTimeSynced && hasJapanese"
                type="button"
                class="ctrl-btn ctrl-btn--sm"
                :class="{ 'ctrl-btn--active': isFuriganaEnabled }"
                :aria-label="t('player.lyrics.furigana')"
                :aria-pressed="isFuriganaEnabled"
                :title="t('player.lyrics.furigana')"
                @click="toggleFurigana"
              >
                <span
                  class="i-jannchie-language-hiragana"
                  aria-hidden="true"
                />
              </button>
              <button
                v-if="currentTrack && hasLyrics && !isGuest"
                type="button"
                class="ctrl-btn ctrl-btn--sm"
                :class="{ 'ctrl-btn--active': isLyricsToolbarOpen }"
                :aria-label="isLyricsToolbarOpen ? t('player.lyrics.hideTools') : t('player.lyrics.showTools')"
                :aria-expanded="isLyricsToolbarOpen"
                :title="isLyricsToolbarOpen ? t('player.lyrics.hideTools') : t('player.lyrics.showTools')"
                @click="toggleLyricsToolbar"
              >
                <span
                  class="i-jannchie-sliders"
                  aria-hidden="true"
                />
              </button>
              <button
                v-if="!isGuest"
                type="button"
                class="ctrl-btn ctrl-btn--sm"
                :aria-label="t('common.actions.editMetadata')"
                :disabled="!currentTrack"
                @click="openEdit"
              >
                <span
                  class="i-jannchie-edit"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div class="volume-control">
              <button
                type="button"
                class="ctrl-btn ctrl-btn--sm"
                :aria-label="muted ? t('common.actions.unmute') : t('common.actions.mute')"
                :aria-pressed="muted"
                @click="toggleMute"
              >
                <span
                  :class="volumeIcon"
                  aria-hidden="true"
                />
              </button>
              <input
                ref="volumeSlider"
                class="volume-slider"
                :aria-label="t('common.actions.volume')"
                max="100"
                min="0"
                step="1"
                type="range"
                :value="Math.round(effectiveVolume * 100)"
                :style="volumeSliderStyle"
                @input="handleVolumeInput"
                @change="handleVolumeCommit"
                @pointerdown="handleVolumePointerDown"
                @pointerup="handleVolumeCommit"
              >
            </div>
          </div>
        </div>
      </div>
    </div>
    <MetadataEditDialog
      :open="isEditOpen"
      :track="currentTrack"
      @close="closeEdit"
    />
    <ShaderProgressControls
      v-if="isDev && !isMobile"
      v-model="filamentConfig"
    />
  </section>
</template>

<style scoped>
.player-page {
  --player-safe-top: env(safe-area-inset-top, 0px);
  --player-safe-bottom: env(safe-area-inset-bottom, 0px);

  position: relative;
  height: var(--player-viewport-height, 100svh);
  overflow: hidden;
  box-sizing: border-box;
  overscroll-behavior: none;
}

@media (min-width: 768px) {
  .player-page {
    height: calc(100dvh - 3.5rem);
  }
}

/* ---- Back button ---- */
.player-back {
  position: absolute;
  top: calc(0.75rem + var(--player-safe-top));
  left: 0.75rem;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 1.375rem;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.15s ease;
}

.player-back:hover {
  background: rgba(255, 255, 255, 0.12);
}

@media (min-width: 768px) {
  .player-back {
    display: none;
  }
}

/* ---- Background ---- */
.bg-shader {
  position: fixed;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
  background: #0e0e10;
  animation: bg-shader-fade 700ms ease-out;
  transition: filter 1500ms ease;
}
.bg-shader--paused {
  filter: saturate(0.45) brightness(0.72);
}
.shader-canvas {
  position: absolute !important;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: bg-shader-fade 900ms ease-out 120ms both;
}

@keyframes bg-shader-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.bg-cover-image {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(80px) saturate(1.4) brightness(0.6);
  opacity: 0.18;
  transform: scale(1.3);
  mix-blend-mode: soft-light;
}
.bg-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(14, 14, 16, 0.25) 0%,
    rgba(14, 14, 16, 0.55) 55%,
    rgba(14, 14, 16, 0.85) 100%
  );
}

/* ---- Layout ---- */
.player-layout {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding:
    calc(0.75rem + var(--player-safe-top))
    1rem
    calc(0.75rem + var(--player-safe-bottom));
  overflow: hidden;
  max-width: 80rem;
  margin: 0 auto;
  box-sizing: border-box;
}

@media (min-width: 768px) {
  .player-layout {
    padding:
      calc(2.5rem + var(--player-safe-top))
      3rem
      2.5rem;
  }
}

@media (min-width: 1200px) {
  .player-layout {
    padding:
      calc(2.5rem + var(--player-safe-top))
      4rem
      2.5rem;
  }
}

.player-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

/* ---- Mobile: horizontal compact ---- */
.player-left {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cover-art {
  width: 64px;
  aspect-ratio: 1;
}

@media (min-width: 400px) {
  .cover-art {
    width: 80px;
  }
}

/* ---- Track info (always above lyrics) ---- */
.track-info {
  flex-shrink: 0;
  text-align: center;
}

.track-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-artist {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-specs {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
}

.track-source {
  color: rgba(255, 255, 255, 0.6);
}

.lyrics-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.lyrics-offset-control {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.lyrics-tool-btn,
.lyrics-offset-field {
  min-height: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 0.5rem;
}

.lyrics-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.7rem;
  cursor: pointer;
  font-size: 0.8125rem;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.lyrics-tool-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.lyrics-tool-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.lyrics-tool-btn--icon {
  width: 2rem;
  padding: 0;
}

.lyrics-tool-btn--active {
  border-color: rgba(255, 255, 255, 0.32);
  background: rgba(255, 255, 255, 0.16);
  color: white;
}

.lyrics-furigana-control {
  display: inline-flex;
  gap: 0.35rem;
}

.lyrics-offset-field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.55rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
}

.lyrics-offset-field input {
  width: 4.5rem;
  border: none;
  background: transparent;
  color: white;
  font: inherit;
  text-align: right;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.lyrics-offset-field input:disabled {
  cursor: not-allowed;
}

.lyrics-offset-unit {
  color: rgba(255, 255, 255, 0.4);
}

.lyrics-saving {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  color: rgba(255, 255, 255, 0.6);
}

.lyrics-error {
  flex-shrink: 0;
  text-align: center;
  font-size: 0.75rem;
  color: #fca5a5;
}

/* ---- Right panel ---- */
.player-right {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ---- Desktop: side by side ---- */
@media (min-width: 768px) {
  .player-main {
    flex-direction: row;
    gap: 3.5rem;
    align-items: stretch;
  }

  .player-left {
    width: 40%;
    max-width: 400px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }

  .cover-art {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }

  .player-right {
    flex: 1;
    gap: 0.75rem;
  }

  .track-info {
    text-align: left;
  }
  .track-title {
    font-size: 1.375rem;
  }
  .track-artist {
    font-size: 0.9375rem;
    margin-top: 0.25rem;
  }
  .track-specs {
    font-size: 0.8125rem;
  }
  .lyrics-toolbar {
    justify-content: flex-start;
  }
  .lyrics-error {
    text-align: left;
  }
}

@media (min-width: 1200px) {
  .player-left {
    max-width: 440px;
  }
}

/* ---- Lyrics wrapper with fade edges ---- */
.lyrics-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
  -webkit-mask-image: linear-gradient(to bottom, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to bottom, transparent, black 2.5rem, black calc(100% - 2.5rem), transparent);
}

.lyrics-scroll {
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}
/* Doubled class outranks .lyric-line's pointer cursor. */
.lyrics-scroll.lyrics-scroll--dragging,
.lyrics-scroll.lyrics-scroll--dragging * {
  cursor: grabbing;
  user-select: none;
}
.lyrics-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.lyrics-pad {
  padding: 2.5rem 0 6rem;
}

.lyric-line {
  display: block;
  text-align: left;
  width: 100%;
  padding: 0.3rem 0;
  cursor: pointer;
  transition: all 0.3s ease;
  border: none;
  background: none;
  font-family: inherit;
  font-weight: 300;
  line-height: 1.7;
}
.lyric-line--active {
  color: var(--text-primary);
  font-size: 1.3125rem;
  font-weight: 500;
}
.lyric-line--past {
  color: rgba(255, 255, 255, 0.45);
  font-size: 1.0625rem;
}
.lyric-line--future {
  color: rgba(255, 255, 255, 0.45);
  font-size: 1.0625rem;
}
.lyric-line:hover {
  color: rgba(255, 255, 255, 0.65);
}
.lyric-text,
.lyric-translation,
.lyric-background {
  display: block;
}
.lyric-background {
  font-size: 0.75em;
  line-height: 1.5;
  opacity: 0.8;
}
/* The active word-timed line fills in word by word: a soft edge sweeps across each piece as
   its progress --p goes from 0 to 1. */
.lyric-line--word-timed.lyric-line--active {
  color: rgba(255, 255, 255, 0.45);
}
.lyric-line--word-timed.lyric-line--active .lyric-word[data-begin] {
  background-image: linear-gradient(
    90deg,
    var(--text-primary) calc(var(--p, 0) * (100% + 0.5em) - 0.5em),
    rgba(255, 255, 255, 0.45) calc(var(--p, 0) * (100% + 0.5em))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lyric-translation {
  font-size: 0.8em;
  font-weight: 300;
  line-height: 1.5;
  opacity: 0.7;
}
/* Japanese lines get Japanese glyph forms instead of the SC font's Chinese ones. */
.lyric-text:lang(ja) {
  font-family: 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', var(--font-sans);
}
.lyric-ruby rt {
  font-size: 0.5em;
  font-weight: 400;
  opacity: 0.75;
}
.lyric-ruby--editable {
  cursor: text;
  border-radius: 0.2em;
  transition: background 0.15s ease;
}
.lyric-ruby--editable:hover {
  background: rgba(255, 255, 255, 0.1);
}
/* Readings set by hand stay fully opaque so they read as confirmed. */
.lyric-ruby--explicit rt {
  opacity: 1;
}
.lyric-ruby-input {
  width: 5em;
  padding: 0 0.2em;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 0.25em;
  background: rgba(0, 0, 0, 0.45);
  color: white;
  font: inherit;
  text-align: center;
  outline: none;
}

.lyrics-plain {
  font-size: 1.0625rem;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.4);
  line-height: 2;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2.5rem 0;
}

.lyrics-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* ---- Bottom controls ---- */
.player-bottom {
  flex-shrink: 0;
  padding-top: 0.5rem;
}

.progress-hit {
  padding: 0.375rem 0;
  cursor: pointer;
}

.plain-progress {
  position: relative;
  height: 6px;
  width: 100%;
  transition: height 180ms ease;
}
.plain-progress--active {
  height: 10px;
}
.plain-progress__track {
  position: absolute;
  inset: 50% 0 auto 0;
  height: 2px;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  transition: height 180ms ease;
}
.plain-progress--active .plain-progress__track {
  height: 3px;
}
.plain-progress__fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 2px;
  transform: translateY(-50%);
  background: var(--accent, #fff);
  border-radius: 999px;
  transition: height 180ms ease;
}
.plain-progress--active .plain-progress__fill {
  height: 3px;
}
.plain-progress__thumb {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: var(--accent, #fff);
  transform: translateY(-50%) scale(0);
  transition: transform 180ms ease;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.35);
}
.plain-progress--active .plain-progress__thumb {
  transform: translateY(-50%) scale(1);
}

.progress-time {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 0.125rem;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.375rem;
}

/* Both sides are equal-width columns so the transport stays centered. */
.controls-side {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1 1 0;
  min-width: 0;
}

.controls-side--right {
  justify-content: flex-end;
}

/* Mobile lifts the lyric/edit actions to the top-right corner, opposite the
   back button, and drops the volume control (hardware volume covers it), so
   the right column is only a spacer. */
.player-actions {
  position: absolute;
  top: calc(0.75rem + var(--player-safe-top));
  right: 0.75rem;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.player-actions .ctrl-btn {
  min-width: 2.25rem;
  color: rgba(255, 255, 255, 0.7);
}

.volume-control {
  display: none;
  align-items: center;
  gap: 0.25rem;
}

.controls-center {
  display: flex;
  align-items: center;
  gap: 1rem;
}

@media (min-width: 768px) {
  .controls-row {
    justify-content: space-between;
  }
  .player-actions {
    position: static;
  }
  .player-actions .ctrl-btn {
    min-width: 2.5rem;
    color: rgba(255, 255, 255, 0.45);
  }
  .volume-control {
    display: flex;
  }
  .controls-center {
    gap: 1.25rem;
  }
}

.ctrl-btn {
  background: none;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.45);
  transition: color 0.15s ease, background 0.15s ease, transform 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  min-height: 2.5rem;
  padding: 0.25rem;
}
.ctrl-btn:hover { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.06); }
.ctrl-btn:active:not(:disabled) { transform: scale(0.94); }
.ctrl-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ctrl-btn:disabled:hover { background: none; }
.ctrl-btn--sm { font-size: 1.125rem; }
.ctrl-btn--md { font-size: 1.5rem; color: rgba(255, 255, 255, 0.65); }
.ctrl-btn--md:hover {  color: var(--text-primary); }
.ctrl-btn--active { color: var(--accent) !important; }

.ctrl-btn-play {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  color: var(--bg-base);
  transition: transform 0.1s ease;
}
.ctrl-btn-play:hover { transform: scale(1.04); }
.ctrl-btn-play:active { transform: scale(0.95); }

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  transition: background 0.15s ease;
}
.volume-slider::-webkit-slider-thumb:hover { background: white; }
.volume-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
}
.volume-slider::-moz-range-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}
</style>
