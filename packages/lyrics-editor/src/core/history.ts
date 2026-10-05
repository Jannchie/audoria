/**
 * Undo and redo over immutable states: every edit records the new state, and undo steps back.
 * Consecutive records with the same `group` (a run of nudges, say) merge into one step.
 */
export class History<T> {
  private past: T[] = []
  private future: T[] = []
  private lastGroup: string | undefined

  constructor(public present: T, private readonly limit = 200) {}

  record(state: T, group?: string): void {
    if (state === this.present) {
      return
    }
    if (group === undefined || group !== this.lastGroup) {
      this.past.push(this.present)
      if (this.past.length > this.limit) {
        this.past.shift()
      }
    }
    this.present = state
    this.future = []
    this.lastGroup = group
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  undo(): T {
    const previous = this.past.pop()
    if (previous !== undefined) {
      this.future.push(this.present)
      this.present = previous
    }
    this.lastGroup = undefined
    return this.present
  }

  redo(): T {
    const next = this.future.pop()
    if (next !== undefined) {
      this.past.push(this.present)
      this.present = next
    }
    this.lastGroup = undefined
    return this.present
  }

  /** Starts over from `state`, forgetting all steps. */
  reset(state: T): void {
    this.present = state
    this.past = []
    this.future = []
    this.lastGroup = undefined
  }
}
