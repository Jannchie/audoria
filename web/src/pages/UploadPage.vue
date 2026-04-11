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
  if (err instanceof Error) {
    return err.message
  }
  return 'Failed to upload. Please retry.'
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
  <section class="mx-auto max-w-md space-y-5">
    <header>
      <h1 class="text-xl tracking-tight font-bold text-heading">
        Upload
      </h1>
      <p class="text-[12px] text-[var(--text-tertiary)] mt-0.5">
        Add new tracks to your library
      </p>
    </header>

    <!-- Drop zone -->
    <label
      class="px-5 py-12 text-center rounded-xl flex flex-col gap-3 cursor-pointer transition-colors items-center justify-center"
      :class="isDragOver
        ? 'bg-[var(--accent-soft)]'
        : selectedFile
          ? 'bg-[var(--bg-surface)]'
          : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]'"
      for="file-input"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="handleDrop"
    >
      <div
        class="rounded-lg bg-[var(--bg-elevated)] flex h-12 w-12 transition-colors items-center justify-center"
        :class="isDragOver ? 'text-[var(--accent)]' : selectedFile ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'"
      >
        <span
          class="text-xl"
          :class="selectedFile ? 'i-tabler-music' : 'i-tabler-cloud-upload'"
        />
      </div>

      <div>
        <p
          v-if="selectedFile"
          class="text-[13px] font-medium text-heading"
        >
          {{ selectedFile.name }}
        </p>
        <p
          v-else
          class="text-[13px] text-[var(--text-secondary)]"
        >
          Drop audio file here or click to browse
        </p>
        <p
          v-if="selectedFile"
          class="text-[11px] text-[var(--text-tertiary)] mt-0.5"
        >
          {{ formatFileSize(selectedFile.size) }}
        </p>
        <p
          v-else
          class="text-[11px] text-[var(--text-tertiary)] mt-0.5"
        >
          MP3, WAV, FLAC, OGG, AAC
        </p>
      </div>
    </label>

    <input
      id="file-input"
      ref="fileInputRef"
      accept="audio/*"
      class="hidden"
      type="file"
      @change="handleFileChange"
    >

    <!-- Status -->
    <div
      v-if="formError"
      class="text-[12px] text-[var(--danger)] px-3 py-2 rounded-lg bg-[var(--danger)]/8"
    >
      {{ formError }}
    </div>
    <div
      v-else-if="uploadErrorMessage"
      class="text-[12px] text-[var(--danger)] px-3 py-2 rounded-lg bg-[var(--danger)]/8"
    >
      {{ uploadErrorMessage }}
    </div>
    <div
      v-else-if="uploadSuccess"
      class="text-[12px] text-[var(--success)] px-3 py-2 rounded-lg bg-[var(--success)]/8"
    >
      Upload successful! Redirecting...
    </div>

    <!-- Upload button -->
    <button
      class="text-[13px] font-semibold text-heading rounded-lg flex gap-1.5 h-10 w-full transition-colors items-center justify-center"
      :class="selectedFile && !isUploading
        ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
        : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-not-allowed'"
      :disabled="isUploading || !selectedFile"
      type="button"
      @click="handleUpload"
    >
      <span
        class="text-base"
        :class="isUploading ? 'i-tabler-loader-2 animate-spin' : 'i-tabler-upload'"
      />
      {{ isUploading ? 'Uploading...' : 'Upload Track' }}
    </button>
  </section>
</template>
