import type { Ref } from 'vue'
import type { Music } from '../api/types.gen'
import type { PlayRecordedEvent, PlayReport } from '../utils/playTracker'
import { useQueryClient } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import { watch } from 'vue'
import { client } from '../api/client.gen'
import { createPlayTracker } from '../utils/playTracker'
import { authStatus } from './useAuth'
import { statsQueryKey } from './useListeningStats'
import { musicQueryKey } from './useMusic'

async function sendPlayReport(report: PlayReport): Promise<{ counted: boolean } | null> {
  // Guests cannot write (POST requires a session), so their listening is not recorded.
  if (authStatus.value !== 'authenticated') {
    return null
  }
  const url = client.buildUrl({
    url: '/music/{id}/plays',
    path: { id: report.trackId },
    baseUrl: client.getConfig().baseUrl ?? '',
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: report.keepalive,
    body: JSON.stringify({
      sessionId: report.sessionId,
      startedAt: report.startedAt,
      listenedSeconds: report.listenedSeconds,
      durationSeconds: report.durationSeconds,
      status: report.status,
    }),
  })
  if (!response.ok) {
    return null
  }
  return await response.json() as { counted: boolean }
}

function applyToTrack(track: Music, event: PlayRecordedEvent): Music {
  const lastPlayedAt = event.newlyCounted && (!track.lastPlayedAt || track.lastPlayedAt < event.startedAt)
    ? event.startedAt
    : track.lastPlayedAt
  return {
    ...track,
    playCount: (track.playCount ?? 0) + (event.newlyCounted ? 1 : 0),
    listenedSeconds: (track.listenedSeconds ?? 0) + event.listenedDelta,
    lastPlayedAt,
  }
}

/**
 * Attaches listening statistics to the player's `<audio>` element. Reports are
 * sent only for signed-in users; local caches are patched instead of refetching
 * the library so play counts in lists update right away.
 */
export function usePlayTracker(audioRef: Ref<HTMLAudioElement | null>, trackId: () => string | null) {
  const queryClient = useQueryClient()

  const tracker = createPlayTracker({
    send: sendPlayReport,
    onRecorded(event) {
      queryClient.setQueriesData<Music[]>({ queryKey: musicQueryKey }, (items) => {
        if (!Array.isArray(items)) {
          return items
        }
        return items.map(item => item.id === event.trackId ? applyToTrack(item, event) : item)
      })
      queryClient.invalidateQueries({ queryKey: statsQueryKey }).catch(() => {})
      if (event.newlyCounted) {
        queryClient.invalidateQueries({ queryKey: ['playlist'] }).catch(() => {})
      }
    },
  })

  watch(trackId, id => tracker.setTrack(id), { immediate: true })

  useEventListener(audioRef, 'timeupdate', () => {
    const audio = audioRef.value
    if (audio && !audio.seeking) {
      tracker.timeUpdate(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : null)
    }
  })
  useEventListener(audioRef, 'seeking', () => tracker.seeking())
  // A new source resets the position to 0 without a seek.
  useEventListener(audioRef, 'emptied', () => tracker.seeking())
  useEventListener(audioRef, 'ended', () => tracker.ended())

  useEventListener(globalThis.document, 'visibilitychange', () => {
    if (globalThis.document.visibilityState === 'hidden') {
      tracker.flush()
    }
  })
  useEventListener(globalThis, 'pagehide', () => tracker.stop())

  return tracker
}
