// What a host needs to embed the editor. The editing core (commands, history, waveform) is
// available on its own from `@audoria/lyrics-editor/core`.
export type { AudioSource, SaveCheck } from './core/index.js'
export { mediaElementSource, prepareSave } from './core/index.js'
export { default as LyricsTimingEditor } from './LyricsTimingEditor.vue'
export type { EditorLocale } from './messages.js'
export { toEditorLocale } from './messages.js'
export type { Stage, VocalsStore } from './session.js'
