<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadMusic } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const router = useRouter()
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const formError = ref('')
const isDragOver = ref(false)
const uploadSuccess = ref(false)
const uploadMutation = useUploadMusic()
const { selectTrack, setPlaying } = usePlayerState()

const isUploading = computed<boolean>(() => uploadMutation.isPending.value)

const uploadErrorMessage = computed(() => {
  const err = uploadMutation.error.value
  if (!err) {
    return ''
  }
  return err instanceof Error ? err.message : 'Failed to upload. Please retry.'
})

function handleFileChange(event: Event): void {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0] ?? null
  selectedFile.value = file
  formError.value = ''
  uploadSuccess.value = false
  uploadMutation.reset()
}

function handleDrop(event: DragEvent): void {
  isDragOver.value = false
  const file = event.dataTransfer?.files?.[0] ?? null
  if (file) {
    selectedFile.value = file
    formError.value = ''
    uploadSuccess.value = false
    uploadMutation.reset()
  }
}

function handleUpload(): void {
  const file = selectedFile.value ?? fileInputRef.value?.files?.[0] ?? null
  if (!file) {
    formError.value = 'Please choose a file to upload.'
    return
  }
  formError.value = ''
  uploadMutation.mutate(file, {
    onSuccess: (created) => {
      selectedFile.value = null
      if (fileInputRef.value) {
        fileInputRef.value.value = ''
      }
      selectTrack(created.id)
      setPlaying(true)
      uploadSuccess.value = true
      setTimeout(() => {
        router.push('/library')
      }, 1200)
    },
  })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <section class="upload-page">
    <label
      class="drop-zone"
      :class="{
        'drop-zone--over': isDragOver,
        'drop-zone--selected': selectedFile && !isDragOver,
      }"
      for="file-input"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="handleDrop"
    >
      <div class="drop-icon">
        <span
          class="text-3xl"
          :class="selectedFile ? 'i-tabler-music' : isDragOver ? 'i-tabler-upload' : 'i-tabler-cloud-upload'"
        />
      </div>

      <div
        v-if="selectedFile"
        class="drop-info"
      >
        <p class="drop-filename">
          {{ selectedFile.name }}
        </p>
        <p class="drop-filesize">
          {{ formatFileSize(selectedFile.size) }}
        </p>
      </div>
      <div
        v-else
        class="drop-info"
      >
        <p class="drop-hint">
          Drop audio files here
        </p>
        <p class="drop-formats">
          or tap to browse · MP3, FLAC, WAV, OGG, AAC
        </p>
      </div>

      <!-- Upload button inside drop zone -->
      <button
        v-if="selectedFile"
        class="upload-btn"
        :class="{ 'upload-btn--disabled': isUploading }"
        :disabled="isUploading"
        type="button"
        @click.prevent="handleUpload"
      >
        <span
          class="text-base"
          :class="isUploading ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-upload'"
        />
        {{ isUploading ? 'Uploading...' : 'Upload' }}
      </button>
    </label>

    <input
      id="file-input"
      ref="fileInputRef"
      accept="audio/*"
      class="hidden"
      type="file"
      @change="handleFileChange"
    >

    <!-- Status toast -->
    <div
      v-if="formError || uploadErrorMessage"
      class="status-toast status-toast--error"
    >
      {{ formError || uploadErrorMessage }}
    </div>
    <div
      v-else-if="uploadSuccess"
      class="status-toast status-toast--success"
    >
      Upload successful!
    </div>
  </section>
</template>

<style scoped>
.upload-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 14rem);
  padding: 2rem 0;
}

@media (min-width: 768px) {
  .upload-page {
    min-height: calc(100vh - 12rem);
  }
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  width: 100%;
  max-width: 400px;
  padding: 3rem 2rem;
  border-radius: 1.5rem;
  border: 2px dashed var(--bg-elevated);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}

.drop-zone:hover {
  border-color: var(--bg-hover);
  background: var(--bg-surface);
}

.drop-zone--over {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.drop-zone--selected {
  border-color: var(--accent);
  border-style: solid;
  background: var(--bg-surface);
}

.drop-icon {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: all 0.2s ease;
}

.drop-zone--over .drop-icon,
.drop-zone--selected .drop-icon {
  background: var(--accent-soft);
  color: var(--accent);
}

.drop-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.drop-filename {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
}

.drop-filesize {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.drop-hint {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.drop-formats {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 2.75rem;
  padding: 0 1.5rem;
  border-radius: 1.375rem;
  background: var(--accent);
  color: white;
  font-size: 0.8125rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: 'Outfit', 'DM Sans', system-ui, sans-serif;
}

.upload-btn:hover {
  background: var(--accent-hover);
}

.upload-btn--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.status-toast {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  border-radius: 0.75rem;
  font-size: 0.75rem;
}

.status-toast--error {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
}

.status-toast--success {
  color: var(--success);
  background: rgba(52, 211, 153, 0.08);
}
</style>
