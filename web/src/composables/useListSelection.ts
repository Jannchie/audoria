import { computed, ref } from 'vue'

/**
 * Selection model for list views: supports Ctrl/Cmd toggle and Shift range.
 * Pass a reactive getter that returns the current ordered list of ids.
 */
export function useListSelection(getIds: () => string[]) {
  const selected = ref<Set<string>>(new Set())
  const anchorId = ref<string | null>(null)

  const size = computed(() => selected.value.size)
  const hasSelection = computed(() => selected.value.size > 0)

  function isSelected(id: string): boolean {
    return selected.value.has(id)
  }

  function clear(): void {
    if (selected.value.size === 0) {
      return
    }
    selected.value = new Set()
    anchorId.value = null
  }

  function replace(ids: string[]): void {
    selected.value = new Set(ids)
    anchorId.value = ids.at(-1) ?? null
  }

  function toggle(id: string): void {
    const next = new Set(selected.value)
    if (next.has(id)) {
      next.delete(id)
    }
    else {
      next.add(id)
    }
    selected.value = next
    anchorId.value = id
  }

  function selectOne(id: string): void {
    selected.value = new Set([id])
    anchorId.value = id
  }

  function rangeSelect(id: string): void {
    const ids = getIds()
    const to = ids.indexOf(id)
    if (to === -1) {
      return
    }
    const from = anchorId.value ? ids.indexOf(anchorId.value) : -1
    if (from === -1) {
      selectOne(id)
      return
    }
    const [start, end] = from < to ? [from, to] : [to, from]
    selected.value = new Set(ids.slice(start, end + 1))
  }

  function handleClick(id: string, event: MouseEvent): { handled: boolean } {
    if (event.shiftKey) {
      rangeSelect(id)
      return { handled: true }
    }
    if (event.ctrlKey || event.metaKey) {
      toggle(id)
      return { handled: true }
    }
    return { handled: false }
  }

  function prune(availableIds: Set<string>): void {
    if (selected.value.size === 0) {
      return
    }
    let changed = false
    const next = new Set<string>()
    for (const id of selected.value) {
      if (availableIds.has(id)) {
        next.add(id)
      }
      else {
        changed = true
      }
    }
    if (changed) {
      selected.value = next
      if (anchorId.value && !availableIds.has(anchorId.value)) {
        anchorId.value = null
      }
    }
  }

  function toArray(): string[] {
    const ids = getIds()
    return ids.filter(id => selected.value.has(id))
  }

  return {
    anchorId,
    clear,
    handleClick,
    hasSelection,
    isSelected,
    prune,
    rangeSelect,
    replace,
    selectOne,
    selected,
    size,
    toArray,
    toggle,
  }
}
