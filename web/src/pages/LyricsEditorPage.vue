<script setup lang="ts">
import type { LyricsDoc } from '@audoria/lyrics-core'
import type { AudioSource, EditorLocale, Stage, VocalsStore } from '@audoria/lyrics-editor'

import { LyricsTimingEditor, mediaElementSource, prepareSave, toEditorLocale } from '@audoria/lyrics-editor'
import { useQuery } from '@tanstack/vue-query'
import { useEventListener, watchDebounced } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getMusicByIdLyricsFurigana } from '../api/sdk.gen'
import { useLyricsDoc } from '../composables/useLyrics'
import { buildDownloadUrl, fetchVocals, useMusicQuery, useUpdateLyrics, useUploadVocals } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const trackId = computed(() => String(route.params.id))

// The stage lives in the URL, so a reload comes back to it.
const STAGES: readonly Stage[] = ['line', 'word', 'preview']
const stage = computed<Stage>({
  get: () => STAGES.find(item => item === route.query.stage) ?? 'line',
  set: value => void router.replace({ query: { ...route.query, stage: value } }),
})
const { data: tracks, isPending: isLoadingTracks } = useMusicQuery()
const track = computed(() => tracks.value?.find(item => item.id === trackId.value))
const serverDoc = useLyricsDoc(() => track.value)
const updateLyrics = useUpdateLyrics()
const { setPlaying } = usePlayerState()

const editorLocale = computed<EditorLocale>(() => toEditorLocale(locale.value))
const draftKey = computed(() => `audoria.lyrics-draft.${trackId.value}`)

// The draft being edited, and the document it was last saved as (or loaded from).
const doc = shallowRef<LyricsDoc | null>(null)
const saved = shallowRef<LyricsDoc | null>(null)
const isDirty = computed(() => doc.value !== saved.value)
const restoredDraft = ref(false)
const justSaved = ref(false)
const message = ref('')

interface StoredDraft {
  /** The track's lyrics the draft started from; a draft over lyrics changed since is dropped. */
  baseLyrics: string | null
  doc: LyricsDoc
}

function readStoredDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey.value)
    return raw ? JSON.parse(raw) as StoredDraft : null
  }
  catch {
    return null
  }
}

// Load once, when the track and its lyrics are known: an unsaved draft for the same lyrics
// wins over them, and a track without lyrics starts from an empty document.
watch([track, serverDoc], ([current, loaded]) => {
  if (doc.value || !current || (current.lyrics?.trim() && !loaded)) {
    return
  }
  const initial = loaded ?? { version: 1, timing: 'word', cues: [], tracks: [] }
  const stored = readStoredDraft()
  saved.value = initial
  if (stored && stored.baseLyrics === (current.lyrics ?? null)) {
    doc.value = stored.doc
    restoredDraft.value = true
  }
  else {
    doc.value = initial
  }
}, { immediate: true })

// Debounced: a drag on the waveform edits the draft on every pointer move.
watchDebounced(doc, (value) => {
  try {
    if (value && isDirty.value) {
      localStorage.setItem(draftKey.value, JSON.stringify({ baseLyrics: track.value?.lyrics ?? null, doc: value } satisfies StoredDraft))
    }
    else {
      localStorage.removeItem(draftKey.value)
    }
  }
  catch {
    // Storage may be full or blocked; the draft just isn't kept across reloads.
  }
}, { debounce: 400 })

async function save(): Promise<void> {
  if (!doc.value || !isDirty.value || updateLyrics.isPending.value) {
    return
  }
  const check = prepareSave(doc.value)
  if (!check.ok) {
    message.value = 'incomplete' in check
      ? t('lyricsEditor.incomplete', { line: check.incomplete[0] + 1, count: check.incomplete.length })
      : check.problem
    return
  }
  message.value = ''
  const draft = doc.value
  try {
    await updateLyrics.mutateAsync({ id: trackId.value, doc: check.doc })
    saved.value = draft
    justSaved.value = true
    restoredDraft.value = false
    localStorage.removeItem(draftKey.value)
  }
  catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  }
}

useEventListener(globalThis, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
})

// The editor plays the song through its own element, so the main player steps aside.
const audioEl = ref<HTMLAudioElement | null>(null)
const audio = shallowRef<AudioSource | null>(null)
watch(audioEl, (element) => {
  audio.value = element ? mediaElementSource(element) : null
})
onMounted(() => setPlaying(false))

// The waveform needs the whole file; the editor asks for it only once a marking stage opens.
async function loadAudioData(): Promise<ArrayBuffer> {
  const response = await fetch(buildDownloadUrl(trackId.value))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return await response.arrayBuffer()
}

// Readings of Japanese lyrics, so a kanji sung over several kana is timed kana by kana. The
// editor cuts words as it opens, so it waits for them; without them it times words whole.
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const needsReadings = computed(() => KANA_RE.test(track.value?.lyrics ?? ''))
const readingsQuery = useQuery({
  // The player's key: the readings are shared.
  queryKey: computed(() => ['lyrics-furigana', trackId.value, track.value?.lyrics] as const),
  queryFn: async () => {
    const { data } = await getMusicByIdLyricsFurigana({ path: { id: trackId.value }, throwOnError: true })
    return data.lines
  },
  enabled: needsReadings,
  staleTime: Infinity,
})
const readings = computed(() => readingsQuery.data.value ?? {})
const readingsSettled = computed(() => !needsReadings.value || readingsQuery.isSuccess.value || readingsQuery.isError.value)

// Separated vocals are kept with the track, so each song is separated once.
const uploadVocals = useUploadVocals()
const vocalsStore: VocalsStore = {
  load: async () => track.value?.hasVocals ? await fetchVocals(trackId.value) : null,
  save: async (data) => {
    await uploadVocals.mutateAsync({ id: trackId.value, analysis: data })
  },
}
</script>

<template>
  <div class="lyrics-editor-page">
    <audio
      ref="audioEl"
      :src="buildDownloadUrl(trackId)"
      preload="auto"
    />
    <header class="editor-bar">
      <RouterLink
        to="/player"
        class="editor-back"
        :aria-label="t('lyricsEditor.back')"
      >
        <span
          class="i-tabler-arrow-left"
          aria-hidden="true"
        />
      </RouterLink>
      <div class="editor-title">
        <span class="editor-kicker">{{ t('lyricsEditor.title') }}</span>
        <span class="editor-track">{{ track?.title || track?.filename || '' }}<template v-if="track?.artists"> · {{ track.artists }}</template></span>
      </div>
      <span
        v-if="message"
        class="editor-message editor-message--error"
        role="alert"
      >{{ message }}</span>
      <span
        v-else-if="restoredDraft"
        class="editor-message"
      >{{ t('lyricsEditor.draftRestored') }}</span>
      <span
        v-else
        class="editor-message"
      >{{ isDirty ? t('lyricsEditor.unsaved') : justSaved ? t('lyricsEditor.saved') : '' }}</span>
      <button
        type="button"
        class="editor-save"
        :disabled="!isDirty || updateLyrics.isPending.value"
        title="Ctrl+S"
        @click="save"
      >
        {{ updateLyrics.isPending.value ? t('lyricsEditor.saving') : t('lyricsEditor.save') }}
      </button>
    </header>

    <LyricsTimingEditor
      v-if="doc && audio && readingsSettled"
      v-model:doc="doc"
      v-model:stage="stage"
      class="editor"
      :audio="audio"
      :load-audio-data="loadAudioData"
      :vocals-store="vocalsStore"
      :readings="readings"
      :locale="editorLocale"
    />
    <p
      v-else-if="!isLoadingTracks && !track"
      class="editor-empty"
    >
      {{ t('lyricsEditor.notFound') }}
    </p>
  </div>
</template>

<style scoped>
.lyrics-editor-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100dvh;
}

@media (min-width: 768px) {
  .lyrics-editor-page {
    /* Below the app's top bar. */
    height: calc(100dvh - 3.5rem - 1px);
  }
}

.editor-bar {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base);
}

.editor-back {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.editor-back:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.editor-title {
  display: grid;
  min-width: 0;
}

.editor-kicker {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.editor-track {
  overflow: hidden;
  font-size: 0.9375rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-message {
  margin-left: auto;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: right;
}

.editor-message--error {
  color: #ff8a80;
}

.editor-save {
  padding: 0.45rem 1rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
}

.editor-save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.editor-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.editor {
  min-height: 0;
}

.editor-empty {
  padding: 3rem 1rem;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
