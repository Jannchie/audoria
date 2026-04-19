<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import PlaylistCover from '../components/PlaylistCover.vue'
import SoundWave from '../components/SoundWave.vue'
import { useContextMenu } from '../composables/useContextMenu'
import { useListSelection } from '../composables/useListSelection'
import { resolveApiUrl } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { sortTracks } from '../composables/useTrackSort'
import type { TrackSortKey } from '../composables/useTrackSort'
import { formatTrackDuration } from '../utils/audio'
import {
  useDeletePlaylist,
  usePlaylistDetailQuery,
  useReorderPlaylistTracks,
  useUpdatePlaylist,
} from '../composables/usePlaylists'
import { useTrackContextMenu } from '../composables/useTrackContextMenu'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const playlistId = computed(() => {
  const value = route.params.id
  return typeof value === 'string' ? value : null
})

const playlistQuery = usePlaylistDetailQuery(playlistId)
const updatePlaylistMutation = useUpdatePlaylist()
const deletePlaylistMutation = useDeletePlaylist()
const reorderMutation = useReorderPlaylistTracks()
const {
  currentTrackId,
  isPlaying,
  playMode,
  playbackContext,
  cyclePlayMode,
  selectTrack,
  setPlaying,
  syncTrackContext,
} = usePlayerState()
const { buildItems } = useTrackContextMenu()
const { openFromEvent, openFromAnchor } = useContextMenu()

const name = ref('')
const description = ref('')
const formError = ref('')
const isEditing = ref(false)
const dragTrackId = ref<string | null>(null)
const dragOverTrackId = ref<string | null>(null)
const pendingOrder = ref<string[] | null>(null)
const sortKey = ref<TrackSortKey>('manual')
const playlistSortKeys: TrackSortKey[] = ['manual', 'addedDesc', 'nameAsc', 'nameDesc', 'artistAsc', 'durationDesc', 'durationAsc']

const playlist = computed(() => playlistQuery.data.value ?? null)
const baseTracks = computed(() => {
  const base = playlist.value?.tracks ?? []
  const override = pendingOrder.value
  if (!override) {
    return base
  }
  const map = new Map(base.map(track => [track.id, track]))
  const ordered = override.map(id => map.get(id)).filter(Boolean) as typeof base
  const remaining = base.filter(track => !override.includes(track.id))
  return [...ordered, ...remaining]
})

const tracks = computed(() => sortTracks(baseTracks.value, sortKey.value))
const isManualOrder = computed(() => sortKey.value === 'manual')

function trackCoverUrl(track: { coverUrl: string | null, coverThumbUrl: string | null }): string {
  const url = track.coverThumbUrl ?? track.coverUrl
  return url ? resolveApiUrl(url) : ''
}

const selection = useListSelection(() => tracks.value.map(track => track.id))

watch(tracks, (list) => {
  selection.prune(new Set(list.map(track => track.id)))
})
const isCurrentPlaylistContext = computed(() =>
  playbackContext.value?.type === 'playlist'
  && playbackContext.value.playlistId === playlistId.value,
)

watch(playlist, (value) => {
  name.value = value?.name ?? ''
  description.value = value?.description ?? ''
}, { immediate: true })

watch(playlist, (value) => {
  if (!value || !playlistId.value || !isCurrentPlaylistContext.value) {
    return
  }
  syncTrackContext(value.tracks, { type: 'playlist', playlistId: playlistId.value })
}, { immediate: true })

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${remainingMinutes}m`
}

function isTrackActive(trackId: string): boolean {
  return currentTrackId.value === trackId && isCurrentPlaylistContext.value
}

function playTrack(trackId: string, event?: MouseEvent): void {
  if (!playlist.value || !playlistId.value) {
    return
  }
  if (event) {
    const { handled } = selection.handleClick(trackId, event)
    if (handled) {
      return
    }
  }
  selection.clear()

  if (isTrackActive(trackId)) {
    setPlaying(!isPlaying.value)
    return
  }

  selectTrack(trackId, {
    contextTracks: playlist.value.tracks,
    context: { type: 'playlist', playlistId: playlistId.value },
  })
  setPlaying(true)
}

function playAll(): void {
  const firstTrackId = tracks.value[0]?.id
  if (!firstTrackId || !playlistId.value) {
    return
  }

  selectTrack(firstTrackId, {
    contextTracks: tracks.value,
    context: { type: 'playlist', playlistId: playlistId.value },
  })
  setPlaying(true)
}

function shuffleAll(): void {
  const ids = tracks.value.map(track => track.id)
  if (ids.length === 0 || !playlistId.value) {
    return
  }
  for (let safety = 0; safety < 8; safety += 1) {
    const mode: string = playMode.value
    if (mode === 'shuffle') {
      break
    }
    cyclePlayMode()
  }
  const startId = ids[Math.floor(Math.random() * ids.length)]
  selectTrack(startId, {
    contextTracks: tracks.value,
    context: { type: 'playlist', playlistId: playlistId.value },
  })
  setPlaying(true)
}

async function savePlaylist(): Promise<void> {
  if (!playlistId.value) {
    return
  }

  const trimmedName = name.value.trim()
  if (!trimmedName) {
    formError.value = 'Playlist name is required.'
    return
  }

  formError.value = ''

  try {
    const updated = await updatePlaylistMutation.mutateAsync({
      id: playlistId.value,
      name: trimmedName,
      description: description.value.trim() || null,
    })
    if (isCurrentPlaylistContext.value) {
      syncTrackContext(updated.tracks, { type: 'playlist', playlistId: updated.id })
    }
    isEditing.value = false
  }
  catch (error_) {
    formError.value = error_ instanceof Error ? error_.message : 'Failed to update playlist.'
  }
}

function cancelEdit(): void {
  name.value = playlist.value?.name ?? ''
  description.value = playlist.value?.description ?? ''
  formError.value = ''
  isEditing.value = false
}

function openHeaderMenu(event: MouseEvent): void {
  event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement | null
  if (!anchor) {
    return
  }
  openFromAnchor(anchor, [
    {
      id: 'edit',
      label: t('common.actions.editMetadata'),
      icon: 'i-tabler-edit',
      onSelect: () => {
        isEditing.value = true
      },
    },
    {
      id: 'add-tracks',
      label: t('playlist.addTracks'),
      icon: 'i-tabler-playlist-add',
      onSelect: () => goToLibrary(),
    },
    { id: 'div', label: '', divider: true },
    {
      id: 'delete',
      label: t('playlist.deletePlaylist'),
      icon: 'i-tabler-trash',
      danger: true,
      onSelect: () => handleDeletePlaylist(),
    },
  ])
}

async function reorderTracks(trackIds: string[]): Promise<void> {
  if (!playlistId.value) {
    return
  }

  const updated = await reorderMutation.mutateAsync({
    playlistId: playlistId.value,
    trackIds,
  })

  if (isCurrentPlaylistContext.value) {
    syncTrackContext(updated.tracks, { type: 'playlist', playlistId: updated.id })
  }
}

async function handleDeletePlaylist(): Promise<void> {
  if (!playlistId.value) {
    return
  }

  await deletePlaylistMutation.mutateAsync(playlistId.value)

  if (isCurrentPlaylistContext.value) {
    selectTrack(null, {
      contextTracks: [],
      context: { type: 'library' },
      history: 'skip',
    })
  }

  router.push('/playlists')
}

function goToLibrary(): void {
  router.push('/library')
}

function menuItemsForTrack(trackId: string) {
  const byId = new Map(tracks.value.map(track => [track.id, track]))
  const selectedIds = selection.toArray()
  const useBatch = selectedIds.length > 1 && selectedIds.includes(trackId)
  const targetTracks = useBatch
    ? selectedIds.map(id => byId.get(id)).filter(Boolean) as typeof tracks.value
    : [byId.get(trackId)].filter(Boolean) as typeof tracks.value
  if (targetTracks.length === 0) {
    return []
  }
  return buildItems({
    tracks: targetTracks,
    playlistContext: playlistId.value ? { playlistId: playlistId.value } : undefined,
  })
}

function handleTrackContextMenu(trackId: string, event: MouseEvent): void {
  event.preventDefault()
  if (!selection.isSelected(trackId) && selection.hasSelection.value) {
    selection.selectOne(trackId)
  }
  openFromEvent(event, menuItemsForTrack(trackId))
}

function openTrackMoreMenu(trackId: string, event: MouseEvent): void {
  event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement | null
  if (anchor) {
    openFromAnchor(anchor, menuItemsForTrack(trackId))
  }
}

function openSelectionMenu(event: MouseEvent): void {
  event.stopPropagation()
  const ids = selection.toArray()
  if (ids.length === 0) {
    return
  }
  const byId = new Map(tracks.value.map(track => [track.id, track]))
  const targetTracks = ids.map(id => byId.get(id)).filter(Boolean) as typeof tracks.value
  const items = buildItems({
    tracks: targetTracks,
    playlistContext: playlistId.value ? { playlistId: playlistId.value } : undefined,
  })
  const anchor = event.currentTarget as HTMLElement | null
  if (anchor) {
    openFromAnchor(anchor, items)
  }
}

function openSortMenu(event: MouseEvent): void {
  event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement | null
  if (!anchor) {
    return
  }
  openFromAnchor(anchor, playlistSortKeys.map(key => ({
    id: `sort:${key}`,
    label: t(`playlist.trackSort.${key}`),
    icon: sortKey.value === key ? 'i-tabler-check' : 'i-tabler-point',
    onSelect: () => {
      sortKey.value = key
    },
  })))
}

function handleDragStart(trackId: string, event: DragEvent): void {
  if (!isManualOrder.value) {
    event.preventDefault()
    return
  }
  if (!event.dataTransfer) {
    return
  }
  dragTrackId.value = trackId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', trackId)
}

function handleDragOver(targetTrackId: string, event: DragEvent): void {
  if (!dragTrackId.value || dragTrackId.value === targetTrackId) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverTrackId.value = targetTrackId
}

async function handleDrop(targetTrackId: string, event: DragEvent): Promise<void> {
  event.preventDefault()
  const sourceId = dragTrackId.value
  dragTrackId.value = null
  dragOverTrackId.value = null
  if (!sourceId || sourceId === targetTrackId) {
    return
  }
  const ids = tracks.value.map(track => track.id)
  const fromIndex = ids.indexOf(sourceId)
  const toIndex = ids.indexOf(targetTrackId)
  if (fromIndex === -1 || toIndex === -1) {
    return
  }
  const nextOrder = [...ids]
  const [moved] = nextOrder.splice(fromIndex, 1)
  nextOrder.splice(toIndex, 0, moved)
  pendingOrder.value = nextOrder
  try {
    await reorderTracks(nextOrder)
  }
  finally {
    pendingOrder.value = null
  }
}

function handleDragEnd(): void {
  dragTrackId.value = null
  dragOverTrackId.value = null
}
</script>

<template>
  <section class="playlist-detail-page">
    <div
      v-if="playlistQuery.isError.value"
      class="playlist-detail-empty"
    >
      {{ (playlistQuery.error.value as Error)?.message ?? 'Failed to load playlist.' }}
    </div>

    <template v-else-if="playlist">
      <header class="playlist-hero">
        <PlaylistCover
          :urls="playlist.previewCoverUrls"
          size="lg"
        />
        <div class="playlist-hero-body">
          <p class="playlist-hero-kicker">
            {{ t('nav.playlists') }}
          </p>
          <template v-if="isEditing">
            <input
              v-model="name"
              class="playlist-hero-name-input"
              type="text"
              maxlength="120"
              :disabled="updatePlaylistMutation.isPending.value"
            >
            <textarea
              v-model="description"
              class="playlist-hero-description-input"
              rows="2"
              maxlength="2000"
              :placeholder="t('metadata.placeholders.title')"
              :disabled="updatePlaylistMutation.isPending.value"
            />
          </template>
          <template v-else>
            <h1 class="playlist-hero-name">
              {{ playlist.name }}
            </h1>
            <p
              v-if="playlist.description"
              class="playlist-hero-description"
            >
              {{ playlist.description }}
            </p>
          </template>
          <div class="playlist-hero-stats">
            <span>{{ t('playlist.trackCount', { n: playlist.trackCount }) }}</span>
            <span>·</span>
            <span>{{ formatDuration(playlist.totalDurationSeconds) }}</span>
          </div>

          <div class="playlist-hero-actions">
            <template v-if="isEditing">
              <button
                type="button"
                class="playlist-hero-btn playlist-hero-btn--primary"
                :disabled="updatePlaylistMutation.isPending.value"
                @click="savePlaylist"
              >
                <span class="i-tabler-check" />
                <span>{{ t('common.actions.save') }}</span>
              </button>
              <button
                type="button"
                class="playlist-hero-btn"
                @click="cancelEdit"
              >
                <span>{{ t('common.actions.cancel') }}</span>
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="playlist-hero-btn playlist-hero-btn--primary"
                :disabled="tracks.length === 0"
                @click="playAll"
              >
                <span class="i-tabler-player-play-filled" />
                <span>{{ t('playlist.playAll') }}</span>
              </button>
              <button
                type="button"
                class="playlist-hero-btn"
                :disabled="tracks.length === 0"
                @click="shuffleAll"
              >
                <span class="i-tabler-arrows-shuffle" />
                <span>{{ t('playlist.shuffle') }}</span>
              </button>
              <button
                type="button"
                class="playlist-hero-btn playlist-hero-btn--icon"
                :aria-label="t('common.actions.moreOptions')"
                @click="openHeaderMenu($event)"
              >
                <span class="i-tabler-dots" />
              </button>
            </template>
          </div>
          <p
            v-if="formError"
            class="playlist-detail-error"
          >
            {{ formError }}
          </p>
        </div>
      </header>

      <div
        v-if="selection.hasSelection.value"
        class="playlist-selection-toolbar"
      >
        <span class="playlist-selection-count">
          {{ t('library.selectedCount', { n: selection.size.value }) }}
        </span>
        <button
          type="button"
          class="playlist-selection-action"
          @click="openSelectionMenu($event)"
        >
          <span
            class="i-tabler-dots"
            aria-hidden="true"
          />
          <span>{{ t('common.actions.moreOptions') }}</span>
        </button>
        <button
          type="button"
          class="playlist-selection-action"
          @click="selection.clear"
        >
          <span
            class="i-tabler-x"
            aria-hidden="true"
          />
          <span>{{ t('common.actions.cancel') }}</span>
        </button>
      </div>

      <div
        v-if="tracks.length > 0"
        class="playlist-tracks-toolbar"
      >
        <button
          type="button"
          class="sort-button"
          :aria-label="t('library.sort.label')"
          @click="openSortMenu($event)"
        >
          <span
            class="i-tabler-arrows-sort"
            aria-hidden="true"
          />
          <span class="sort-button-text">{{ t(`playlist.trackSort.${sortKey}`) }}</span>
        </button>
      </div>

      <div
        v-if="tracks.length === 0"
        class="playlist-detail-empty"
      >
        {{ t('playlist.empty') }}
      </div>
      <div
        v-else
        class="track-list"
      >
        <div
          v-for="(track, index) in tracks"
          :key="track.id"
          class="tr tr--pl"
          :class="{
            'tr--dragging': dragTrackId === track.id,
            'tr--drag-over': dragOverTrackId === track.id && dragTrackId !== track.id,
            'tr--selected': selection.isSelected(track.id),
            'tr--active': isTrackActive(track.id),
          }"
          :draggable="isManualOrder"
          @click="playTrack(track.id, $event)"
          @contextmenu="handleTrackContextMenu(track.id, $event)"
          @dragstart="handleDragStart(track.id, $event)"
          @dragover="handleDragOver(track.id, $event)"
          @drop="handleDrop(track.id, $event)"
          @dragend="handleDragEnd"
        >
          <span class="tr-lead">
            <span
              v-if="isManualOrder"
              class="tr-handle i-tabler-grip-vertical"
              aria-hidden="true"
            />
            <span
              v-else
              class="tr-index"
              aria-hidden="true"
            >{{ index + 1 }}</span>
          </span>

          <div class="tr-cover">
            <img
              v-if="track.coverUrl"
              :src="trackCoverUrl(track)"
              :alt="track.title || track.filename"
              width="44"
              height="44"
              loading="lazy"
              decoding="async"
            >
            <span
              v-else
              class="i-tabler-music tr-cover-placeholder"
              aria-hidden="true"
            />
            <span
              class="tr-cover-overlay"
              aria-hidden="true"
            >
              <SoundWave
                v-if="isTrackActive(track.id)"
                :playing="isPlaying"
              />
              <span
                v-else
                class="i-tabler-player-play-filled tr-cover-play"
              />
            </span>
          </div>

          <div class="tr-primary">
            <p class="tr-title">
              {{ track.title || track.filename }}
            </p>
            <p class="tr-artist">
              <span>{{ track.artists || track.filename }}</span>
            </p>
          </div>

          <div class="tr-secondary">
            <span
              v-if="track.album"
              class="tr-album"
            >{{ track.album }}</span>
          </div>

          <span class="tr-duration">{{ formatTrackDuration(track.durationSeconds) }}</span>

          <button
            type="button"
            class="tr-action"
            :aria-label="t('common.actions.moreOptions')"
            @click.stop="openTrackMoreMenu(track.id, $event)"
          >
            <span
              class="i-tabler-dots"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </template>

    <div
      v-else-if="playlistQuery.isPending.value"
      class="playlist-detail-empty"
    >
      Loading playlist...
    </div>
  </section>
</template>

<style scoped>
.playlist-detail-page {
  display: grid;
  gap: 1rem;
  padding: 1rem 0;
}

.playlist-hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1rem;
  background: linear-gradient(180deg, var(--bg-surface), transparent);
}

@media (min-width: 720px) {
  .playlist-hero {
    flex-direction: row;
    align-items: flex-end;
    gap: 1.5rem;
  }
}

.playlist-hero-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}

.playlist-hero-kicker {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.playlist-hero-name {
  margin: 0;
  font-size: clamp(1.5rem, 4vw, 2.5rem);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
  letter-spacing: -0.01em;
  font-family: var(--font-display, inherit);
}

.playlist-hero-name-input {
  margin: 0;
  padding: 0.25rem 0.5rem;
  font-size: clamp(1.5rem, 4vw, 2.5rem);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  width: 100%;
}

.playlist-hero-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.playlist-hero-description-input {
  margin: 0;
  padding: 0.5rem 0.625rem;
  font-size: 0.875rem;
  color: var(--text-primary);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  resize: vertical;
  width: 100%;
}

.playlist-hero-stats {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 0.25rem;
}

.playlist-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.playlist-hero-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0 1.125rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
}

.playlist-hero-btn:hover:not(:disabled) {
  background: var(--bg-surface);
}

.playlist-hero-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.playlist-hero-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.playlist-hero-btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: white;
  font-weight: 600;
}

.playlist-hero-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 90%, white);
}

.playlist-hero-btn--icon {
  padding: 0;
  width: 2.5rem;
  min-height: 2.5rem;
  font-size: 1rem;
}

.playlist-detail-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger);
}

.playlist-detail-empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--border);
  border-radius: 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 0.25rem;
}

.playlist-tracks-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.25rem;
  padding: 0 0.875rem;
  border: none;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
}

.sort-button:hover {
  background: var(--bg-elevated, var(--bg-surface));
  color: var(--text-primary);
}

.sort-button-text {
  display: none;
}

@media (min-width: 640px) {
  .sort-button-text {
    display: inline;
  }
}

/* ===========================================================
 * Shared track row — "Editorial Quiet" design system.
 * Playlist variant adds a leading index/handle column.
 * =========================================================== */

.tr {
  display: grid;
  grid-template-columns: 22px 44px minmax(0, 1fr) 40px 28px;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 56px;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: 10px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  position: relative;
  transition: background 120ms ease, opacity 120ms ease;
}

.tr-secondary {
  display: none;
}

@media (min-width: 768px) {
  .tr {
    grid-template-columns: 22px 40px minmax(0, 1.1fr) minmax(0, 1fr) 44px 28px;
    height: 52px;
    padding: 0 12px;
  }
  .tr-secondary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    line-height: 1.3;
    overflow: hidden;
  }
}

.tr:hover {
  background: var(--bg-surface);
}

.tr--active {
  box-shadow: inset 3px 0 0 var(--accent);
}
.tr--active:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-surface));
}
.tr--active .tr-title {
  color: var(--accent);
}
.tr--active .tr-cover-overlay {
  opacity: 1;
  background: color-mix(in srgb, var(--accent) 40%, rgba(0, 0, 0, 0.55));
}

.tr--selected {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 36%, transparent);
}
.tr--active.tr--selected {
  box-shadow:
    inset 3px 0 0 var(--accent),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 36%, transparent);
}

.tr--dragging {
  opacity: 0.4;
}
.tr--drag-over {
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* --- Lead column: handle or index --- */
.tr-lead {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.tr-handle {
  font-size: 1rem;
  opacity: 0.4;
  cursor: grab;
  transition: opacity 120ms ease;
}
.tr:hover .tr-handle {
  opacity: 0.9;
}
.tr-handle:active {
  cursor: grabbing;
}

.tr-index {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  transition: opacity 120ms ease;
}
.tr:hover .tr-index {
  opacity: 0;
}
.tr--active .tr-index {
  color: var(--accent);
}

/* --- Cover --- */
.tr-cover {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg-elevated);
  display: grid;
  place-items: center;
}

@media (min-width: 768px) {
  .tr-cover {
    width: 40px;
    height: 40px;
  }
}

.tr-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tr-cover-placeholder {
  font-size: 1.125rem;
  color: var(--text-tertiary);
}

.tr-cover-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
  pointer-events: none;
}

.tr:hover .tr-cover-overlay {
  opacity: 1;
}

.tr-cover-play {
  font-size: 1rem;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

/* --- Primary (title + artist) --- */
.tr-primary {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tr-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: -0.005em;
  line-height: 1.3;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tr-artist {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tr-artist > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- Secondary (album) --- */
.tr-album {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Duration --- */
.tr-duration {
  justify-self: end;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.tr--active .tr-duration {
  color: var(--accent);
  opacity: 0.85;
}

/* --- Action --- */
.tr-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.tr:hover .tr-action,
.tr:focus-within .tr-action,
.tr--active .tr-action,
.tr--selected .tr-action {
  opacity: 1;
}

.tr-action:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

@media (hover: none) {
  .tr-action { opacity: 1 }
  .tr-cover-overlay { opacity: 0 }
  .tr-index { opacity: 1 !important }
}

.playlist-selection-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  margin: 0.25rem 0;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
  font-size: 0.8125rem;
}

.playlist-selection-count {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.playlist-selection-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border: none;
  border-radius: 999px;
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.75rem;
}

.playlist-selection-action:hover {
  background: var(--bg-elevated);
}
</style>
