<script setup lang="ts">
import type { Music } from '../api/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiUrl, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { useQueuePanel } from '../composables/useQueuePanel'
import { formatTrackDuration } from '../utils/audio'
import LazyCoverImage from './LazyCoverImage.vue'
import SoundWave from './SoundWave.vue'

const { t } = useI18n()
const { close, isOpen } = useQueuePanel()
const { data: tracks } = useMusicQuery()
const {
  clearQueue,
  currentTrackId,
  isPlaying,
  moveInQueue,
  playbackContext,
  removeFromQueueAt,
  selectTrack,
  setPlaying,
  upNextQueue,
} = usePlayerState()

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const trackMap = computed(() => {
  const map = new Map<string, Music>()
  for (const track of tracks.value ?? []) {
    map.set(track.id, track)
  }
  return map
})

const currentTrack = computed(() => {
  if (!currentTrackId.value) {
    return null
  }
  return trackMap.value.get(currentTrackId.value) ?? null
})

const upNextTracks = computed(() => {
  return upNextQueue.value
    .map((id, index) => ({ id, index, track: trackMap.value.get(id) ?? null }))
})

const contextRemainingTracks = computed<Music[]>(() => {
  const context = playbackContext.value
  if (!context) {
    return []
  }
  const ids = context.trackIds
  const start = currentTrackId.value ? ids.indexOf(currentTrackId.value) : -1
  const slice = start === -1 && currentTrackId.value
    ? []
    : ids.slice(start === -1 ? 0 : start + 1)
  const result: Music[] = []
  for (const id of slice) {
    const track = trackMap.value.get(id)
    if (track) {
      result.push(track)
    }
  }
  return result
})

const contextLabel = computed(() => {
  const context = playbackContext.value
  if (!context) {
    return t('player.queue.title')
  }
  if (context.type === 'playlist') {
    return t('player.queue.nextFromPlaylist')
  }
  return t('player.queue.nextFromLibrary')
})

function coverUrl(track: Music | null): string {
  if (!track) {
    return ''
  }
  const url = track.coverThumbUrl ?? track.coverUrl
  return url ? resolveApiUrl(url) : ''
}

function playContextTrack(trackId: string): void {
  if (currentTrackId.value === trackId) {
    setPlaying(!isPlaying.value)
    return
  }
  selectTrack(trackId)
  setPlaying(true)
}

function playUpNextAt(index: number): void {
  const queue = upNextQueue.value
  if (index < 0 || index >= queue.length) {
    return
  }
  const trackId = queue[index]
  // Remove the items preceding this one (including itself — will be consumed).
  for (let i = 0; i < index; i++) {
    removeFromQueueAt(0)
  }
  selectTrack(trackId, { consumeUpNext: true })
  setPlaying(true)
}

function handleDragStart(index: number, event: DragEvent): void {
  if (!event.dataTransfer) {
    return
  }
  dragIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function handleDragOver(index: number, event: DragEvent): void {
  if (dragIndex.value === null) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverIndex.value = index
}

function handleDrop(index: number, event: DragEvent): void {
  event.preventDefault()
  const from = dragIndex.value
  if (from === null || from === index) {
    dragIndex.value = null
    dragOverIndex.value = null
    return
  }
  moveInQueue(from, index)
  dragIndex.value = null
  dragOverIndex.value = null
}

function handleDragEnd(): void {
  dragIndex.value = null
  dragOverIndex.value = null
}

watch(isOpen, (open) => {
  if (!open) {
    dragIndex.value = null
    dragOverIndex.value = null
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="queue-drawer-fade">
      <div
        v-if="isOpen"
        class="queue-backdrop"
        @click.self="close"
      >
        <aside
          class="queue-drawer"
          role="dialog"
          aria-label="Playback queue"
          @click.stop
        >
          <header class="queue-header">
            <h2 class="queue-title">
              {{ t('player.queue.title') }}
            </h2>
            <button
              type="button"
              class="queue-close"
              :aria-label="t('common.actions.close')"
              @click="close"
            >
              <span
                class="i-tabler-x"
                aria-hidden="true"
              />
            </button>
          </header>

          <div class="queue-body">
            <!-- Now playing -->
            <section class="queue-section">
              <h3 class="queue-section-title">
                {{ t('player.queue.nowPlaying') }}
              </h3>
              <div
                v-if="currentTrack"
                class="queue-row queue-row--active"
              >
                <div class="queue-cover">
                  <LazyCoverImage
                    v-if="coverUrl(currentTrack)"
                    :src="coverUrl(currentTrack)"
                    :alt="currentTrack.title ?? currentTrack.filename"
                    :thumbhash="currentTrack.coverThumbhash"
                  />
                  <span
                    v-else
                    class="i-tabler-music queue-cover-placeholder"
                    aria-hidden="true"
                  />
                </div>
                <div class="queue-meta">
                  <p class="queue-track-title queue-track-title--active">
                    {{ currentTrack.title || currentTrack.filename }}
                  </p>
                  <p class="queue-track-sub">
                    {{ currentTrack.artists || '—' }}
                  </p>
                </div>
                <SoundWave :playing="isPlaying" />
              </div>
              <p
                v-else
                class="queue-empty"
              >
                {{ t('player.queue.nothingPlaying') }}
              </p>
            </section>

            <!-- Up next (user-queued) -->
            <section
              v-if="upNextTracks.length > 0"
              class="queue-section"
            >
              <div class="queue-section-head">
                <h3 class="queue-section-title">
                  {{ t('player.queue.upNext') }}
                </h3>
                <button
                  type="button"
                  class="queue-section-action"
                  @click="clearQueue"
                >
                  {{ t('player.queue.clear') }}
                </button>
              </div>
              <ul class="queue-list">
                <li
                  v-for="item in upNextTracks"
                  :key="`up-${item.index}-${item.id}`"
                  class="queue-row queue-row--draggable"
                  :class="{
                    'queue-row--dragging': dragIndex === item.index,
                    'queue-row--drag-over': dragOverIndex === item.index && dragIndex !== item.index,
                  }"
                  draggable="true"
                  @dragstart="handleDragStart(item.index, $event)"
                  @dragover="handleDragOver(item.index, $event)"
                  @drop="handleDrop(item.index, $event)"
                  @dragend="handleDragEnd"
                >
                  <span
                    class="queue-drag-handle i-tabler-grip-vertical"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    class="queue-play-trigger"
                    @click="playUpNextAt(item.index)"
                  >
                    <div class="queue-cover">
                      <LazyCoverImage
                        v-if="coverUrl(item.track)"
                        :src="coverUrl(item.track)"
                        :alt="item.track?.title ?? item.track?.filename ?? ''"
                        :thumbhash="item.track?.coverThumbhash"
                      />
                      <span
                        v-else
                        class="i-tabler-music queue-cover-placeholder"
                        aria-hidden="true"
                      />
                    </div>
                    <div class="queue-meta">
                      <p class="queue-track-title">
                        {{ item.track ? (item.track.title || item.track.filename) : 'Unknown track' }}
                      </p>
                      <p class="queue-track-sub">
                        {{ item.track?.artists || '—' }}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    class="queue-remove"
                    :aria-label="t('common.actions.removeFromQueue')"
                    @click="removeFromQueueAt(item.index)"
                  >
                    <span
                      class="i-tabler-x"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              </ul>
            </section>

            <!-- Remaining context -->
            <section
              v-if="contextRemainingTracks.length > 0"
              class="queue-section"
            >
              <h3 class="queue-section-title">
                {{ contextLabel }}
              </h3>
              <ul class="queue-list">
                <li
                  v-for="track in contextRemainingTracks"
                  :key="`ctx-${track.id}`"
                  class="queue-row"
                >
                  <button
                    type="button"
                    class="queue-play-trigger"
                    @click="playContextTrack(track.id)"
                  >
                    <div class="queue-cover">
                      <LazyCoverImage
                        v-if="coverUrl(track)"
                        :src="coverUrl(track)"
                        :alt="track.title ?? track.filename"
                        :thumbhash="track.coverThumbhash"
                      />
                      <span
                        v-else
                        class="i-tabler-music queue-cover-placeholder"
                        aria-hidden="true"
                      />
                    </div>
                    <div class="queue-meta">
                      <p class="queue-track-title">
                        {{ track.title || track.filename }}
                      </p>
                      <p class="queue-track-sub">
                        {{ track.artists || '—' }}
                      </p>
                    </div>
                    <span
                      v-if="track.durationSeconds"
                      class="queue-duration"
                    >{{ formatTrackDuration(track.durationSeconds) }}</span>
                  </button>
                </li>
              </ul>
            </section>

            <p
              v-if="!currentTrack && upNextTracks.length === 0 && contextRemainingTracks.length === 0"
              class="queue-empty"
            >
              {{ t('player.queue.empty') }}
            </p>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.queue-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  justify-content: flex-end;
  background: rgba(8, 10, 16, 0.36);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.queue-drawer {
  display: flex;
  flex-direction: column;
  width: min(100%, 26rem);
  max-width: 100vw;
  height: 100%;
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  box-shadow: -18px 0 48px rgba(0, 0, 0, 0.26);
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.queue-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.queue-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-tertiary);
}

.queue-close:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.queue-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.5rem 2rem;
}

.queue-section {
  padding: 0.5rem 0.25rem 0.75rem;
}

.queue-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem 0.25rem;
}

.queue-section-title {
  margin: 0;
  padding: 0.25rem 0.5rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.queue-section-head .queue-section-title {
  padding: 0;
}

.queue-section-action {
  padding: 0.25rem 0.5rem;
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  border-radius: 0.375rem;
}

.queue-section-action:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.queue-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.625rem;
  transition: background 0.12s ease;
}

.queue-row:hover {
  background: var(--bg-surface);
}

.queue-row--active {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.queue-row--dragging {
  opacity: 0.4;
}

.queue-row--drag-over {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.queue-drag-handle {
  flex-shrink: 0;
  font-size: 1rem;
  color: var(--text-tertiary);
  cursor: grab;
}

.queue-drag-handle:active {
  cursor: grabbing;
}

.queue-play-trigger {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
}

.queue-cover {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  background: var(--bg-elevated, var(--bg-surface));
  overflow: hidden;
}

.queue-cover-placeholder {
  font-size: 1rem;
  color: var(--text-tertiary);
}

.queue-meta {
  flex: 1;
  min-width: 0;
}

.queue-track-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-track-title--active {
  color: var(--accent);
}

.queue-track-sub {
  margin: 0.125rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-duration {
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  tabular-nums: 1;
}

.queue-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: none;
  color: var(--text-tertiary);
  border-radius: 999px;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.queue-row:hover .queue-remove {
  opacity: 1;
}

.queue-remove:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.queue-empty {
  margin: 0;
  padding: 1rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
}

.queue-drawer-fade-enter-active,
.queue-drawer-fade-leave-active {
  transition: opacity 0.18s ease;
}

.queue-drawer-fade-enter-active .queue-drawer,
.queue-drawer-fade-leave-active .queue-drawer {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.queue-drawer-fade-enter-from,
.queue-drawer-fade-leave-to {
  opacity: 0;
}

.queue-drawer-fade-enter-from .queue-drawer,
.queue-drawer-fade-leave-to .queue-drawer {
  transform: translateX(100%);
}
</style>
