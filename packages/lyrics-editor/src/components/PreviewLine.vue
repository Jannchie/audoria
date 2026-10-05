<script setup lang="ts">
import type { LyricsCue } from '@audoria/lyrics-core'
import { isWordTimedCue, layoutLine, rubyRuns } from '@audoria/lyrics-core'
import { computed } from 'vue'

const props = defineProps<{
  cue: LyricsCue
  state: 'past' | 'active' | 'future'
  /** Playback time in ms; only the active line follows it. */
  time: number
  translation?: string
}>()

const chunks = computed(() => layoutLine(props.cue.words, rubyRuns(props.cue).map(run => ({ text: run.text, ruby: run.reading }))))
const wordTimed = computed(() => isWordTimedCue(props.cue))

function progress(begin?: number, end?: number): number {
  if (props.state === 'past' || (props.state === 'active' && !wordTimed.value)) {
    return 1
  }
  if (props.state === 'future' || begin === undefined || end === undefined) {
    return 0
  }
  return Math.min(1, Math.max(0, (props.time - begin) / Math.max(1, end - begin)))
}
</script>

<template>
  <div
    class="pl"
    :class="`pl--${state}`"
  >
    <p class="pl-text">
      <template
        v-for="chunk in chunks"
        :key="chunk.index"
      >
        <ruby v-if="'ruby' in chunk.segment && chunk.segment.ruby"><span
          v-for="(piece, k) in chunk.pieces"
          :key="k"
          class="pl-piece"
          :style="{ '--p': progress(piece.begin, piece.end) }"
        >{{ piece.text }}</span><rt
          class="pl-piece"
          :style="{ '--p': progress(chunk.begin, chunk.end) }"
        >{{ chunk.segment.ruby }}</rt></ruby>
        <template v-else>
          <span
            v-for="(piece, k) in chunk.pieces"
            :key="k"
            class="pl-piece"
            :style="{ '--p': progress(piece.begin, piece.end) }"
          >{{ piece.text }}</span>
        </template>
      </template>
    </p>
    <p
      v-if="cue.background?.length"
      class="pl-background"
    >
      <span
        v-for="(word, k) in cue.background"
        :key="k"
        class="pl-piece"
        :style="{ '--p': progress(word.begin, word.end) }"
      >{{ word.text }}</span>
    </p>
    <p
      v-if="translation"
      class="pl-translation"
    >
      {{ translation }}
    </p>
  </div>
</template>

<style scoped>
.pl {
  padding: 0.55rem 0.75rem;
  border-radius: var(--lte-radius);
  cursor: pointer;
  transition: opacity 300ms ease, transform 300ms ease;
}
.pl:hover {
  background: rgba(255, 255, 255, 0.03);
}
.pl--past,
.pl--future {
  opacity: 0.45;
}
.pl--active {
  transform: scale(1.04);
  transform-origin: left center;
}
.pl-text {
  margin: 0;
  font-family: var(--lte-sans);
  font-size: 1.65rem;
  font-weight: 600;
  line-height: 1.6;
}
.pl-piece {
  background-image: linear-gradient(
    90deg,
    var(--lte-text) calc(var(--p, 0) * (100% + 0.5em) - 0.5em),
    rgba(255, 255, 255, 0.32) calc(var(--p, 0) * (100% + 0.5em))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
rt {
  font-size: 0.45em;
  font-weight: 500;
}
.pl-background {
  margin: 0;
  font-family: var(--lte-sans);
  font-size: 1.05rem;
  opacity: 0.8;
}
.pl-translation {
  margin: 0.1rem 0 0;
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 1rem;
}
</style>
