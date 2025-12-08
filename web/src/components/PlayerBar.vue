<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildDownloadUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import IconButton from './IconButton.vue'

const audioRef = ref<HTMLAudioElement | null>(null)
const progressTrack = ref<HTMLDivElement | null>(null)
const { data: tracks } = useMusicQuery()
const {
  currentTrackId,
  isPlaying,
  shuffle,
  repeatMode,
  currentTime,
  duration,
  selectTrack,
  setPlaying,
  toggleShuffle,
  cycleRepeat,
  updateProgress,
} = usePlayerState()

const currentTrack = computed(() => {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  return items.find(item => item.id === currentTrackId.value) ?? items[0]
})

const audioSrc = computed(() => {
  if (!currentTrack.value) {
    return ''
  }
  return buildDownloadUrl(currentTrack.value.id)
})

const progress = computed(() => {
  if (!duration.value) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

const repeatIcon = computed(() => {
  if (repeatMode.value === 'one') {
    return 'i-tabler-repeat-once'
  }
  if (repeatMode.value === 'off') {
    return 'i-tabler-repeat-off'
  }
  return 'i-tabler-repeat'
})

function formattedTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function handleTimeUpdate(): void {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  updateProgress(audio.currentTime, audio.duration || duration.value)
}

function handleLoaded(): void {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  updateProgress(audio.currentTime, audio.duration || 0)
  if (isPlaying.value) {
    audio
      .play()
      .catch(() => {
        setPlaying(false)
      })
  }
}

function pickNextId(direction: 'next' | 'prev'): string | null {
  const items = tracks.value ?? []
  if (items.length === 0) {
    return null
  }
  if (shuffle.value) {
    const others = items.filter(item => item.id !== currentTrackId.value)
    const pool = others.length > 0 ? others : items
    const randomIndex = Math.floor(Math.random() * pool.length)
    return pool[randomIndex]?.id ?? null
  }
  const index = items.findIndex(item => item.id === currentTrackId.value)
  if (index === -1) {
    return items[0]?.id ?? null
  }
  if (direction === 'next') {
    const next = items[index + 1]
    if (next) {
      return next.id
    }
    return repeatMode.value === 'all' ? items[0]?.id ?? null : null
  }
  const prev = items[index - 1]
  if (prev) {
    return prev.id
  }
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
  if (nextId) {
    selectTrack(nextId)
    setPlaying(true)
  }
  else {
    setPlaying(false)
  }
}

function handlePrev(): void {
  const prevId = pickNextId('prev')
  if (prevId) {
    selectTrack(prevId)
    setPlaying(true)
  }
}

function togglePlayPause(): void {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  if (audio.paused) {
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
}

function handleSeek(event: Event): void {
  const slider = event.target as HTMLInputElement
  const audio = audioRef.value
  if (!audio) {
    return
  }
  const total = audio.duration || duration.value || 0
  if (!total) {
    return
  }
  const value = Number(slider.value)
  const newTime = Math.min(total, Math.max(0, (value / 100) * total))
  audio.currentTime = newTime
  updateProgress(newTime, total)
}

function ratioFromClientX(clientX: number): number {
  const track = progressTrack.value
  if (!track) {
    return 0
  }
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function seekByRatio(ratio: number, shouldResume: boolean): void {
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
  if (shouldResume) {
    audio.play().catch(() => setPlaying(false))
  }
}

function handleProgressClick(event: MouseEvent): void {
  const ratio = ratioFromClientX(event.clientX)
  seekByRatio(ratio, isPlaying.value)
}

function handleProgressDrag(event: PointerEvent): void {
  const track = progressTrack.value
  const shouldResume = isPlaying.value
  const startRatio = ratioFromClientX(event.clientX)
  if (track) {
    track.setPointerCapture(event.pointerId)
  }
  seekByRatio(startRatio, shouldResume)
  const handleMove = (moveEvent: PointerEvent) => {
    const nextRatio = ratioFromClientX(moveEvent.clientX)
    seekByRatio(nextRatio, false)
  }
  const handleUp = (upEvent: PointerEvent) => {
    const endRatio = ratioFromClientX(upEvent.clientX)
    seekByRatio(endRatio, shouldResume)
    globalThis.removeEventListener('pointermove', handleMove)
    globalThis.removeEventListener('pointerup', handleUp)
    if (track) {
      track.releasePointerCapture(event.pointerId)
    }
  }
  globalThis.addEventListener('pointermove', handleMove)
  globalThis.addEventListener('pointerup', handleUp)
}

function handleEnded(): void {
  handleNext()
}

watch(audioSrc, (src) => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  audio.src = src
  if (src && isPlaying.value) {
    audio
      .play()
      .then(() => {
        // keep playing
      })
      .catch(() => setPlaying(false))
  }
  else {
    audio.pause()
    setPlaying(false)
  }
})

watch(isPlaying, (playing) => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  if (playing) {
    audio
      .play()
      .catch(() => setPlaying(false))
  }
  else {
    audio.pause()
  }
})

onMounted(() => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  audio.addEventListener('timeupdate', handleTimeUpdate)
  audio.addEventListener('loadedmetadata', handleLoaded)
  audio.addEventListener('ended', handleEnded)
})

onUnmounted(() => {
  const audio = audioRef.value
  if (!audio) {
    return
  }
  audio.removeEventListener('timeupdate', handleTimeUpdate)
  audio.removeEventListener('loadedmetadata', handleLoaded)
  audio.removeEventListener('ended', handleEnded)
})
</script>

<template>
  <footer class="border-t border-slate-800 bg-[#0b0f17]/95 bottom-0 left-0 right-0 fixed z-20 backdrop-blur">
    <div class="mx-auto px-8 py-4 flex gap-6 max-w-6xl items-center">
      <div class="flex flex-1 gap-4 min-w-0 items-center">
        <div class="text-sm text-white font-semibold rounded-lg bg-slate-800 flex h-12 w-12 items-center justify-center">
          {{ currentTrack?.filename.charAt(0).toUpperCase() ?? 'A' }}
        </div>
        <div class="min-w-0 w-full">
          <p class="text-sm text-white font-semibold truncate">
            {{ currentTrack?.filename ?? 'Select a track to start' }}
          </p>
          <div class="text-xs text-slate-400 mt-2 flex gap-3 items-center">
            <span class="text-right w-10">{{ formattedTime(currentTime) }}</span>
            <div
              ref="progressTrack"
              class="rounded-full bg-slate-800 flex-1 h-2 cursor-pointer relative overflow-hidden"
              @click="handleProgressClick"
              @pointerdown.prevent="handleProgressDrag"
            >
              <div
                class="rounded-full bg-blue-500 inset-y-0 left-0 absolute"
                :style="{ width: `${progress}%` }"
              />
              <div
                class="rounded-full bg-white h-3 w-3 shadow top-1/2 absolute -translate-y-1/2"
                :style="{ left: `calc(${progress}% - 6px)` }"
              />
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
            <span class="w-10">{{ formattedTime(duration) }}</span>
          </div>
        </div>
      </div>

      <div class="flex gap-2 items-center">
        <IconButton
          :active="shuffle"
          aria-label="Shuffle"
          icon="i-tabler-arrows-shuffle"
          @click="toggleShuffle"
        />
        <IconButton
          aria-label="Previous"
          class="text-white rounded-full bg-slate-800 hover:bg-slate-700"
          icon="i-tabler-player-skip-back"
          @click="handlePrev"
        />
        <IconButton
          :disabled="!audioSrc"
          aria-label="Play or pause"
          class="px-4 py-3 rounded-full"
          :icon="isPlaying ? 'i-tabler-player-pause-filled' : 'i-tabler-player-play-filled'"
          tone="primary"
          @click="togglePlayPause"
        />
        <IconButton
          aria-label="Next"
          class="text-white rounded-full bg-slate-800 hover:bg-slate-700"
          icon="i-tabler-player-skip-forward"
          @click="handleNext"
        />
        <IconButton
          :active="repeatMode !== 'off'"
          aria-label="Repeat mode"
          :icon="repeatIcon"
          @click="cycleRepeat"
        />
      </div>
    </div>
    <audio ref="audioRef" class="hidden" :src="audioSrc" />
  </footer>
</template>
