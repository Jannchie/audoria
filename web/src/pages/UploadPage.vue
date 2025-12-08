<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUploadMusic } from '../composables/useMusic'
import { usePlayerState } from '../composables/usePlayerState'

const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const formError = ref('')
const uploadMutation = useUploadMusic()
const { selectTrack } = usePlayerState()

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
  uploadMutation.reset()
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
    },
  })
}
</script>

<template>
  <section class="space-y-5">
    <div class="p-6 border border-slate-800 rounded-2xl bg-[#0c101a] flex gap-6 items-start justify-between">
      <div>
        <p class="text-xs text-slate-500 tracking-[0.25em] uppercase">
          Upload
        </p>
        <h2 class="text-3xl text-white font-semibold">
          Bring new stems into the room
        </h2>
        <p class="text-sm text-slate-400">
          Choose an audio file and it will land in Library and the player queue.
        </p>
      </div>
      <div class="text-sm text-slate-400 text-right">
        <p class="text-xs text-slate-500 tracking-[0.2em] uppercase">
          Status
        </p>
        <p class="text-white font-semibold">
          {{ isUploading ? 'Uploading…' : 'Ready' }}
        </p>
        <p v-if="uploadMutation.data.value" class="text-xs text-slate-500 mt-1">
          Last uploaded: {{ uploadMutation.data.value.filename }}
        </p>
      </div>
    </div>

    <div class="p-6 border border-slate-800 rounded-2xl bg-[#0c101a] space-y-4">
      <label
        class="text-slate-300 px-4 py-6 text-center border border-slate-700 rounded-xl border-dashed bg-slate-900/60 block cursor-pointer transition-colors hover:border-blue-500/80"
        for="file-input"
      >
        <div class="flex flex-col gap-2 items-center">
          <span class="i-tabler-cloud-upload text-3xl text-blue-400" />
          <p class="text-base text-white font-semibold">
            Drop or pick an audio file
          </p>
          <p class="text-sm text-slate-400">
            WAV, MP3, FLAC and more. The upload refreshes your library instantly.
          </p>
          <p class="text-xs text-slate-500">
            Selected: {{ selectedFile?.name ?? 'None' }}
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

      <div class="flex gap-3 items-center justify-between">
        <div class="text-sm text-slate-400">
          <p v-if="formError" class="text-amber-400">
            {{ formError }}
          </p>
          <p v-else-if="uploadErrorMessage" class="text-amber-400">
            {{ uploadErrorMessage }}
          </p>
          <p v-else>
            Select a file, then press upload. It will also become the active track.
          </p>
        </div>
        <button
          class="text-sm text-white font-medium px-4 py-2 border border-blue-500/70 rounded-lg bg-blue-500/10 inline-flex gap-2 items-center hover:bg-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="isUploading"
          type="button"
          @click="handleUpload"
        >
          <span class="i-tabler-upload" />
          {{ isUploading ? 'Uploading…' : 'Upload' }}
        </button>
      </div>
    </div>
  </section>
</template>
