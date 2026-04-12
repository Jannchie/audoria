<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { buildDownloadUrl, resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import IconButton from './IconButton.vue'

const router = useRouter()
const audioRef = ref<HTMLAudioElement | null>(null)
const progressTrack = ref<HTMLDivElement | null>(null)
const isScrubbing = ref(false)
let shouldResumeAfterScrub = false
const { data: tracks } = useMusicQuery()
const {
  currentTrackId,
  isPlaying,
  shuffle,
  repeatMode,
  currentTime,
  duration,
  volume,
  muted,
  selectTrack,
  setPlaying,
  toggleShuffle,
  cycleRepeat,
  updateProgress,
  setVolume,
  toggleMute,
} = usePlayerState()

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) return null
  return items.find(item => item.id === currentTrackId.value) ?? items[0]
})

const audioSrc = computed(() => {
  if (!currentTrack.value) return ''
  return buildDownloadUrl(currentTrack.value.id)
})

const currentTrackCoverUrl = computed(() => {
  if (!currentTrack.value?.coverUrl) return ''
  return resolveApiUrl(currentTrack.value.coverUrl)
})

const progress = computed(() => {
  if (!duration.value) return 0
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

const repeatIcon = computed(() => {
  if (repeatMode.value === 'one') return 'i-tabler-repeat-once'
  if (repeatMode.value === 'off') return 'i-tabler-repeat-off'
  return 'i-tabler-repeat'
})

const volumeIcon = computed(() => {
  if (muted.value || volume.value === 0) return 'i-tabler-volume-off'
  if (volume.value < 0.5) return 'i-tabler-volume-2'
  return 'i-tabler-volume'
})

const effectiveVolume = computed(() => muted.value ? 0 : volume.value)

function formattedTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function handleTimeUpdate(): void {
  const audio = audioRef.value
  if (!audio) return
  updateProgress(audio.currentTime, audio.duration || duration.value)
}

function handleLoaded(): void {
  const audio = audioRef.value
  if (!audio) return
  updateProgress(audio.currentTime, audio.duration || 0)
  if (isPlaying.value) {
    audio.play().catch(() => setPlaying(false))
  }
}

function pickNextId(direction: 'next' | 'prev'): string | null {
  const items = tracks.value ?? []
  if (items.length === 0) return null
  if (shuffle.value) {
    const others = items.filter(item => item.id !== currentTrackId.value)
    const pool = others.length > 0 ? others : items
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? null
  }
  const index = items.findIndex(item => item.id === currentTrackId.value)
  if (index === -1) return items[0]?.id ?? null
  if (direction === 'next') {
    const next = items[index + 1]
    if (next) return next.id
    return repeatMode.value === 'all' ? items[0]?.id ?? null : null
  }
  const prev = items[index - 1]
  if (prev) return prev.id
  return repeatMode.value === 'all' ? items.at(-1)?.id ?? null : null
}

function handleNext(): void {
  if (repeatMode.value === 'one') {
    const audio = audioRef.value
    if (audio) {
      audio.currentTime = 0
      audio.play().catch(() => setPlaying(false))
    }
    return
  }
  const nextId = pickNextId('next')
  if (nextId) { selectTrack(nextId); setPlaying(true) }
  else { setPlaying(false) }
}

function handlePrev(): void {
  const prevId = pickNextId('prev')
  if (prevId) { selectTrack(prevId); setPlaying(true) }
}

function togglePlayPause(): void {
  const audio = audioRef.value
  if (!audio) return
  if (audio.paused) {
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
}

function handleSeek(event: Event): void {
  const slider = event.target as HTMLInputElement
  const audio = audioRef.value
  if (!audio) return
  const total = audio.duration || duration.value || 0
  if (!total) return
  const value = Number(slider.value)
  const newTime = Math.min(total, Math.max(0, (value / 100) * total))
  audio.currentTime = newTime
  updateProgress(newTime, total)
}

function ratioFromPointer(event: PointerEvent | MouseEvent): number {
  const track = progressTrack.value
  if (!track) return 0
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) return 0
  const clientX = 'clientX' in event ? event.clientX : 0
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function seekByRatio(ratio: number, shouldResume: boolean): void {
  const audio = audioRef.value
  if (!audio) return
  const total = audio.duration || duration.value || 0
  if (!total) return
  const clamped = Math.min(1, Math.max(0, ratio))
  const newTime = clamped * total
  audio.currentTime = newTime
  updateProgress(newTime, total)
  if (shouldResume) {
    audio.play().catch(() => setPlaying(false))
  }
}

function handleProgressPointerDown(event: PointerEvent): void {
  shouldResumeAfterScrub = isPlaying.value
  isScrubbing.value = true
  seekByRatio(ratioFromPointer(event), shouldResumeAfterScrub)
  globalThis.addEventListener('pointermove', handleProgressPointerMove)
  globalThis.addEventListener('pointerup', handleProgressPointerUp)
}

function handleProgressPointerMove(event: PointerEvent): void {
  if (!isScrubbing.value) return
  seekByRatio(ratioFromPointer(event), false)
}

function handleProgressPointerUp(event: PointerEvent): void {
  if (!isScrubbing.value) return
  seekByRatio(ratioFromPointer(event), shouldResumeAfterScrub)
  isScrubbing.value = false
  globalThis.removeEventListener('pointermove', handleProgressPointerMove)
  globalThis.removeEventListener('pointerup', handleProgressPointerUp)
}

function handleEnded(): void {
  handleNext()
}

function goToPlayer(): void {
  router.push('/player')
}

function handleVolumeInput(event: Event): void {
  const slider = event.target as HTMLInputElement
  setVolume(Number(slider.value) / 100)
}

// Sync volume to audio element
watch(effectiveVolume, (v) => {
  const audio = audioRef.value
  if (audio) audio.volume = v
}, { immediate: true })

watch(audioSrc, (src) => {
  const audio = audioRef.value
  if (!audio) return
  audio.src = src
  if (src && isPlaying.value) {
    audio.play().catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
})

watch(isPlaying, (playing) => {
  const audio = audioRef.value
  if (!audio) return
  if (playing) {
    audio.play().catch(() => setPlaying(false))
  }
  else {
    audio.pause()
  }
})

onMounted(() => {
  const audio = audioRef.value
  if (!audio) return
  audio.volume = effectiveVolume.value
  audio.addEventListener('timeupdate', handleTimeUpdate)
  audio.addEventListener('loadedmetadata', handleLoaded)
  audio.addEventListener('ended', handleEnded)
})

onUnmounted(() => {
  const audio = audioRef.value
  if (!audio) return
  audio.removeEventListener('timeupdate', handleTimeUpdate)
  audio.removeEventListener('loadedmetadata', handleLoaded)
  audio.removeEventListener('ended', handleEnded)
})
</script>

<template>
  <footer class="playerbar">
    <!-- Progress bar -->
    <div
      ref="progressTrack"
      class="py-2 w-full cursor-pointer relative"
      @pointerdown.prevent="handleProgressPointerDown"
    >
      <div class="bg-[var(--bg-surface)] h-0.5 w-full relative">
        <div
          class="bg-[var(--accent)] h-full transition-none inset-y-0 left-0 absolute"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <div class="mx-auto px-4 py-2 flex gap-3 items-center sm:px-5">
      <!-- Track info -->
      <button
        type="button"
        class="text-left flex flex-1 gap-3 min-w-0 transition-colors items-center"
        @click="goToPlayer"
      >
        <div class="rounded-lg bg-[var(--bg-elevated)] flex shrink-0 h-11 w-11 items-center justify-center overflow-hidden">
          <img
            v-if="currentTrackCoverUrl"
            :src="currentTrackCoverUrl"
            :alt="currentTrack?.filename ?? 'Track cover'"
            class="h-full w-full object-cover"
          >
          <span
            v-else
            class="i-tabler-music text-[var(--text-tertiary)]"
          />
        </div>
        <div class="min-w-0">
          <p class="text-[13px] leading-tight font-medium text-heading truncate">
            {{ currentTrack?.title || currentTrack?.filename || 'Select a track' }}
          </p>
          <p class="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">
            <span v-if="currentTrack?.artists">{{ currentTrack.artists }}</span>
            <span
              v-if="currentTrack?.artists"
              class="mx-1"
            >·</span>
            <span class="tabular-nums">{{ formattedTime(currentTime) }} / {{ formattedTime(duration) }}</span>
          </p>
        </div>
      </button>

      <!-- Controls -->
      <div class="flex gap-0.5 items-center">
        <IconButton
          :active="shuffle"
          aria-label="Shuffle"
          icon="i-tabler-arrows-shuffle"
          size="sm"
          class="hidden lg:flex"
          @click="toggleShuffle"
        />
        <IconButton
          aria-label="Previous"
          icon="i-tabler-player-skip-back-filled"
          size="sm"
          @click="handlePrev"
        />
        <IconButton
          :disabled="!audioSrc"
          aria-label="Play or pause"
          :icon="isPlaying ? 'i-tabler-player-pause-filled' : 'i-tabler-player-play-filled'"
          tone="primary"
          size="lg"
          @click="togglePlayPause"
        />
        <IconButton
          aria-label="Next"
          icon="i-tabler-player-skip-forward-filled"
          size="sm"
          @click="handleNext"
        />
        <IconButton
          :active="repeatMode !== 'off'"
          aria-label="Repeat mode"
          :icon="repeatIcon"
          size="sm"
          class="hidden lg:flex"
          @click="cycleRepeat"
        />
      </div>

      <!-- Volume (desktop only) -->
      <div class="hidden gap-1 items-center lg:flex">
        <IconButton
          aria-label="Toggle mute"
          :icon="volumeIcon"
          size="sm"
          @click="toggleMute"
        />
        <input
          class="volume-slider"
          max="100"
          min="0"
          step="1"
          type="range"
          :value="muted ? 0 : Math.round(volume * 100)"
          @input="handleVolumeInput"
        >
      </div>
    </div>

    <input
      class="opacity-0 h-px w-px pointer-events-none absolute"
      max="100"
      min="0"
      step="0.1"
      type="range"
      :value="progress"
      @input="handleSeek"
    >
    <audio
      ref="audioRef"
      class="hidden"
      :src="audioSrc"
    />
  </footer>
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
  background: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  background: var(--text-primary);
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-secondary);
  border: none;
  cursor: pointer;
}

.volume-slider::-moz-range-track {
  height: 3px;
  background: var(--bg-surface);
  border-radius: 2px;
}
</style>
