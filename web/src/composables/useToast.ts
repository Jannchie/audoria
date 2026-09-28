import { ref } from 'vue'

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastOptions {
  message: string
  icon?: string
  tone?: ToastTone
  /** Toasts with the same key replace each other instead of stacking (e.g. volume). */
  key?: string
  duration?: number
}

export interface Toast extends Required<Pick<ToastOptions, 'message' | 'tone' | 'duration'>> {
  id: number
  key: string
  icon?: string
}

const maxToasts = 3
const defaultDuration = 1800

const toasts = ref<Toast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1

function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter(toast => toast.id !== id)
}

function schedule(toast: Toast): void {
  const existing = timers.get(toast.id)
  if (existing) {
    clearTimeout(existing)
  }
  timers.set(toast.id, setTimeout(dismiss, toast.duration, toast.id))
}

function show(options: ToastOptions | string): number {
  const input = typeof options === 'string' ? { message: options } : options
  const key = input.key ?? `toast-${nextId}`
  const current = toasts.value.find(toast => toast.key === key)
  const toast: Toast = {
    id: current?.id ?? nextId++,
    key,
    message: input.message,
    icon: input.icon,
    tone: input.tone ?? 'neutral',
    duration: input.duration ?? defaultDuration,
  }

  if (current) {
    toasts.value = toasts.value.map(item => item.id === toast.id ? toast : item)
  }
  else {
    const next = [...toasts.value, toast]
    for (const dropped of next.slice(0, Math.max(0, next.length - maxToasts))) {
      dismiss(dropped.id)
    }
    toasts.value = next.slice(-maxToasts)
  }
  schedule(toast)
  return toast.id
}

/** Lightweight, global, non-blocking feedback messages. */
export function useToast() {
  return {
    dismiss,
    show,
    toasts,
  }
}
