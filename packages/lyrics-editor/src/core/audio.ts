/**
 * What the editor needs from whatever plays the song. Times are seconds, as on media elements;
 * an embedding app can back this with its own player instead of a separate audio element.
 */
export interface AudioSource {
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly playbackRate: number
  setPlaybackRate: (rate: number) => void
  play: () => Promise<void> | void
  pause: () => void
  seek: (seconds: number) => void
}

/** An AudioSource over a media element. */
export function mediaElementSource(element: HTMLMediaElement): AudioSource {
  return {
    get currentTime() {
      return element.currentTime
    },
    get duration() {
      return Number.isFinite(element.duration) ? element.duration : 0
    },
    get paused() {
      return element.paused
    },
    get playbackRate() {
      return element.playbackRate
    },
    setPlaybackRate: (rate: number) => {
      element.playbackRate = rate
    },
    play: () => element.play(),
    pause: () => element.pause(),
    seek: (seconds: number) => {
      element.currentTime = seconds
    },
  }
}
