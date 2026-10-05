<script setup lang="ts">
import type { LyricsDoc } from '@audoria/lyrics-core'
import type { AudioSource, EditorLocale } from '@audoria/lyrics-editor'
import { looksLikeTtml, lyricsDocFromText, lyricsDocFromTtml, lyricsDocToText, lyricsDocToTtml, validateLyricsDoc } from '@audoria/lyrics-core'
import { finishTiming, incompleteLines, LyricsTimingEditor, mediaElementSource } from '@audoria/lyrics-editor'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const DRAFT_KEY = 'lyrics-editor:draft'

const locale: EditorLocale = navigator.language.startsWith('ja') ? 'ja' : navigator.language.startsWith('zh') ? 'zh' : 'en'
const text = {
  zh: {
    title: '逐字打轴',
    tagline: '打开一首歌和它的歌词，跟着节奏逐字打点，导出 TTML 或 LRC。',
    audio: '音频',
    lyrics: '歌词',
    pick: '选择文件',
    drop: '或拖到这里',
    paste: '粘贴 LRC、TTML 或纯文本歌词…',
    usePaste: '使用粘贴的歌词',
    restored: '已恢复上次的草稿，重新选择音频即可继续。',
    start: '开始打轴',
    exportTtml: '导出 TTML',
    exportLrc: '导出 LRC',
    close: '换一首',
    invalid: '还不能导出：',
    incomplete: (line: number, lines: number) => `第 ${line} 行还没打完${lines > 1 ? `，一共还有 ${lines} 行` : ''}。`,
    parseFailed: '读不出这份歌词：',
    privacy: '文件只在这个页面里打开，不会上传。',
  },
  ja: {
    title: '単語タイミング',
    tagline: '曲と歌詞を開いて、リズムに合わせて単語ごとにタイミングを打ち、TTML か LRC で書き出します。',
    audio: '音声',
    lyrics: '歌詞',
    pick: 'ファイルを選択',
    drop: 'またはドロップ',
    paste: 'LRC・TTML・テキストの歌詞を貼り付け…',
    usePaste: '貼り付けた歌詞を使う',
    restored: '前回の下書きを復元しました。音声を選び直すと続けられます。',
    start: 'はじめる',
    exportTtml: 'TTML を書き出す',
    exportLrc: 'LRC を書き出す',
    close: '別の曲',
    invalid: 'まだ書き出せません：',
    incomplete: (line: number, lines: number) => `${line} 行目がまだ途中です${lines > 1 ? `（残り ${lines} 行）` : ''}。`,
    parseFailed: '歌詞を読み込めません：',
    privacy: 'ファイルはこのページ内で開くだけで、アップロードされません。',
  },
  en: {
    title: 'Word Timing',
    tagline: 'Open a song and its lyrics, tap each word in time, and export TTML or LRC.',
    audio: 'Audio',
    lyrics: 'Lyrics',
    pick: 'Choose file',
    drop: 'or drop it here',
    paste: 'Paste LRC, TTML or plain lyrics…',
    usePaste: 'Use pasted lyrics',
    restored: 'Your last draft is back; choose the audio again to continue.',
    start: 'Start timing',
    exportTtml: 'Export TTML',
    exportLrc: 'Export LRC',
    close: 'Another song',
    invalid: 'Can’t export yet: ',
    incomplete: (line: number, lines: number) => `line ${line} isn’t fully timed${lines > 1 ? ` (${lines} lines left)` : ''}.`,
    parseFailed: 'Couldn’t read these lyrics: ',
    privacy: 'Files open in this page only; nothing is uploaded.',
  },
}[locale]

interface Draft {
  doc: LyricsDoc
  lyricsName: string
  audioName: string
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) as Draft : null
  }
  catch {
    return null
  }
}

const draft = readDraft()
const doc = shallowRef<LyricsDoc | null>(draft?.doc ?? null)
const lyricsName = ref(draft?.lyricsName ?? '')
const audioName = ref(draft?.audioName ?? '')
const audioUrl = ref('')
// Kept to read the song again for its waveform.
const audioFile = shallowRef<File | null>(null)
const restored = ref(Boolean(draft))
const editing = ref(false)
const pasted = ref('')
const error = ref('')
const audioEl = ref<HTMLAudioElement | null>(null)
const audio = shallowRef<AudioSource | null>(null)

watch(audioEl, (element) => {
  audio.value = element ? mediaElementSource(element) : null
})

// The draft survives a reload; the audio can't be kept, so it is chosen again.
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch([doc, lyricsName, audioName], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      if (doc.value) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: doc.value, lyricsName: lyricsName.value, audioName: audioName.value }))
      }
    }
    catch {
      // Storage may be full or blocked; the draft just isn't kept.
    }
  }, 400)
})

function loadAudio(file: File): void {
  URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = URL.createObjectURL(file)
  audioName.value = file.name
  audioFile.value = file
}

function loadLyricsText(raw: string, name: string): void {
  try {
    const parsed = looksLikeTtml(raw) ? lyricsDocFromTtml(raw) : lyricsDocFromText(raw)
    if (!parsed) {
      throw new Error('empty')
    }
    doc.value = parsed
    lyricsName.value = name
    restored.value = false
    error.value = ''
  }
  catch (error_) {
    error.value = text.parseFailed + (error_ instanceof Error ? error_.message : String(error_))
  }
}

async function onFiles(files: FileList | null | undefined, kind?: 'audio' | 'lyrics'): Promise<void> {
  for (const file of files ?? []) {
    const isAudio = kind ? kind === 'audio' : file.type.startsWith('audio/') || /\.(?:mp3|m4a|flac|wav|ogg|opus|aac)$/i.test(file.name)
    if (isAudio) {
      loadAudio(file)
    }
    else {
      loadLyricsText(await file.text(), file.name)
    }
  }
}

function onDrop(event: DragEvent): void {
  void onFiles(event.dataTransfer?.files)
}

const ready = computed(() => Boolean(doc.value && audioUrl.value))

function baseName(): string {
  return (lyricsName.value || audioName.value || 'lyrics').replace(/\.[^.]+$/, '')
}

function download(content: string, extension: string, type: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = `${baseName()}.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

function exportAs(format: 'ttml' | 'lrc'): void {
  if (!doc.value) {
    return
  }
  const incomplete = incompleteLines(doc.value)
  if (incomplete.length > 0) {
    error.value = text.invalid + text.incomplete(incomplete[0] + 1, incomplete.length)
    return
  }
  const finished = finishTiming(doc.value)
  const problem = validateLyricsDoc(finished)
  if (problem) {
    error.value = text.invalid + problem
    return
  }
  error.value = ''
  if (format === 'ttml') {
    download(lyricsDocToTtml(finished, { title: baseName() }), 'ttml', 'application/ttml+xml')
  }
  else {
    download(lyricsDocToText(finished), 'lrc', 'text/plain')
  }
}

function closeSong(): void {
  editing.value = false
  doc.value = null
  lyricsName.value = ''
  URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
  audioName.value = ''
  try {
    localStorage.removeItem(DRAFT_KEY)
  }
  catch {}
}

onBeforeUnmount(() => URL.revokeObjectURL(audioUrl.value))
</script>

<template>
  <audio
    v-if="audioUrl"
    ref="audioEl"
    :src="audioUrl"
    preload="auto"
  />

  <main
    v-if="editing && ready && audio && doc"
    class="app app--editing"
  >
    <header class="bar">
      <span class="brand"><i />{{ text.title }}</span>
      <span class="files">{{ audioName }} <b>+</b> {{ lyricsName }}</span>
      <span
        v-if="error"
        class="bar-error"
        role="alert"
      >{{ error }}</span>
      <button
        type="button"
        class="btn"
        @click="exportAs('lrc')"
      >
        {{ text.exportLrc }}
      </button>
      <button
        type="button"
        class="btn btn--accent"
        @click="exportAs('ttml')"
      >
        {{ text.exportTtml }}
      </button>
      <button
        type="button"
        class="btn btn--quiet"
        @click="closeSong"
      >
        {{ text.close }}
      </button>
    </header>
    <LyricsTimingEditor
      v-model:doc="doc"
      class="editor"
      :audio="audio"
      :load-audio-data="audioFile ? () => audioFile!.arrayBuffer() : undefined"
      :locale="locale"
    />
  </main>

  <main
    v-else
    class="app app--start"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <section class="hero">
      <p class="brand brand--big">
        <i />{{ text.title }}
      </p>
      <p class="tagline">
        {{ text.tagline }}
      </p>
    </section>

    <section class="slots">
      <label
        class="slot"
        :class="{ 'slot--filled': audioUrl }"
      >
        <span class="slot-index">01</span>
        <span class="slot-kind">{{ text.audio }}</span>
        <span class="slot-name">{{ audioUrl ? audioName : `${text.pick} · ${text.drop}` }}</span>
        <input
          type="file"
          accept="audio/*"
          @change="onFiles(($event.target as HTMLInputElement).files, 'audio')"
        >
      </label>
      <label
        class="slot"
        :class="{ 'slot--filled': doc }"
      >
        <span class="slot-index">02</span>
        <span class="slot-kind">{{ text.lyrics }}</span>
        <span class="slot-name">{{ doc ? lyricsName || '—' : `${text.pick} · ${text.drop}` }}</span>
        <input
          type="file"
          accept=".lrc,.ttml,.xml,.txt,text/*"
          @change="onFiles(($event.target as HTMLInputElement).files, 'lyrics')"
        >
      </label>
      <div class="paste">
        <textarea
          v-model="pasted"
          :placeholder="text.paste"
          spellcheck="false"
        />
        <button
          type="button"
          class="btn"
          :disabled="!pasted.trim()"
          @click="loadLyricsText(pasted, 'pasted.lrc')"
        >
          {{ text.usePaste }}
        </button>
      </div>
    </section>

    <p
      v-if="restored && !audioUrl"
      class="note"
    >
      {{ text.restored }}
    </p>
    <p
      v-if="error"
      class="note note--error"
      role="alert"
    >
      {{ error }}
    </p>

    <button
      type="button"
      class="btn btn--accent btn--big"
      :disabled="!ready"
      @click="editing = true"
    >
      {{ text.start }} →
    </button>
    <p class="privacy">
      {{ text.privacy }}
    </p>
  </main>
</template>

<style scoped>
.app {
  height: 100%;
}
.app--editing {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
.editor {
  min-height: 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.brand i {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft), 0 0 16px var(--accent);
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base);
  font-size: 0.8125rem;
}
.files {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files b {
  color: var(--accent);
  font-weight: 400;
}
.bar-error {
  color: #ff8a80;
  font-size: 0.75rem;
}

.btn {
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.btn--accent {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.btn--accent:hover:not(:disabled) {
  background: #d44d41;
}
.btn--quiet {
  border-color: transparent;
  background: none;
  color: var(--text-tertiary);
}
.btn--big {
  padding: 0.85rem 1.6rem;
  font-size: 1rem;
}

.app--start {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2rem;
  max-width: 56rem;
  margin: 0 auto;
  padding: 12vh 1.5rem 4rem;
  overflow-y: auto;
  background:
    radial-gradient(60rem 30rem at 85% -10%, rgba(232, 87, 74, 0.1), transparent 60%),
    repeating-linear-gradient(90deg, transparent 0 79px, rgba(255, 255, 255, 0.025) 79px 80px);
}
.brand--big {
  margin: 0;
  font-size: clamp(2rem, 6vw, 3.75rem);
  letter-spacing: -0.02em;
}
.brand--big i {
  width: 1.1rem;
  height: 1.1rem;
}
.tagline {
  max-width: 34rem;
  margin: 0.75rem 0 0;
  color: var(--text-tertiary);
  font-family: var(--font-sans);
  line-height: 1.7;
}

.slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  width: 100%;
}
.slot {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 1rem;
  padding: 1.25rem;
  border: 1px dashed var(--border-strong);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.015);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;
}
.slot:hover {
  border-color: var(--accent);
}
.slot--filled {
  border-style: solid;
  border-color: rgba(127, 209, 185, 0.45);
  background: rgba(127, 209, 185, 0.05);
}
.slot input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.slot-index {
  grid-row: 1 / 3;
  color: var(--accent);
  font-size: 1.75rem;
  line-height: 1;
}
.slot-kind {
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.slot-name {
  margin-top: 0.3rem;
  overflow: hidden;
  font-family: var(--font-sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.paste {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.5rem;
  justify-items: start;
}
.paste textarea {
  width: 100%;
  min-height: 7rem;
  padding: 0.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.75rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  resize: vertical;
  outline: none;
}
.paste textarea:focus {
  border-color: var(--accent);
}
.note {
  margin: 0;
  color: var(--text-tertiary);
  font-family: var(--font-sans);
}
.note--error {
  color: #ff8a80;
}
.privacy {
  margin: -1rem 0 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .slots {
    grid-template-columns: 1fr;
  }
  .files {
    display: none;
  }
}
</style>
