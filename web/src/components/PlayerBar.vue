<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { findLyricLineAtTime, useLyrics } from '../composables/useLyrics'
import { buildDownloadUrl, resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { useQueuePanel } from '../composables/useQueuePanel'
import IconButton from './IconButton.vue'
import ProgressPreviewTooltip from './ProgressPreviewTooltip.vue'
import SourceBadge from './SourceBadge.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const audioRef = ref<HTMLAudioElement | null>(null)
const progressTrack = ref<HTMLDivElement | null>(null)
const volumeSlider = ref<HTMLInputElement | null>(null)
const isScrubbing = ref(false)
const isVolumeDragging = ref(false)
const isProgressHovered = ref(false)
const previewRatio = ref<number | null>(null)
const hoverPreviewTime = ref<number | null>(null)
const scrubPreviewTime = ref<number | null>(null)
const volumePreview = ref<number | null>(null)
const pendingResumeTime = ref<number | null>(null)
const { data: tracks, isPending: isTracksPending } = useMusicQuery()
const {
  consumeUpNextHead,
  currentTrackId,
  isPlaying,
  playMode,
  currentTime,
  duration,
  volume,
  muted,
  selectTrack,
  setPlaying,
  cyclePlayMode,
  updateProgress,
  setVolume,
  toggleMute,
  getAutoAdvanceTrackId,
  getNextTrackId,
  getPreviousTrackId,
  playbackContext,
  pruneQueue,
  getResumeTime,
  syncTrackContext,
  upNextQueue,
} = usePlayerState()
const { toggle: toggleQueuePanel, isOpen: isQueueOpen } = useQueuePanel()

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

const audioSrc = computed(() => {
  if (!currentTrack.value) {
    return ''
  }
  return buildDownloadUrl(currentTrack.value.id)
})

const currentTrackCoverUrl = computed(() => {
  const coverUrl = currentTrack.value?.coverThumbUrl ?? currentTrack.value?.coverUrl
  if (!coverUrl) {
    return ''
  }
  return resolveApiUrl(coverUrl)
})
const isPlayerPage = computed(() => route.path === '/player')
const { parsed } = useLyrics(() => currentTrack.value?.lyrics)

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
    return 'i-tabler-list'
  }
  if (playMode.value === 'repeat-all') {
    return 'i-tabler-repeat'
  }
  if (playMode.value === 'repeat-one') {
    return 'i-tabler-repeat-once'
  }
  return 'i-tabler-arrows-shuffle'
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
    return 'i-tabler-volume-off'
  }
  if (volume.value < 0.5) {
    return 'i-tabler-volume-2'
  }
  return 'i-tabler-volume'
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
const displayedVolume = computed(() => {
  if (volumePreview.value !== null) {
    return volumePreview.value
  }
  return muted.value ? 0 : volume.value
})
const actualAudioVolume = computed(() => muted.value ? 0 : volume.value)
const volumeSliderStyle = computed(() => {
  const percent = Math.round(displayedVolume.value * 100)
  return {
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percent}%, var(--bg-surface) ${percent}%, var(--bg-surface) 100%)`,
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

// Switching tracks rapidly causes audio.play() to reject with an AbortError
// while the previous load is still in flight. That's expected — handleLoaded
// will retry once the new src is ready. Only real failures (autoplay blocked,
// codec not supported, etc.) should flip isPlaying back to false.
function handlePlayRejection(error: unknown): void {
  const name = error && typeof error === 'object' && 'name' in error
    ? (error as { name?: string }).name
    : null
  if (name === 'AbortError') {
    return
  }
  setPlaying(false)
}

function handleTimeUpdate(): void {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  if (pendingResumeTime.value !== null && audio.currentTime < Math.max(0, pendingResumeTime.value - 0.5)) {
    return
  }
  pendingResumeTime.value = null
  updateProgress(audio.currentTime, audio.duration || duration.value)
}

function handleLoaded(): void {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  const resumeTime = getResumeTime(audio.duration || 0, pendingResumeTime.value ?? currentTime.value)
  if (resumeTime > 0) {
    audio.currentTime = resumeTime
    updateProgress(resumeTime, audio.duration || 0)
    pendingResumeTime.value = null
    if (isPlaying.value) {
      audio.play().catch(handlePlayRejection)
    }
    return
  }
  pendingResumeTime.value = null
  updateProgress(audio.currentTime, audio.duration || 0)
  if (isPlaying.value) {
    audio.play().catch(handlePlayRejection)
  }
}

function handleNext(): void {
  const nextId = getNextTrackId(tracks.value ?? [])
  if (nextId) {
    const isUpNext = upNextQueue.value[0] === nextId
    selectTrack(nextId, { contextTracks: tracks.value ?? [], consumeUpNext: isUpNext })
    if (isUpNext) {
      consumeUpNextHead(nextId)
    }
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
  const audio = audioRef.value
  if (!audio) {
    return
  }
  if (audio.paused) {
    if (!currentTrackId.value && resolvedCurrentTrackId.value) {
      selectTrack(resolvedCurrentTrackId.value, { contextTracks: tracks.value ?? [] })
    }
    audio.play().then(() => setPlaying(true)).catch(handlePlayRejection)
  }
  else {
    audio.pause()
    setPlaying(false)
  }
}

function ratioFromPointer(event: PointerEvent | MouseEvent): number {
  const track = progressTrack.value
  if (!track) {
    return 0
  }
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) {
    return 0
  }
  const clientX = 'clientX' in event ? event.clientX : 0
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function setPreviewByRatio(ratio: number): void {
  const total = duration.value || audioRef.value?.duration || 0
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
  const audio = audioRef.value
  if (!audio) {
    return
  }
  const total = audio.duration || duration.value || 0
  if (!total) {
    return
  }
  const clamped = Math.min(1, Math.max(0, ratio))
  const newTime = clamped * total
  audio.currentTime = newTime
  updateProgress(newTime, total)
  scrubPreviewTime.value = null
}

function handleProgressKeydown(event: KeyboardEvent): void {
  const audio = audioRef.value
  const total = audio?.duration || duration.value || 0
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

function handleEnded(): void {
  const nextId = getAutoAdvanceTrackId(tracks.value ?? [])
  const audio = audioRef.value
  if (!nextId) {
    setPlaying(false)
    return
  }
  if (nextId === resolvedCurrentTrackId.value && audio) {
    audio.currentTime = 0
    audio.play().catch(handlePlayRejection)
    return
  }
  const isUpNext = upNextQueue.value[0] === nextId
  selectTrack(nextId, { contextTracks: tracks.value ?? [], consumeUpNext: isUpNext })
  if (isUpNext) {
    consumeUpNextHead(nextId)
  }
  setPlaying(true)
}

function goToPlayer(): void {
  router.push('/player')
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

// Sync volume to audio element
watch(actualAudioVolume, (v) => {
  const audio = audioRef.value
  if (audio) {
    audio.volume = v
  }
}, { immediate: true })

watch(audioSrc, (src) => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  pendingResumeTime.value = src ? currentTime.value : null
  audio.autoplay = isPlaying.value
  audio.src = src
  audio.load()
  if (!src) {
    audio.pause()
    setPlaying(false)
  }
})

watch(isPlaying, (playing) => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  audio.autoplay = playing
  if (playing) {
    audio.play().catch(handlePlayRejection)
  }
  else {
    audio.pause()
  }
})

watch([tracks, isTracksPending], ([items, pending]) => {
  if (pending) {
    return
  }
  syncTrackContext(items ?? [])
  pruneQueue(new Set((items ?? []).map(item => item.id)))
}, { immediate: true })

onUnmounted(() => {
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
  globalThis.removeEventListener('pointercancel', handleProgressPointerUp)
})
</script>

<template>
  <footer
    v-show="!isPlayerPage"
    class="playerbar"
  >
    <!-- Progress bar -->
    <div
      ref="progressTrack"
      class="py-2 w-full cursor-pointer relative"
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
      <div class="bg-[var(--bg-surface)] h-0.5 w-full relative">
        <div
          class="bg-[var(--accent)] h-full transition-none inset-y-0 left-0 absolute"
          :style="{ width: `${progress}%` }"
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

    <div class="playerbar-content">
      <!-- Track info -->
      <button
        type="button"
        class="playerbar-track text-left flex flex-1 gap-3 min-w-0 transition-colors items-center"
        :aria-label="currentTrack ? t('player.openPlayerTrack', { title: currentTrack.title ?? currentTrack.filename }) : t('player.openPlayer')"
        @click="goToPlayer"
      >
        <div class="rounded-lg bg-[var(--bg-elevated)] flex shrink-0 h-11 w-11 items-center justify-center overflow-hidden">
          <img
            v-if="currentTrackCoverUrl"
            :src="currentTrackCoverUrl"
            :alt="currentTrack?.filename ?? t('player.trackCover')"
            class="h-full w-full object-cover"
            width="48"
            height="48"
            decoding="async"
          >
          <span
            v-else
            class="i-tabler-music text-[var(--text-tertiary)]"
          />
        </div>
        <div class="min-w-0">
          <p class="text-[13px] leading-tight font-medium text-heading truncate">
            {{ currentTrack?.title || currentTrack?.filename || t('player.noTrackSelected') }}
          </p>
          <p class="text-[11px] text-[var(--text-tertiary)] mt-0.5 flex gap-1 truncate items-center">
            <SourceBadge
              v-if="currentTrack?.source"
              :source="currentTrack.source"
              size="xs"
              :show-label="false"
            />
            <span
              v-if="currentTrack?.artists"
              class="truncate"
            >{{ currentTrack.artists }} ·</span>
            <span class="shrink-0 tabular-nums">{{ formattedTime(displayedCurrentTime) }} / {{ formattedTime(duration) }}</span>
          </p>
        </div>
      </button>

      <!-- Controls -->
      <div class="playerbar-controls flex gap-0.5 items-center">
        <IconButton
          :aria-label="t('common.actions.previousTrack')"
          icon="i-tabler-player-skip-back-filled"
          size="sm"
          @click="handlePrev"
        />
        <IconButton
          :disabled="!audioSrc"
          :aria-label="isPlaying ? t('common.actions.pause') : t('common.actions.play')"
          :icon="isPlaying ? 'i-tabler-player-pause-filled' : 'i-tabler-player-play-filled'"
          tone="primary"
          size="lg"
          @click="togglePlayPause"
        />
        <IconButton
          :aria-label="t('common.actions.nextTrack')"
          icon="i-tabler-player-skip-forward-filled"
          size="sm"
          @click="handleNext"
        />
        <IconButton
          :active="playMode !== 'sequence'"
          :aria-label="playModeLabel"
          :icon="playModeIcon"
          size="sm"
          class="hidden lg:flex"
          @click="cyclePlayMode"
        />
      </div>

      <!-- Volume (desktop only) -->
      <div class="playerbar-volume gap-1 hidden items-center lg:flex">
        <IconButton
          :active="isQueueOpen"
          :aria-label="t('player.toggleQueue')"
          icon="i-tabler-playlist"
          size="sm"
          @click="toggleQueuePanel"
        />
        <IconButton
          :aria-label="muted ? t('common.actions.unmute') : t('common.actions.mute')"
          :icon="volumeIcon"
          size="sm"
          @click="toggleMute"
        />
        <input
          ref="volumeSlider"
          class="volume-slider"
          :aria-label="t('common.actions.volume')"
          max="100"
          min="0"
          step="1"
          type="range"
          :value="Math.round(displayedVolume * 100)"
          :style="volumeSliderStyle"
          @input="handleVolumeInput"
          @change="handleVolumeCommit"
          @pointerdown="handleVolumePointerDown"
          @pointerup="handleVolumeCommit"
        >
      </div>
    </div>
  </footer>
  <audio
    ref="audioRef"
    class="hidden"
    :autoplay="isPlaying"
    preload="auto"
    :src="audioSrc"
    @ended="handleEnded"
    @loadedmetadata="handleLoaded"
    @timeupdate="handleTimeUpdate"
  />
</template>

<style scoped>
.playerbar {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 40;
  background: var(--bg-primary);
  border-top: 1px solid var(--border);
  /* mobile: sit above the tab bar (~3.25rem) */
  bottom: 3.25rem;
}

@media (min-width: 768px) {
  .playerbar {
    bottom: 0;
  }
}

.playerbar-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 auto;
  padding: 0.5rem 1rem;
}

.playerbar-track {
  min-width: 0;
}

@media (min-width: 768px) {
  .playerbar-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  .playerbar-controls {
    justify-self: center;
  }

  .playerbar-volume {
    justify-self: end;
  }
}

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 90px;
  height: 3px;
  background: var(--bg-surface);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  transition: background 0.15s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  background: white;
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
}

.volume-slider::-moz-range-track {
  height: 3px;
  background: var(--bg-surface);
  border-radius: 2px;
}
</style>
