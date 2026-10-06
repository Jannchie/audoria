export interface ChunkPlan {
  /** First frame fed to the model. */
  start: number
  /** Frames [keepStart, keepEnd) of this chunk's output are used. */
  keepStart: number
  keepEnd: number
}

/**
 * Splits `frames` STFT frames into model windows of `dimT` frames. Each window drops
 * `margin` frames on both sides (the model sees little context there), except at the
 * song edges, so consecutive kept ranges tile the song exactly.
 */
export function planChunks(frames: number, dimT: number, margin: number): ChunkPlan[] {
  if (dimT - 2 * margin <= 0) {
    throw new Error(`margin ${margin} leaves nothing of a ${dimT}-frame window`)
  }
  const plan: ChunkPlan[] = []
  let done = 0
  while (done < frames) {
    const start = done === 0 ? 0 : done - margin
    const end = start + dimT
    const keepEnd = end >= frames ? frames : end - margin
    plan.push({ start, keepStart: done, keepEnd })
    done = keepEnd
  }
  return plan
}

export function toDb(energy: number): number {
  return 10 * Math.log10(energy + 1e-10)
}
