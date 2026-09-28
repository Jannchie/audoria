import type { ShortcutDefinition } from '../utils/shortcuts'
import type { PlayMode } from './usePlayerState'
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { createShortcutRegistry, isEditableTarget } from '../utils/shortcuts'
import { useConfirm } from './useConfirm'
import { useContextMenu } from './useContextMenu'
import { useInputPrompt } from './useInputPrompt'
import { usePlaybackControls } from './usePlaybackControls'
import { useQueuePanel } from './useQueuePanel'
import { useToast } from './useToast'

const seekStep = 5
const seekStepLong = 10
const volumeStep = 0.05

const isHelpOpen = ref(false)

/** State of the "?" shortcut reference overlay. */
export function useShortcutHelp() {
  return {
    close: () => {
      isHelpOpen.value = false
    },
    isOpen: isHelpOpen,
    open: () => {
      isHelpOpen.value = true
    },
    toggle: () => {
      isHelpOpen.value = !isHelpOpen.value
    },
  }
}

const contextMenu = useContextMenu()
const inputPrompt = useInputPrompt()
const confirmDialog = useConfirm()

function isOverlayOpen(): boolean {
  if (isHelpOpen.value || contextMenu.visible.value || inputPrompt.active.value || confirmDialog.active.value) {
    return true
  }
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null
}

/** App-wide shortcut registry. Pages may register extra shortcuts on it. */
export const shortcutRegistry = createShortcutRegistry({ isOverlayOpen })

const searchSelector = '[data-shortcut-search]'

function findSearchInput(): HTMLInputElement | null {
  const candidates = document.querySelectorAll<HTMLInputElement>(searchSelector)
  for (const input of candidates) {
    if (input.offsetParent !== null || input.getClientRects().length > 0) {
      return input
    }
  }
  return null
}

function blurActiveElement(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur()
    return true
  }
  return false
}

/**
 * Registers the global keyboard shortcuts and installs the single keydown
 * listener. Call once from App.vue.
 */
export function useKeyboardShortcuts(): void {
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const controls = usePlaybackControls()
  const queuePanel = useQueuePanel()
  const help = useShortcutHelp()
  const toast = useToast()

  function modeLabel(mode: PlayMode): string {
    const key = {
      'sequence': 'sequence',
      'repeat-all': 'repeatAll',
      'repeat-one': 'repeatOne',
      'shuffle': 'shuffle',
    }[mode]
    return t('player.playModeLabel', { mode: t(`player.playModes.${key}`) })
  }

  function announceVolume(value: number): void {
    const percent = Math.round(value * 100)
    toast.show({
      key: 'volume',
      message: percent === 0 ? t('feedback.muted') : t('feedback.volume', { percent }),
      icon: percent === 0 ? 'i-tabler-volume-off' : percent < 50 ? 'i-tabler-volume-2' : 'i-tabler-volume',
      duration: 1200,
    })
  }

  async function focusSearch(): Promise<void> {
    let input = findSearchInput()
    if (!input) {
      await router.push('/library')
      await nextTick()
      input = findSearchInput()
    }
    if (input) {
      input.focus()
      input.select()
    }
  }

  function togglePlayerPage(): void {
    if (route.path === '/player') {
      leavePlayerPage()
      return
    }
    router.push('/player')
  }

  function leavePlayerPage(): void {
    const back = (globalThis.history?.state as { back?: string | null } | null)?.back
    if (back) {
      router.back()
    }
    else {
      router.push('/library')
    }
  }

  function dismiss(event: { target?: unknown }): boolean {
    if (isHelpOpen.value) {
      help.close()
      return true
    }
    if (contextMenu.visible.value) {
      contextMenu.close()
      return true
    }
    if (confirmDialog.active.value) {
      confirmDialog.cancel()
      return true
    }
    if (inputPrompt.active.value) {
      inputPrompt.cancel()
      return true
    }
    if (queuePanel.isOpen.value) {
      queuePanel.close()
      return true
    }
    if (event.target instanceof HTMLElement && event.target.closest('[aria-modal="true"]')) {
      // Page-owned dialogs handle Escape themselves.
      return false
    }
    if (isEditableTarget(event.target) && blurActiveElement()) {
      return true
    }
    if (route.path === '/player') {
      leavePlayerPage()
      return true
    }
    return false
  }

  const definitions: ShortcutDefinition[] = [
    // ── Playback ──
    {
      id: 'toggle-play',
      group: 'playback',
      labelKey: 'shortcuts.actions.togglePlay',
      combos: ['space', 'k'],
      handler: () => controls.togglePlay(),
    },
    {
      id: 'seek-backward',
      group: 'playback',
      labelKey: 'shortcuts.actions.seekBackward',
      combos: ['arrowleft'],
      allowRepeat: true,
      handler: () => controls.seekBy(-seekStep),
    },
    {
      id: 'seek-forward',
      group: 'playback',
      labelKey: 'shortcuts.actions.seekForward',
      combos: ['arrowright'],
      allowRepeat: true,
      handler: () => controls.seekBy(seekStep),
    },
    {
      id: 'seek-backward-long',
      group: 'playback',
      labelKey: 'shortcuts.actions.seekBackwardLong',
      combos: ['shift+arrowleft'],
      allowRepeat: true,
      handler: () => controls.seekBy(-seekStepLong),
    },
    {
      id: 'seek-forward-long',
      group: 'playback',
      labelKey: 'shortcuts.actions.seekForwardLong',
      combos: ['shift+arrowright'],
      allowRepeat: true,
      handler: () => controls.seekBy(seekStepLong),
    },
    {
      id: 'seek-percent',
      group: 'playback',
      labelKey: 'shortcuts.actions.seekPercent',
      combos: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      display: [['0'], ['9']],
      handler: (event) => {
        const digit = Number(/^Digit(\d)$/.exec(event.code ?? '')?.[1] ?? event.key)
        return Number.isInteger(digit) && controls.seekToRatio(digit / 10)
      },
    },
    {
      id: 'previous-track',
      group: 'playback',
      labelKey: 'shortcuts.actions.previousTrack',
      combos: ['p', 'mod+arrowleft'],
      handler: () => controls.previous(),
    },
    {
      id: 'next-track',
      group: 'playback',
      labelKey: 'shortcuts.actions.nextTrack',
      combos: ['n', 'mod+arrowright'],
      handler: () => controls.next(),
    },
    {
      id: 'volume-up',
      group: 'playback',
      labelKey: 'shortcuts.actions.volumeUp',
      combos: ['arrowup'],
      allowRepeat: true,
      handler: () => announceVolume(controls.adjustVolume(volumeStep)),
    },
    {
      id: 'volume-down',
      group: 'playback',
      labelKey: 'shortcuts.actions.volumeDown',
      combos: ['arrowdown'],
      allowRepeat: true,
      handler: () => announceVolume(controls.adjustVolume(-volumeStep)),
    },
    {
      id: 'toggle-mute',
      group: 'playback',
      labelKey: 'shortcuts.actions.toggleMute',
      combos: ['m'],
      handler: () => {
        controls.toggleMute()
        if (controls.muted.value) {
          toast.show({ key: 'volume', message: t('feedback.muted'), icon: 'i-tabler-volume-off', duration: 1200 })
        }
        else {
          announceVolume(controls.volume.value)
        }
      },
    },
    {
      id: 'toggle-shuffle',
      group: 'playback',
      labelKey: 'shortcuts.actions.toggleShuffle',
      combos: ['s'],
      handler: () => {
        const mode = controls.toggleShuffle()
        toast.show({ key: 'play-mode', message: modeLabel(mode), icon: mode === 'shuffle' ? 'i-tabler-arrows-shuffle' : 'i-tabler-repeat' })
      },
    },
    {
      id: 'cycle-repeat',
      group: 'playback',
      labelKey: 'shortcuts.actions.cycleRepeat',
      combos: ['r'],
      handler: () => {
        const mode = controls.cycleRepeat()
        const icon = mode === 'repeat-one' ? 'i-tabler-repeat-once' : mode === 'sequence' ? 'i-tabler-list' : 'i-tabler-repeat'
        toast.show({ key: 'play-mode', message: modeLabel(mode), icon })
      },
    },

    // ── Navigation ──
    {
      id: 'toggle-player',
      group: 'navigation',
      labelKey: 'shortcuts.actions.togglePlayer',
      combos: ['l'],
      handler: togglePlayerPage,
    },
    {
      id: 'toggle-queue',
      group: 'navigation',
      labelKey: 'shortcuts.actions.toggleQueue',
      combos: ['q'],
      handler: () => queuePanel.toggle(),
    },
    {
      id: 'focus-search',
      group: 'navigation',
      labelKey: 'shortcuts.actions.focusSearch',
      combos: ['/', { keys: 'mod+k', allowInEditable: true }],
      handler: () => {
        void focusSearch()
      },
    },

    // ── General ──
    {
      id: 'show-help',
      group: 'general',
      labelKey: 'shortcuts.actions.showHelp',
      combos: ['?'],
      allowInOverlay: true,
      enabled: () => isHelpOpen.value || !isOverlayOpen(),
      handler: () => help.toggle(),
    },
    {
      id: 'dismiss',
      group: 'general',
      labelKey: 'shortcuts.actions.dismiss',
      combos: [{ keys: 'escape', allowInEditable: true }],
      allowInOverlay: true,
      handler: dismiss,
    },
  ]

  const unregister = shortcutRegistry.register(definitions)
  const stop = useEventListener(globalThis, 'keydown', (event: KeyboardEvent) => {
    shortcutRegistry.handle(event)
  })

  tryOnScopeDispose(() => {
    stop()
    unregister()
  })
}
