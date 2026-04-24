<script setup lang="ts">
import type { Music } from '../api/types.gen'
import type { TrackSortKey } from '../composables/useTrackSort'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MetadataEditDialog from '../components/MetadataEditDialog.vue'
import SoundWave from '../components/SoundWave.vue'
import { useContextMenu } from '../composables/useContextMenu'
import { useListSelection } from '../composables/useListSelection'
import { resolveApiUrl, useDeleteMusic, useMusicQuery } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'
import { usePlaylistsQuery } from '../composables/usePlaylists'
import { useTrackContextMenu } from '../composables/useTrackContextMenu'
import { sortTracks } from '../composables/useTrackSort'
import { formatTrackDuration } from '../utils/audio'
import { getSourceDisplay } from '../utils/source'

const librarySearchStateKey = 'audoria.library-search'
const librarySortStateKey = 'audoria.library-sort'
const skeletonTitleWidths = [72, 56, 80, 48, 68, 60, 76, 52]
const skeletonMetaWidths = [38, 30, 44, 26, 40, 34, 48, 32]

const { t } = useI18n()
const { data: tracks, isPending, isError, error } = useMusicQuery()
const { data: playlists } = usePlaylistsQuery()
const deleteMutation = useDeleteMusic()
const { currentTrackId, isPlaying, selectTrack, setPlaying } = usePlayerState()
const { buildItems } = useTrackContextMenu()
const { openFromEvent, openFromAnchor } = useContextMenu()

const librarySortKeys: TrackSortKey[] = ['addedDesc', 'nameAsc', 'nameDesc', 'artistAsc', 'durationDesc', 'durationAsc']
function isLibrarySortKey(value: string): value is TrackSortKey {
  return (librarySortKeys as string[]).includes(value)
}

const search = ref(globalThis.sessionStorage.getItem(librarySearchStateKey) ?? '')
const initialSort = globalThis.sessionStorage.getItem(librarySortStateKey) ?? ''
const sortKey = ref<TrackSortKey>(isLibrarySortKey(initialSort) ? initialSort : 'addedDesc')

watch(search, (value) => {
  globalThis.sessionStorage.setItem(librarySearchStateKey, value)
})

watch(sortKey, (value) => {
  globalThis.sessionStorage.setItem(librarySortStateKey, value)
})

const playlistNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const playlist of playlists.value ?? []) {
    map.set(playlist.id, playlist.name)
  }
  return map
})

function playlistBadgesFor(track: Music): string[] {
  const ids = track.playlistIds ?? []
  const names: string[] = []
  for (const id of ids) {
    const name = playlistNameMap.value.get(id)
    if (name) {
      names.push(name)
    }
  }
  return names
}

function playlistSummaryFor(track: Music): string {
  const names = playlistBadgesFor(track)
  if (names.length === 0) {
    return ''
  }
  const head = names.slice(0, 2).join(' · ')
  return names.length > 2 ? `${head} · +${names.length - 2}` : head
}

const filteredTracks = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const list = tracks.value ?? []
  const searched = keyword
    ? list.filter((item) => {
        const searchable = [item.filename, item.title, item.artists, item.album]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return searchable.includes(keyword)
      })
    : list
  return sortTracks(searched, sortKey.value)
})

function openSortMenu(event: MouseEvent): void {
  event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement | null
  if (!anchor) {
    return
  }
  openFromAnchor(anchor, librarySortKeys.map(key => ({
    id: `sort:${key}`,
    label: t(`library.sort.${key}`),
    icon: sortKey.value === key ? 'i-tabler-check' : 'i-tabler-point',
    onSelect: () => {
      sortKey.value = key
    },
  })))
}

const selection = useListSelection(() => filteredTracks.value.map(item => item.id))

watch(filteredTracks, (list) => {
  selection.prune(new Set(list.map(item => item.id)))
})

function handleTrackClick(id: string, event: MouseEvent): void {
  const { handled } = selection.handleClick(id, event)
  if (handled) {
    return
  }
  activateTrack(id)
}

function activateTrack(id: string): void {
  selection.clear()
  if (currentTrackId.value === id) {
    setPlaying(!isPlaying.value)
  }
  else {
    selectTrack(id, { contextTracks: tracks.value ?? [] })
    setPlaying(true)
  }
}

function trackCoverUrl(track: Music): string {
  const coverUrl = track.coverThumbUrl ?? track.coverUrl
  return coverUrl ? resolveApiUrl(coverUrl) : ''
}

function isDeleting(id: string): boolean {
  return deleteMutation.isPending.value && deleteMutation.variables.value === id
}

const editingTrack = ref<Music | null>(null)
const isEditOpen = computed(() => editingTrack.value !== null)

function openEdit(track: Music): void {
  editingTrack.value = track
}

function closeEdit(): void {
  editingTrack.value = null
}

async function handleDelete(id: string): Promise<void> {
  if (isDeleting(id)) {
    return
  }

  await deleteMutation.mutateAsync(id)

  if (currentTrackId.value === id) {
    setPlaying(false)
    selectTrack(null, { history: 'skip' })
  }
}

function resolveTracks(ids: string[]): Music[] {
  const byId = new Map((tracks.value ?? []).map(item => [item.id, item]))
  const result: Music[] = []
  for (const id of ids) {
    const track = byId.get(id)
    if (track) {
      result.push(track)
    }
  }
  return result
}

function menuItemsFor(track: Music) {
  const selectedIds = selection.toArray()
  const useBatch = selectedIds.length > 1 && selectedIds.includes(track.id)
  const targetTracks = useBatch ? resolveTracks(selectedIds) : [track]

  return buildItems({
    tracks: targetTracks,
    onEditMetadata: useBatch ? undefined : openEdit,
    onDelete: async (items) => {
      for (const t_ of items) {
        await handleDelete(t_.id)
      }
      selection.clear()
    },
  })
}

function handleContextMenu(track: Music, event: MouseEvent): void {
  if (!selection.isSelected(track.id) && selection.hasSelection.value) {
    selection.selectOne(track.id)
  }
  openFromEvent(event, menuItemsFor(track))
}

function openMoreMenu(track: Music, event: MouseEvent): void {
  event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement | null
  if (anchor) {
    openFromAnchor(anchor, menuItemsFor(track))
  }
}

function openBatchMenu(event: MouseEvent): void {
  event.stopPropagation()
  const ids = selection.toArray()
  if (ids.length === 0) {
    return
  }
  const targetTracks = resolveTracks(ids)
  const items = buildItems({
    tracks: targetTracks,
    onDelete: async (xs) => {
      for (const t_ of xs) {
        await handleDelete(t_.id)
      }
      selection.clear()
    },
  })
  const anchor = event.currentTarget as HTMLElement | null
  if (anchor) {
    openFromAnchor(anchor, items)
  }
}
</script>

<template>
  <section class="library">
    <!-- Search bar + sort -->
    <div class="search-wrapper">
      <div class="search-field">
        <span class="i-tabler-search search-icon" />
        <input
          v-model="search"
          class="search-input"
          :placeholder="t('library.searchPlaceholder')"
          type="search"
        >
      </div>
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
        <span class="sort-button-text">{{ t(`library.sort.${sortKey}`) }}</span>
      </button>
    </div>

    <!-- Selection toolbar -->
    <div
      v-if="selection.hasSelection.value"
      class="selection-toolbar"
    >
      <span class="selection-count">
        {{ t('library.selectedCount', { n: selection.size.value }) }}
      </span>
      <button
        type="button"
        class="selection-action"
        @click="openBatchMenu($event)"
      >
        <span
          class="i-tabler-dots"
          aria-hidden="true"
        />
        <span>{{ t('common.actions.moreOptions') }}</span>
      </button>
      <button
        type="button"
        class="selection-action"
        @click="selection.clear"
      >
        <span
          class="i-tabler-x"
          aria-hidden="true"
        />
        <span>{{ t('common.actions.cancel') }}</span>
      </button>
    </div>

    <!-- Error -->
    <div
      v-if="isError"
      class="empty-state"
    >
      <span class="i-tabler-alert-circle text---danger/50 text-(3xl)" />
      <p class="empty-text">
        {{ (error as Error)?.message ?? t('library.loadFailed') }}
      </p>
    </div>

    <!-- Loading -->
    <template v-else-if="isPending">
      <div class="track-list">
        <div
          v-for="i in 8"
          :key="i"
          class="tr tr--skeleton"
        >
          <div class="skeleton tr-cover-skeleton" />
          <div class="tr-primary">
            <div
              class="skeleton tr-skel-title"
              :style="{ width: `${skeletonTitleWidths[i % skeletonTitleWidths.length]}%` }"
            />
            <div
              class="skeleton tr-skel-sub"
              :style="{ width: `${skeletonMetaWidths[i % skeletonMetaWidths.length]}%` }"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Empty -->
    <div
      v-else-if="filteredTracks.length === 0"
      class="empty-state"
    >
      <span class="i-tabler-music-off text---text-tertiary/40 text-(4xl)" />
      <p class="empty-title">
        {{ search ? t('library.noResultsTitle') : t('library.emptyTitle') }}
      </p>
      <p class="empty-hint">
        {{ search ? t('library.noResultsHint') : t('library.emptyHint') }}
      </p>
    </div>

    <!-- Track list -->
    <div
      v-else
      class="track-list"
    >
      <div
        v-for="track in filteredTracks"
        :key="track.id"
        class="tr"
        :class="{
          'tr--active': currentTrackId === track.id,
          'tr--selected': selection.isSelected(track.id),
        }"
        role="button"
        tabindex="0"
        :aria-label="currentTrackId === track.id && isPlaying ? t('library.pauseTrack', { title: track.title || track.filename }) : t('library.playTrack', { title: track.title || track.filename })"
        :aria-current="currentTrackId === track.id ? 'true' : undefined"
        @click="handleTrackClick(track.id, $event)"
        @keydown.enter.prevent="activateTrack(track.id)"
        @keydown.space.prevent="activateTrack(track.id)"
        @contextmenu="handleContextMenu(track, $event)"
      >
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
              v-if="currentTrackId === track.id"
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
            <span
              v-if="track.source"
              class="tr-source-icon"
              :class="getSourceDisplay(track.source).icon"
              :title="getSourceDisplay(track.source).label"
              aria-hidden="true"
            />
            <span class="tr-artist-name">{{ track.artists || track.filename }}</span>
          </p>
        </div>

        <div class="tr-secondary">
          <span
            v-if="track.album"
            class="tr-album"
          >{{ track.album }}</span>
          <span
            v-if="playlistBadgesFor(track).length > 0"
            class="tr-in"
            :title="t('library.inPlaylists', { names: playlistBadgesFor(track).join(', ') })"
          >{{ playlistSummaryFor(track) }}</span>
        </div>

        <span class="tr-duration">{{ formatTrackDuration(track.durationSeconds) }}</span>

        <button
          type="button"
          class="tr-action"
          :aria-label="t('common.actions.moreOptions')"
          @click="openMoreMenu(track, $event)"
        >
          <span
            v-if="isDeleting(track.id)"
            class="i-tabler-loader-2 animate-spin"
            aria-hidden="true"
          />
          <span
            v-else
            class="i-tabler-dots"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <MetadataEditDialog
      :open="isEditOpen"
      :track="editingTrack"
      @close="closeEdit"
    />
  </section>
</template>

<style scoped>
.library {
  padding-top: 0.75rem;
}

@media (min-width: 768px) {
  .library {
    padding-top: 0;
  }
}

/* ---- Search ---- */
.search-wrapper {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0;
  background: var(--bg-base);
}

@media (min-width: 768px) {
  .search-wrapper {
    top: 3.5rem;
    padding: 0.75rem 0 0.5rem;
  }
}

.search-field {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: var(--text-tertiary);
  pointer-events: none;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.75rem;
  padding: 0 0.875rem;
  border: none;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.sort-button:hover {
  background: var(--bg-elevated, var(--bg-surface));
  color: var(--text-primary);
}

.sort-button-text {
  display: none;
}

@media (min-width: 768px) {
  .sort-button-text {
    display: inline;
  }
}

.search-input {
  width: 100%;
  height: 2.75rem;
  padding: 0 1rem 0 2.5rem;
  border: none;
  border-radius: 1.375rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: background 0.15s ease;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.search-input:focus {
  background: var(--bg-elevated);
}

/* ===========================================================
 * Track row — "Editorial Quiet" design system
 * Row: 52px desktop / 56px mobile
 * Cover: 40px / 44px
 * Grid columns (desktop):
 *   [cover] [primary 1fr] [secondary 1fr 0 1fr] [duration] [action]
 * Grid columns (mobile): only cover + primary + duration + action
 * =========================================================== */

.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 0.25rem;
}

.tr {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 40px 28px;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 56px;
  padding: 0 10px 0 6px;
  border: none;
  background: transparent;
  border-radius: 10px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  position: relative;
  transition: background 120ms ease;
}

/* Secondary column hidden on small screens */
.tr-secondary {
  display: none;
}

@media (min-width: 768px) {
  .tr {
    grid-template-columns: 40px minmax(0, 1.1fr) minmax(0, 1fr) 44px 28px;
    height: 52px;
    padding: 0 12px 0 6px;
  }
  .tr-secondary {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    line-height: 1.3;
    overflow: hidden;
  }
  .tr-in {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-secondary);
    transition: color 120ms ease;
  }
  .tr:hover .tr-in {
    color: var(--text-primary);
  }
}

.tr:hover {
  background: var(--bg-surface);
}

/* Now-playing: coral left bar + title colored — no background fill. */
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

/* Selection: inset outline, soft bg; layers cleanly with --active */
.tr--selected {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 36%, transparent);
}
.tr--active.tr--selected {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 36%, transparent);
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

.tr-cover-skeleton {
  width: 44px;
  height: 44px;
  border-radius: 5px;
}

@media (min-width: 768px) {
  .tr-cover-skeleton {
    width: 40px;
    height: 40px;
  }
}

.tr-skel-title,
.tr-skel-sub {
  height: 11px;
  border-radius: 3px;
}
.tr-skel-title { width: 60% }
.tr-skel-sub { width: 38%; margin-top: 6px }

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

.tr-source-icon {
  flex-shrink: 0;
}

/* --- Album column --- */
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

/* --- Action (more menu) --- */
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

/* Touch: always show actions */
@media (hover: none) {
  .tr-action { opacity: 1 }
  .tr-cover-overlay { opacity: 0 }
}

/* ---- Selection toolbar ---- */
.selection-toolbar {
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

.selection-count {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.selection-action {
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

.selection-action:hover {
  background: var(--bg-elevated);
}
</style>
