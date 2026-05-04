export type PlayMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'
export type PlaybackContextType = 'library' | 'playlist'

export interface TrackLike {
  id: string
}

export type PlaybackContextInput
  = { type: 'library' }
  | { type: 'playlist', playlistId: string }

type PlaybackContext
  = { type: 'library', trackIds: string[] }
  | { type: 'playlist', playlistId: string, trackIds: string[] }

interface PersistedPlayerState {
  context: PlaybackContext | null
  currentTime: number
  currentTrackId: string | null
  history: string[]
  isPlaying: boolean
  muted: boolean
  playMode: PlayMode
  upNextQueue: string[]
  volume: number
}

interface SelectTrackOptions {
  contextTracks?: TrackLike[]
  context?: PlaybackContextInput
  history?: 'push' | 'skip'
  consumeUpNext?: boolean
}

const playModeOrder: PlayMode[] = ['sequence', 'repeat-all', 'repeat-one', 'shuffle']
const playerStateStorageKey = 'audoria.player-state'
const historyLimit = 100
const upNextLimit = 500
const resumeEndThresholdSeconds = 5

function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === 'string' && playModeOrder.includes(value as PlayMode)
}

function normalizeTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeTrackIds(trackIds: string[]): string[] {
  return [...new Set(trackIds.filter(id => typeof id === 'string' && id.length > 0))]
}

function normalizeQueueIds(trackIds: string[]): string[] {
  // upNext allows the same track to be enqueued multiple times deliberately,
  // but we still keep only valid string ids. We do NOT de-dup across the queue.
  return trackIds.filter(id => typeof id === 'string' && id.length > 0).slice(0, upNextLimit)
}

function defaultPersistedState(): PersistedPlayerState {
  return {
    context: null,
    currentTime: 0,
    currentTrackId: null,
    history: [],
    isPlaying: false,
    muted: false,
    playMode: 'repeat-all',
    upNextQueue: [],
    volume: 1,
  }
}

function getStorage(): Storage | undefined {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage as Storage
  }
  return undefined
}

function readPersistedState(raw: string): PersistedPlayerState {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPlayerState>
    const parsedContext = parsed.context
    let context: PlaybackContext | null = null
    if (
      parsedContext
      && typeof parsedContext === 'object'
      && parsedContext !== null
      && Array.isArray(parsedContext.trackIds)
    ) {
      if (parsedContext.type === 'library') {
        context = {
          type: 'library',
          trackIds: normalizeTrackIds(parsedContext.trackIds),
        }
      }
      else if (parsedContext.type === 'playlist' && typeof parsedContext.playlistId === 'string' && parsedContext.playlistId.length > 0) {
        context = {
          type: 'playlist',
          playlistId: parsedContext.playlistId,
          trackIds: normalizeTrackIds(parsedContext.trackIds),
        }
      }
    }

    return {
      context,
      currentTime: normalizeTime(parsed.currentTime),
      currentTrackId: typeof parsed.currentTrackId === 'string' && parsed.currentTrackId.length > 0
        ? parsed.currentTrackId
        : null,
      history: Array.isArray(parsed.history)
        ? normalizeTrackIds(parsed.history).slice(-historyLimit)
        : [],
      isPlaying: Boolean(parsed.isPlaying),
      muted: Boolean(parsed.muted),
      playMode: isPlayMode(parsed.playMode) ? parsed.playMode : 'repeat-all',
      upNextQueue: Array.isArray(parsed.upNextQueue)
        ? normalizeQueueIds(parsed.upNextQueue)
        : [],
      volume: typeof parsed.volume === 'number'
        ? Math.min(1, Math.max(0, parsed.volume))
        : 1,
    }
  }
  catch {
    return defaultPersistedState()
  }
}

const storage = useStorage<PersistedPlayerState>(
  playerStateStorageKey,
  defaultPersistedState(),
  getStorage(),
  {
    mergeDefaults: true,
    flush: 'sync',
    serializer: { read: readPersistedState, write: v => JSON.stringify(v) },
  },
)

const currentTrackId = ref<string | null>(storage.value.currentTrackId)
const isPlaying = ref(storage.value.isPlaying)
const playMode = ref<PlayMode>(storage.value.playMode)
const currentTime = ref(storage.value.currentTime)
const duration = ref(0)
const volume = ref(storage.value.volume)
const muted = ref(storage.value.muted)
const playHistory = ref<string[]>(storage.value.history)
const playbackContext = ref<PlaybackContext | null>(storage.value.context)
const upNextQueue = ref<string[]>(storage.value.upNextQueue)

function persistState(): void {
  storage.value = {
    context: playbackContext.value,
    currentTime: currentTime.value,
    currentTrackId: currentTrackId.value,
    history: playHistory.value,
    isPlaying: isPlaying.value,
    muted: muted.value,
    playMode: playMode.value,
    upNextQueue: upNextQueue.value,
    volume: volume.value,
  }
}

function normalizePlaybackContext(input: PlaybackContextInput, trackIds: string[]): PlaybackContext {
  const normalizedTrackIds = normalizeTrackIds(trackIds)
  if (input.type === 'playlist') {
    return {
      type: 'playlist',
      playlistId: input.playlistId,
      trackIds: normalizedTrackIds,
    }
  }
  return {
    type: 'library',
    trackIds: normalizedTrackIds,
  }
}

function setPlaybackContext(trackIds: string[], input: PlaybackContextInput): void {
  playbackContext.value = normalizePlaybackContext(input, trackIds)
}

const defaultLibraryContext: PlaybackContextInput = Object.freeze({ type: 'library' })

function updateContextFromTracks(tracks: TrackLike[], input: PlaybackContextInput = defaultLibraryContext): void {
  setPlaybackContext(tracks.map(track => track.id), input)
}

function isSamePlaybackContext(current: PlaybackContext | null, next: PlaybackContextInput): boolean {
  if (!current) {
    return false
  }
  if (current.type !== next.type) {
    return false
  }
  if (current.type === 'playlist' && next.type === 'playlist') {
    return current.playlistId === next.playlistId
  }
  return true
}

function pushHistory(trackId: string): void {
  const nextHistory = [...playHistory.value]
  if (nextHistory.at(-1) === trackId) {
    return
  }
  nextHistory.push(trackId)
  playHistory.value = nextHistory.slice(-historyLimit)
}

function resetProgress(): void {
  currentTime.value = 0
  duration.value = 0
}

function resolveOrderedTrackIds(tracks: TrackLike[]): string[] {
  const fallbackTrackIds = normalizeTrackIds(tracks.map(track => track.id))
  const contextTrackIds = playbackContext.value?.trackIds ?? []

  if (contextTrackIds.length === 0) {
    return fallbackTrackIds
  }

  const availableTrackIds = new Set(fallbackTrackIds)
  const orderedContextTrackIds = contextTrackIds.filter(id => availableTrackIds.has(id))
  return orderedContextTrackIds.length > 0 ? orderedContextTrackIds : fallbackTrackIds
}

function consumeHistoryTrackId(availableTrackIds: Set<string>): string | null {
  const nextHistory = [...playHistory.value]
  let candidate: string | null = null

  while (nextHistory.length > 0) {
    const trackId = nextHistory.pop() ?? null
    if (!trackId || trackId === currentTrackId.value || !availableTrackIds.has(trackId)) {
      continue
    }
    candidate = trackId
    break
  }

  if (nextHistory.length !== playHistory.value.length) {
    playHistory.value = nextHistory
    persistState()
  }

  return candidate
}

export function usePlayerState() {
  const selectTrack = (id: string | null, options: SelectTrackOptions = {}) => {
    if (options.contextTracks) {
      updateContextFromTracks(options.contextTracks, options.context)
    }

    const previousTrackId = currentTrackId.value
    if (options.history !== 'skip' && previousTrackId && id && previousTrackId !== id) {
      pushHistory(previousTrackId)
    }

    if (options.consumeUpNext && id && upNextQueue.value[0] === id) {
      upNextQueue.value = upNextQueue.value.slice(1)
    }

    currentTrackId.value = id
    resetProgress()

    if (!id) {
      isPlaying.value = false
    }

    persistState()
  }

  const setPlaying = (playing: boolean) => {
    isPlaying.value = playing
    persistState()
  }

  const cyclePlayMode = () => {
    const index = playModeOrder.indexOf(playMode.value)
    playMode.value = playModeOrder[(index + 1) % playModeOrder.length]
    persistState()
  }

  const updateProgress = (time: number, total: number) => {
    currentTime.value = normalizeTime(time)
    duration.value = normalizeTime(total)
    persistState()
  }

  const seekTo = (time: number) => {
    currentTime.value = normalizeTime(time)
    persistState()
  }

  const setVolume = (v: number) => {
    volume.value = Math.min(1, Math.max(0, v))
    if (volume.value > 0) {
      muted.value = false
    }
    persistState()
  }

  const toggleMute = () => {
    muted.value = !muted.value
    persistState()
  }

  const syncTrackContext = (tracks: TrackLike[], context: PlaybackContextInput = defaultLibraryContext) => {
    if (playbackContext.value && !isSamePlaybackContext(playbackContext.value, context)) {
      return
    }

    const trackIds = normalizeTrackIds(tracks.map(track => track.id))
    const availableTrackIds = new Set(trackIds)
    const nextHistory = playHistory.value.filter(id => availableTrackIds.has(id))
    const historyChanged = nextHistory.length !== playHistory.value.length
    const currentContext = playbackContext.value
    const nextContext = normalizePlaybackContext(context, trackIds)
    const contextChanged = !currentContext
      || !isSamePlaybackContext(currentContext, context)
      || currentContext.trackIds.length !== trackIds.length
      || currentContext.trackIds.some((id, index) => id !== trackIds[index])
    const currentTrackRemoved = Boolean(currentTrackId.value && !availableTrackIds.has(currentTrackId.value))

    if (contextChanged) {
      playbackContext.value = nextContext
    }

    if (historyChanged) {
      playHistory.value = nextHistory
    }

    if (currentTrackRemoved) {
      currentTrackId.value = null
      isPlaying.value = false
      resetProgress()
    }

    if (contextChanged || historyChanged || currentTrackRemoved) {
      persistState()
    }
  }

  const pickRandomTrackId = (tracks: TrackLike[]) => {
    const trackIds = resolveOrderedTrackIds(tracks)
    const others = trackIds.filter(trackId => trackId !== currentTrackId.value)
    const pool = others.length > 0 ? others : trackIds
    return pool[Math.floor(Math.random() * pool.length)] ?? null
  }

  const getAdjacentTrackId = (tracks: TrackLike[], direction: 'next' | 'prev') => {
    const orderedTrackIds = resolveOrderedTrackIds(tracks)
    if (orderedTrackIds.length === 0) {
      return null
    }
    if (playMode.value === 'shuffle') {
      return pickRandomTrackId(tracks)
    }

    const index = currentTrackId.value ? orderedTrackIds.indexOf(currentTrackId.value) : -1
    if (index === -1) {
      return orderedTrackIds[0] ?? null
    }

    const nextIndex = direction === 'next' ? index + 1 : index - 1
    const nextTrackId = orderedTrackIds[nextIndex]
    if (nextTrackId) {
      return nextTrackId
    }

    if (playMode.value === 'repeat-all') {
      return direction === 'next'
        ? orderedTrackIds[0] ?? null
        : orderedTrackIds.at(-1) ?? null
    }

    return null
  }

  const getPreviousTrackId = (tracks: TrackLike[]) => {
    const availableTrackIds = new Set(normalizeTrackIds(tracks.map(track => track.id)))
    const historyTrackId = consumeHistoryTrackId(availableTrackIds)
    if (historyTrackId) {
      return historyTrackId
    }
    return getAdjacentTrackId(tracks, 'prev')
  }

  const getAutoAdvanceTrackId = (tracks: TrackLike[]) => {
    if (playMode.value === 'repeat-one') {
      return currentTrackId.value
    }
    // upNext queue has priority over context when auto-advancing.
    const upNext = upNextQueue.value[0]
    if (upNext) {
      return upNext
    }
    return getAdjacentTrackId(tracks, 'next')
  }

  const getNextTrackId = (tracks: TrackLike[]) => {
    const upNext = upNextQueue.value[0]
    if (upNext) {
      return upNext
    }
    return getAdjacentTrackId(tracks, 'next')
  }

  const getResumeTime = (total: number, savedTimeInput = currentTime.value) => {
    const savedTime = normalizeTime(savedTimeInput)
    if (!savedTime) {
      return 0
    }
    if (total > 0 && savedTime >= total - resumeEndThresholdSeconds) {
      return 0
    }
    return total > 0 ? Math.min(savedTime, Math.max(0, total - 0.25)) : savedTime
  }

  const enqueueNext = (trackIds: string[]) => {
    const incoming = normalizeQueueIds(trackIds)
    if (incoming.length === 0) {
      return
    }
    upNextQueue.value = normalizeQueueIds([...incoming, ...upNextQueue.value])
    persistState()
  }

  const enqueueLast = (trackIds: string[]) => {
    const incoming = normalizeQueueIds(trackIds)
    if (incoming.length === 0) {
      return
    }
    upNextQueue.value = normalizeQueueIds([...upNextQueue.value, ...incoming])
    persistState()
  }

  const removeFromQueueAt = (index: number) => {
    if (index < 0 || index >= upNextQueue.value.length) {
      return
    }
    const next = [...upNextQueue.value]
    next.splice(index, 1)
    upNextQueue.value = next
    persistState()
  }

  const moveInQueue = (fromIndex: number, toIndex: number) => {
    const queue = upNextQueue.value
    if (
      fromIndex < 0 || fromIndex >= queue.length
      || toIndex < 0 || toIndex >= queue.length
      || fromIndex === toIndex
    ) {
      return
    }
    const next = [...queue]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    upNextQueue.value = next
    persistState()
  }

  const clearQueue = () => {
    if (upNextQueue.value.length === 0) {
      return
    }
    upNextQueue.value = []
    persistState()
  }

  const pruneQueue = (availableIds: Set<string>) => {
    if (upNextQueue.value.length === 0) {
      return
    }
    const filtered = upNextQueue.value.filter(id => availableIds.has(id))
    if (filtered.length !== upNextQueue.value.length) {
      upNextQueue.value = filtered
      persistState()
    }
  }

  const consumeUpNextHead = (expected: string) => {
    if (upNextQueue.value[0] === expected) {
      upNextQueue.value = upNextQueue.value.slice(1)
      persistState()
    }
  }

  return {
    clearQueue,
    consumeUpNextHead,
    currentTime,
    currentTrackId,
    cyclePlayMode,
    duration,
    enqueueLast,
    enqueueNext,
    getAdjacentTrackId,
    getAutoAdvanceTrackId,
    getNextTrackId,
    getPreviousTrackId,
    getResumeTime,
    isPlaying,
    moveInQueue,
    muted,
    playHistory,
    playMode,
    playbackContext,
    pruneQueue,
    removeFromQueueAt,
    seekTo,
    selectTrack,
    setPlaying,
    setVolume,
    syncTrackContext,
    toggleMute,
    updateProgress,
    upNextQueue,
    volume,
  }
}
