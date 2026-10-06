import { describe, expect, it } from 'vitest'
import { planChunks } from '../src/chunks'

describe('chunk planning', () => {
  for (const frames of [1, 100, 224, 225, 256, 257, 1000, 10_336]) {
    it(`tiles ${frames} frames without gaps or overlap`, () => {
      const plan = planChunks(frames, 256, 32)
      let next = 0
      for (const chunk of plan) {
        expect(chunk.keepStart).toBe(next)
        expect(chunk.keepStart).toBeGreaterThanOrEqual(chunk.start)
        expect(chunk.keepEnd).toBeLessThanOrEqual(chunk.start + 256)
        if (chunk.start > 0) {
          expect(chunk.keepStart - chunk.start).toBe(32)
        }
        next = chunk.keepEnd
      }
      expect(next).toBe(frames)
    })
  }
})
