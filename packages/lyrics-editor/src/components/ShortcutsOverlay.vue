<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '../session.js'

const emit = defineEmits<{ close: [] }>()
const { t } = useSession()

const groups = computed(() => [
  {
    title: t.value.keysGlobal,
    keys: [
      [['Space', 'P'], t.value.keyPlay],
      [['1', '2', '3'], t.value.keyStages],
      [['Shift', '←', '→'], t.value.keySeek],
      [['-', '='], t.value.keyRate],
      [['Ctrl', 'Z', 'Y'], t.value.keyUndo],
      [['?'], t.value.keyHelp],
    ],
  },
  {
    title: t.value.keysLine,
    keys: [
      [['Space'], t.value.keyLineTap],
      [['⌫'], t.value.keyLineUndo],
      [['↑', '↓'], t.value.keyLineMove],
      [['A', 'D'], t.value.keyLineNudge],
      [['R'], t.value.keyLineReplay],
    ],
  },
  {
    title: t.value.keysWord,
    keys: [
      [['Space', 'J'], t.value.keyWordTap],
      [['K'], t.value.keyWordEnd],
      [['←', '→', '↑', '↓'], t.value.keyWordMove],
      [['A', 'D'], t.value.keyWordNudgeBegin],
      [['Z', 'C'], t.value.keyWordNudgeEnd],
      [['L'], t.value.keyWordMode],
      [['R'], t.value.keyWordReplay],
      [['M'], t.value.keyWordMerge],
      [['⌫'], t.value.keyWordClear],
    ],
  },
] as Array<{ title: string, keys: Array<[string[], string]> }>)
</script>

<template>
  <div
    class="so"
    @click.self="emit('close')"
  >
    <section
      class="so-card"
      role="dialog"
      :aria-label="t.shortcuts"
    >
      <header class="so-head">
        <h2>{{ t.shortcuts }}</h2>
        <button
          type="button"
          class="so-close"
          :aria-label="t.close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>
      <div class="so-groups">
        <dl
          v-for="group in groups"
          :key="group.title"
          class="so-group"
        >
          <dt class="so-title">
            {{ group.title }}
          </dt>
          <div
            v-for="[keys, label] in group.keys"
            :key="label"
            class="so-row"
          >
            <dt>
              <kbd
                v-for="key in keys"
                :key="key"
              >{{ key }}</kbd>
            </dt>
            <dd>{{ label }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>

<style scoped>
.so {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  animation: so-in 160ms ease-out;
}
@keyframes so-in {
  from {
    opacity: 0;
  }
}
.so-card {
  width: min(58rem, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 1.25rem 1.5rem 1.5rem;
  border: 1px solid var(--lte-line-strong);
  border-radius: 0.75rem;
  background: var(--lte-panel);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}
.so-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.so-head h2 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.so-close {
  border: none;
  background: none;
  color: var(--lte-muted);
}
.so-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1.5rem;
}
.so-group {
  display: grid;
  align-content: start;
  gap: 0.45rem;
  margin: 0;
}
.so-title {
  margin-bottom: 0.25rem;
  color: var(--lte-accent);
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.so-row {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  gap: 0.6rem;
  align-items: center;
}
.so-row dt,
.so-row dd {
  margin: 0;
}
.so-row dd {
  color: var(--lte-muted);
  font-family: var(--lte-sans);
  font-size: 0.8125rem;
}
kbd {
  display: inline-block;
  min-width: 1.4rem;
  margin: 0 0.2rem 0.15rem 0;
  padding: 0.05rem 0.3rem;
  border: 1px solid var(--lte-line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-size: 0.6875rem;
  text-align: center;
}
</style>
