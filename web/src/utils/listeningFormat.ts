import { translate } from '../i18n'

/** "3 h 25 min" / "25 min" / "40 s" in the current locale. */
export function formatListenedTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return translate('stats.time.hoursMinutes', { h: hours, m: minutes })
  }
  if (minutes > 0) {
    return translate('stats.time.minutes', { m: minutes })
  }
  return translate('stats.time.seconds', { s: seconds })
}

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 days ago" in the given locale; "just now" for less than a minute. */
export function formatRelativeTime(iso: string, locale: string, now = Date.now()): string {
  const diffSeconds = (Date.parse(iso) - now) / 1000
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(diffSeconds) >= size) {
      return formatter.format(Math.round(diffSeconds / size), unit)
    }
  }
  return formatter.format(0, 'second')
}
