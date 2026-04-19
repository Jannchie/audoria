<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useUploadMusic } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const { t } = useI18n()
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
  return err instanceof Error ? err.message : t('upload.failed')
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
    formError.value = t('upload.chooseFile')
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
          aria-hidden="true"
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
          {{ t('upload.dropHint') }}
        </p>
        <p class="drop-formats">
          {{ t('upload.browseHint') }} · MP3, FLAC, WAV, OGG, AAC
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
        {{ isUploading ? t('common.actions.uploading') : t('common.actions.upload') }}
      </button>
    </label>

    <input
      id="file-input"
      ref="fileInputRef"
      accept="audio/*"
      class="sr-only"
      type="file"
      @change="handleFileChange"
    >

    <!-- Status toast -->
    <div
      v-if="formError || uploadErrorMessage"
      class="status-toast status-toast--error"
      role="alert"
      aria-live="assertive"
    >
      {{ formError || uploadErrorMessage }}
    </div>
    <div
      v-else-if="uploadSuccess"
      class="status-toast status-toast--success"
      role="status"
      aria-live="polite"
    >
      {{ t('upload.success') }}
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
  font-family: var(--font-display);
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
  font-family: var(--font-display);
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
  background: var(--danger-soft);
}

.status-toast--success {
  color: var(--success);
  background: var(--success-soft);
}
</style>
