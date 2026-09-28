/**
 * Framework-agnostic keyboard shortcut matching.
 *
 * Everything here works on plain event-like objects so it can be unit tested
 * without a DOM. `useKeyboardShortcuts` wires the registry to `window`.
 */

export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  target?: unknown
  preventDefault?: () => void
}

export interface KeyCombo {
  /** Normalized key: lowercase letters, `' '` for Space, `arrowleft`, `escape`, `?` ... */
  key: string
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Still fire while an input / textarea / contenteditable has focus. */
  allowInEditable: boolean
}

export type ComboInput = string | { keys: string, allowInEditable?: boolean }

export type ShortcutGroup = 'playback' | 'navigation' | 'general'

export interface ShortcutDefinition {
  id: string
  combos: ComboInput[]
  handler: (event: KeyEventLike) => void | boolean
  /** i18n key of the description shown in the help overlay. */
  labelKey?: string
  group?: ShortcutGroup
  /** Override the combos rendered in the help overlay (e.g. `[['0'], ['9']]`). */
  display?: string[][]
  /** Fire again while the key is held down. Defaults to false. */
  allowRepeat?: boolean
  /** Fire while a modal dialog or menu is open. Defaults to false. */
  allowInOverlay?: boolean
  enabled?: () => boolean
}

interface RegisteredShortcut extends ShortcutDefinition {
  parsed: KeyCombo[]
}

const keyAliases: Record<string, string> = {
  space: ' ',
  spacebar: ' ',
  esc: 'escape',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  slash: '/',
  question: '?',
  plus: '+',
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return keyAliases[lower] ?? lower
}

function isAlphanumeric(key: string): boolean {
  return /^[a-z0-9]$/.test(key)
}

/**
 * Symbols such as `?` or `/` sit on different (shifted or not) positions
 * depending on the keyboard layout, so Shift is ignored for them.
 */
function ignoresShift(key: string): boolean {
  return key.length === 1 && !isAlphanumeric(key) && key !== ' '
}

export function parseCombo(input: ComboInput): KeyCombo {
  const raw = typeof input === 'string' ? input : input.keys
  const allowInEditable = typeof input === 'string' ? false : Boolean(input.allowInEditable)
  // `+` itself can be a key ("mod++"), so split on "+" that is followed by something.
  const parts = raw === '+' ? ['+'] : raw.split(/\+(?=.)/)
  const combo: KeyCombo = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    allowInEditable,
  }
  for (const part of parts) {
    const token = part.trim().toLowerCase()
    switch (token) {
      case 'mod': { combo.mod = true; break }
      case 'ctrl':
      case 'control': { combo.ctrl = true; break }
      case 'meta':
      case 'cmd': { combo.meta = true; break }
      case 'alt':
      case 'option': { combo.alt = true; break }
      case 'shift': { combo.shift = true; break }
      default: { combo.key = normalizeKey(part.trim()) }
    }
  }
  if (!combo.key) {
    throw new Error(`Shortcut "${raw}" has no key`)
  }
  return combo
}

/**
 * Resolve the logical key of an event. Falls back to the physical `code`
 * when the layout produces a non-Latin character (e.g. Cyrillic, kana input),
 * so letter shortcuts keep working on those layouts.
 */
export function eventKey(event: KeyEventLike): string {
  const key = normalizeKey(event.key ?? '')
  const isAscii = key.length === 1 && key.charCodeAt(0) <= 0x7E
  if (key.length === 1 && !isAscii && event.code) {
    const match = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code)
    if (match) {
      return (match[1] ?? match[2]).toLowerCase()
    }
  }
  return key
}

export function matchesCombo(event: KeyEventLike, combo: KeyCombo): boolean {
  if (eventKey(event) !== combo.key) {
    return false
  }
  if (combo.mod) {
    if (!event.ctrlKey && !event.metaKey) {
      return false
    }
  }
  else if (event.ctrlKey !== combo.ctrl || event.metaKey !== combo.meta) {
    return false
  }
  if (event.altKey !== combo.alt) {
    return false
  }
  if (!ignoresShift(combo.key) && event.shiftKey !== combo.shift) {
    return false
  }
  return true
}

interface ElementLike {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
  closest?: (selector: string) => unknown
}

function asElement(target: unknown): ElementLike | null {
  if (!target || typeof target !== 'object' || !('tagName' in target)) {
    return null
  }
  return target as ElementLike
}

function attr(el: ElementLike, name: string): string | null {
  return el.getAttribute?.(name) ?? null
}

const nonTextInputTypes = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'])
const textRoles = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

/** True when typing into the target would produce text. */
export function isEditableTarget(target: unknown): boolean {
  const el = asElement(target)
  if (!el) {
    return false
  }
  const tag = el.tagName?.toLowerCase()
  if (tag === 'textarea' || tag === 'select') {
    return true
  }
  if (tag === 'input') {
    const type = (attr(el, 'type') ?? 'text').toLowerCase()
    return !nonTextInputTypes.has(type)
  }
  if (el.isContentEditable) {
    return true
  }
  const role = attr(el, 'role')
  return role !== null && textRoles.has(role)
}

const buttonLikeRoles = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'switch', 'radio', 'tab'])
const arrowWidgetRoles = new Set(['slider', 'listbox', 'menu', 'menubar', 'menuitem', 'option', 'radiogroup', 'tablist', 'tab', 'tree', 'grid', 'spinbutton'])

/**
 * Some keys already mean something on the focused element: Space/Enter
 * activate buttons and checkboxes, arrows move sliders and menus. In those
 * cases the element keeps the key instead of the global shortcut.
 */
export function targetOwnsKey(target: unknown, key: string): boolean {
  const el = asElement(target)
  if (!el) {
    return false
  }
  const tag = el.tagName?.toLowerCase()
  const role = attr(el, 'role')
  const type = (attr(el, 'type') ?? '').toLowerCase()

  if (key === ' ' || key === 'enter') {
    if (tag === 'button' || tag === 'summary') {
      return true
    }
    if (tag === 'input' && nonTextInputTypes.has(type) && type !== 'range') {
      return true
    }
    if (key === 'enter' && tag === 'a') {
      return true
    }
    return role !== null && buttonLikeRoles.has(role) && !(key === ' ' && role === 'link')
  }

  if (key.startsWith('arrow') || key === 'home' || key === 'end' || key === 'pageup' || key === 'pagedown') {
    if (tag === 'input' && (type === 'range' || type === 'radio')) {
      return true
    }
    if (role !== null && arrowWidgetRoles.has(role)) {
      return true
    }
  }
  return false
}

export function isInsideModal(target: unknown): boolean {
  const el = asElement(target)
  return Boolean(el?.closest?.('[aria-modal="true"]'))
}

export interface ShortcutRegistryOptions {
  /** A modal dialog or menu is open — only `allowInOverlay` shortcuts fire. */
  isOverlayOpen?: () => boolean
}

export interface ShortcutRegistry {
  register: (definitions: ShortcutDefinition[]) => () => void
  handle: (event: KeyEventLike) => boolean
  list: () => ShortcutDefinition[]
}

export function createShortcutRegistry(options: ShortcutRegistryOptions = {}): ShortcutRegistry {
  let entries: RegisteredShortcut[] = []

  function register(definitions: ShortcutDefinition[]): () => void {
    const added = definitions.map(definition => ({
      ...definition,
      parsed: definition.combos.map(parseCombo),
    }))
    entries = [...entries, ...added]
    return () => {
      entries = entries.filter(entry => !added.includes(entry))
    }
  }

  function handle(event: KeyEventLike): boolean {
    if (event.defaultPrevented || event.isComposing || event.key === 'Process' || event.key === 'Dead') {
      return false
    }
    const editable = isEditableTarget(event.target)
    const overlayOpen = Boolean(options.isOverlayOpen?.()) || isInsideModal(event.target)

    for (const entry of entries) {
      const combo = entry.parsed.find(candidate => matchesCombo(event, candidate))
      if (!combo) {
        continue
      }
      if (editable && !combo.allowInEditable) {
        continue
      }
      if (overlayOpen && !entry.allowInOverlay) {
        continue
      }
      if (!combo.mod && !combo.ctrl && !combo.meta && !combo.alt && targetOwnsKey(event.target, combo.key)) {
        continue
      }
      if (entry.enabled && !entry.enabled()) {
        continue
      }
      if (event.repeat && !entry.allowRepeat) {
        // Swallow auto-repeat so holding Space doesn't scroll the page.
        event.preventDefault?.()
        return true
      }
      if (entry.handler(event) === false) {
        continue
      }
      event.preventDefault?.()
      return true
    }
    return false
  }

  return {
    register,
    handle,
    list: () => entries.map(({ parsed: _parsed, ...definition }) => definition),
  }
}

export interface FormatOptions {
  isMac: boolean
  spaceLabel: string
}

const displayNames: Record<string, string> = {
  'arrowleft': '←',
  'arrowright': '→',
  'arrowup': '↑',
  'arrowdown': '↓',
  'escape': 'Esc',
  'enter': 'Enter',
  'home': 'Home',
  'end': 'End',
  'tab': 'Tab',
  '/': '/',
  '?': '?',
}

/** Render a combo as a list of key caps, e.g. `['Ctrl', 'K']` or `['⌘', 'K']`. */
export function formatCombo(input: ComboInput, options: FormatOptions): string[] {
  const combo = parseCombo(input)
  const caps: string[] = []
  if (combo.mod) {
    caps.push(options.isMac ? '⌘' : 'Ctrl')
  }
  if (combo.ctrl) {
    caps.push(options.isMac ? '⌃' : 'Ctrl')
  }
  if (combo.meta) {
    caps.push(options.isMac ? '⌘' : 'Win')
  }
  if (combo.alt) {
    caps.push(options.isMac ? '⌥' : 'Alt')
  }
  if (combo.shift) {
    caps.push(options.isMac ? '⇧' : 'Shift')
  }
  let keyLabel = displayNames[combo.key]
  if (!keyLabel) {
    keyLabel = combo.key === ' ' ? options.spaceLabel : combo.key.toUpperCase()
  }
  caps.push(keyLabel)
  return caps
}

export function detectMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
    ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}
