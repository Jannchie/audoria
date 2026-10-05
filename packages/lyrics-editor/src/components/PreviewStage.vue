<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { lineAt } from '../core/index.js'
import { useSession, useStageKeys } from '../session.js'
import PreviewLine from './PreviewLine.vue'

const session = useSession()
const { doc, now, t } = session
const listEl = ref<HTMLElement | null>(null)

const translation = computed(() => doc.value.tracks.find(track => track.kind === 'translation'))
const activeIndex = computed(() => lineAt(doc.value, now.value))

function stateOf(index: number): 'past' | 'active' | 'future' {
  return index === activeIndex.value ? 'active' : index < activeIndex.value ? 'past' : 'future'
}

function refine(index: number): void {
  session.selectLine(index)
  session.stage.value = 'word'
}

function scrollToActive(behavior: ScrollBehavior): void {
  listEl.value?.querySelector('.pv-line--active')?.scrollIntoView({ block: 'center', behavior })
}

watch(activeIndex, async () => {
  await nextTick()
  scrollToActive('smooth')
})

// Space only plays and pauses here; there is nothing to mark.
useStageKeys(session, event => event.key === 'j' || event.key === 'k')

onMounted(() => {
  void nextTick(() => scrollToActive('auto'))
})
</script>

<template>
  <div class="pv">
    <p class="pv-hint">
      {{ t.previewHint }}
    </p>
    <div
      ref="listEl"
      class="pv-list"
    >
      <template
        v-for="(cue, i) in doc.cues"
        :key="cue.id"
      >
        <PreviewLine
          v-if="cue.words.length > 0"
          class="pv-line"
          :class="{ 'pv-line--active': i === activeIndex }"
          :cue="cue"
          :state="stateOf(i)"
          :translation="translation?.lines[cue.id]"
          @click="refine(i)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.pv {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
}
.pv-hint {
  margin: 0;
  padding: 0.7rem 1.25rem;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 0.8125rem;
}
.pv-list {
  max-width: 48rem;
  width: 100%;
  margin: 0 auto;
  padding: 35vh 1.5rem 45vh;
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(transparent, #000 20%, #000 75%, transparent);
}
</style>
