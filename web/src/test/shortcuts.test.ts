import type { KeyEventLike, ShortcutDefinition } from '../utils/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import {
  createShortcutRegistry,
  eventKey,
  formatCombo,
  isEditableTarget,
  isInsideModal,
  matchesCombo,
  parseCombo,
  targetOwnsKey,
} from '../utils/shortcuts'

interface FakeElementInit {
  tagName: string
  attrs?: Record<string, string>
  isContentEditable?: boolean
  modal?: boolean
}

function el({ tagName, attrs = {}, isContentEditable = false, modal = false }: FakeElementInit) {
  return {
    tagName: tagName.toUpperCase(),
    isContentEditable,
    getAttribute: (name: string) => attrs[name] ?? null,
    closest: (selector: string) => (modal && selector.includes('aria-modal') ? {} : null),
  }
}

const body = el({ tagName: 'body' })

function key(keyValue: string, init: Partial<KeyEventLike> = {}) {
  const preventDefault = vi.fn<() => void>()
  return {
    key: keyValue,
    code: undefined,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: body,
    ...init,
    preventDefault,
  } satisfies KeyEventLike
}

describe('parsecombo', () => {
  it('parses modifiers and normalizes key names', () => {
    expect(parseCombo('mod+k')).toMatchObject({ key: 'k', mod: true, shift: false })
    expect(parseCombo('Shift+ArrowLeft')).toMatchObject({ key: 'arrowleft', shift: true })
    expect(parseCombo('space').key).toBe(' ')
    expect(parseCombo('esc').key).toBe('escape')
    expect(parseCombo('?').key).toBe('?')
    expect(parseCombo({ keys: 'escape', allowInEditable: true }).allowInEditable).toBe(true)
  })

  it('rejects combos without a key', () => {
    expect(() => parseCombo('shift')).toThrow()
  })
})

describe('matchescombo', () => {
  it('requires modifiers to match exactly', () => {
    const r = parseCombo('r')
    expect(matchesCombo(key('r'), r)).toBe(true)
    // Ctrl+R (reload) and Alt+R must not be hijacked by the plain "r" shortcut.
    expect(matchesCombo(key('r', { ctrlKey: true }), r)).toBe(false)
    expect(matchesCombo(key('r', { metaKey: true }), r)).toBe(false)
    expect(matchesCombo(key('r', { altKey: true }), r)).toBe(false)
  })

  it('treats mod as ctrl or cmd', () => {
    const modK = parseCombo('mod+k')
    expect(matchesCombo(key('k', { ctrlKey: true }), modK)).toBe(true)
    expect(matchesCombo(key('k', { metaKey: true }), modK)).toBe(true)
    expect(matchesCombo(key('k'), modK)).toBe(false)
    expect(matchesCombo(key('k', { ctrlKey: true, altKey: true }), modK)).toBe(false)
  })

  it('distinguishes shift for letters and arrows', () => {
    expect(matchesCombo(key('N', { shiftKey: true }), parseCombo('n'))).toBe(false)
    expect(matchesCombo(key('N', { shiftKey: true }), parseCombo('shift+n'))).toBe(true)
    expect(matchesCombo(key('ArrowLeft', { shiftKey: true }), parseCombo('arrowleft'))).toBe(false)
    expect(matchesCombo(key('ArrowLeft', { shiftKey: true }), parseCombo('shift+arrowleft'))).toBe(true)
  })

  it('ignores shift for layout-dependent symbols', () => {
    // "?" needs Shift on US layouts but the combo is written without it.
    expect(matchesCombo(key('?', { shiftKey: true }), parseCombo('?'))).toBe(true)
    expect(matchesCombo(key('/'), parseCombo('/'))).toBe(true)
  })

  it('falls back to the physical key on non-latin layouts', () => {
    expect(eventKey(key('м', { code: 'KeyV' }))).toBe('v')
    expect(matchesCombo(key('ь', { code: 'KeyM' }), parseCombo('m'))).toBe(true)
    // Latin layouts keep using the logical key (e.g. Dvorak).
    expect(eventKey(key('k', { code: 'KeyV' }))).toBe('k')
  })
})

describe('target guards', () => {
  it('detects editable targets', () => {
    expect(isEditableTarget(el({ tagName: 'input' }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'input', attrs: { type: 'search' } }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'textarea' }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'select' }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'div', isContentEditable: true }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'div', attrs: { role: 'textbox' } }))).toBe(true)
    expect(isEditableTarget(el({ tagName: 'input', attrs: { type: 'range' } }))).toBe(false)
    expect(isEditableTarget(el({ tagName: 'input', attrs: { type: 'checkbox' } }))).toBe(false)
    expect(isEditableTarget(el({ tagName: 'button' }))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget({})).toBe(false)
  })

  it('lets focused widgets keep their native keys', () => {
    expect(targetOwnsKey(el({ tagName: 'button' }), ' ')).toBe(true)
    expect(targetOwnsKey(el({ tagName: 'div', attrs: { role: 'button' } }), ' ')).toBe(true)
    expect(targetOwnsKey(el({ tagName: 'a', attrs: { href: '/x' } }), ' ')).toBe(false)
    expect(targetOwnsKey(el({ tagName: 'div', attrs: { role: 'slider' } }), 'arrowleft')).toBe(true)
    expect(targetOwnsKey(el({ tagName: 'input', attrs: { type: 'range' } }), 'arrowup')).toBe(true)
    expect(targetOwnsKey(el({ tagName: 'button' }), 'arrowleft')).toBe(false)
    expect(targetOwnsKey(body, ' ')).toBe(false)
  })

  it('detects targets inside modal dialogs', () => {
    expect(isInsideModal(el({ tagName: 'button', modal: true }))).toBe(true)
    expect(isInsideModal(el({ tagName: 'button' }))).toBe(false)
  })
})

function setup(definitions: Partial<ShortcutDefinition>[], overlay = false) {
  const registry = createShortcutRegistry({ isOverlayOpen: () => overlay })
  const handlers = definitions.map(() => vi.fn())
  registry.register(definitions.map((definition, index) => ({
    id: `s${index}`,
    combos: ['k'],
    handler: handlers[index],
    ...definition,
  })))
  return { registry, handlers }
}

describe('shortcut registry', () => {
  it('runs the matching handler and prevents the default action', () => {
    const { registry, handlers } = setup([{ combos: ['space'] }])
    const event = key(' ')
    expect(registry.handle(event)).toBe(true)
    expect(handlers[0]).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('does not fire while typing in an input', () => {
    const { registry, handlers } = setup([{ combos: ['space'] }, { combos: ['/'] }])
    const input = el({ tagName: 'input' })
    const space = key(' ', { target: input })
    expect(registry.handle(space)).toBe(false)
    expect(registry.handle(key('/', { target: input }))).toBe(false)
    expect(handlers[0]).not.toHaveBeenCalled()
    expect(handlers[1]).not.toHaveBeenCalled()
    expect(space.preventDefault).not.toHaveBeenCalled()
  })

  it('fires in inputs only for combos that opt in', () => {
    const { registry, handlers } = setup([{ combos: [{ keys: 'mod+k', allowInEditable: true }, '/'] }])
    const input = el({ tagName: 'textarea' })
    expect(registry.handle(key('/', { target: input }))).toBe(false)
    expect(registry.handle(key('k', { target: input, ctrlKey: true }))).toBe(true)
    expect(handlers[0]).toHaveBeenCalledOnce()
  })

  it('leaves space to a focused button', () => {
    const { registry, handlers } = setup([{ combos: ['space'] }])
    expect(registry.handle(key(' ', { target: el({ tagName: 'button' }) }))).toBe(false)
    expect(handlers[0]).not.toHaveBeenCalled()
  })

  it('skips events already handled or mid-composition', () => {
    const { registry, handlers } = setup([{}])
    expect(registry.handle(key('k', { defaultPrevented: true }))).toBe(false)
    expect(registry.handle(key('k', { isComposing: true }))).toBe(false)
    expect(registry.handle(key('Process'))).toBe(false)
    expect(handlers[0]).not.toHaveBeenCalled()
  })

  it('swallows auto-repeat unless the shortcut allows it', () => {
    const { registry, handlers } = setup([{ combos: ['space'] }, { combos: ['arrowup'], allowRepeat: true }])
    const held = key(' ', { repeat: true })
    expect(registry.handle(held)).toBe(true)
    expect(held.preventDefault).toHaveBeenCalled()
    expect(handlers[0]).not.toHaveBeenCalled()

    expect(registry.handle(key('ArrowUp', { repeat: true }))).toBe(true)
    expect(handlers[1]).toHaveBeenCalledOnce()
  })

  it('only runs overlay-safe shortcuts while a dialog is open', () => {
    const { registry, handlers } = setup([{ combos: ['space'] }, { combos: ['escape'], allowInOverlay: true }], true)
    expect(registry.handle(key(' '))).toBe(false)
    expect(registry.handle(key('Escape'))).toBe(true)
    expect(handlers[0]).not.toHaveBeenCalled()
    expect(handlers[1]).toHaveBeenCalledOnce()
  })

  it('treats focus inside an aria-modal element as an open overlay', () => {
    const registry = createShortcutRegistry()
    const handler = vi.fn()
    registry.register([{ id: 'mute', combos: ['m'], handler }])
    expect(registry.handle(key('m', { target: el({ tagName: 'div', modal: true }) }))).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not prevent the default when a handler declines', () => {
    const registry = createShortcutRegistry()
    registry.register([{ id: 'play', combos: ['space'], handler: () => false }])
    const event = key(' ')
    expect(registry.handle(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('respects enabled() and unregister', () => {
    let enabled = false
    const registry = createShortcutRegistry()
    const handler = vi.fn()
    const unregister = registry.register([{ id: 'x', combos: ['x'], handler, enabled: () => enabled }])
    expect(registry.handle(key('x'))).toBe(false)
    enabled = true
    expect(registry.handle(key('x'))).toBe(true)
    unregister()
    expect(registry.handle(key('x'))).toBe(false)
    expect(registry.list()).toHaveLength(0)
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('formatcombo', () => {
  it('renders platform-specific key caps', () => {
    expect(formatCombo('mod+k', { isMac: false, spaceLabel: 'Space' })).toEqual(['Ctrl', 'K'])
    expect(formatCombo('mod+k', { isMac: true, spaceLabel: 'Space' })).toEqual(['⌘', 'K'])
    expect(formatCombo('shift+arrowleft', { isMac: false, spaceLabel: 'Space' })).toEqual(['Shift', '←'])
    expect(formatCombo('space', { isMac: false, spaceLabel: '空格' })).toEqual(['空格'])
    expect(formatCombo({ keys: 'escape', allowInEditable: true }, { isMac: false, spaceLabel: 'Space' })).toEqual(['Esc'])
  })
})
