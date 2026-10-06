/**
 * Scrolls `list` so `item` sits in its middle (or just comes into view, for 'nearest').
 * Unlike scrollIntoView, it never scrolls the list's ancestors: those include the editor's own
 * clipped panes and the host page, which would shift the stage under its header.
 */
export function scrollWithin(list: HTMLElement | null, item: Element | null | undefined, block: 'center' | 'nearest', behavior: ScrollBehavior = 'auto'): void {
  if (!list || !item) {
    return
  }
  const listRect = list.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const top = itemRect.top - listRect.top + list.scrollTop
  let target: number
  if (block === 'center') {
    target = top - (list.clientHeight - itemRect.height) / 2
  }
  else if (itemRect.top < listRect.top) {
    target = top
  }
  else if (itemRect.bottom > listRect.bottom) {
    target = top + itemRect.height - list.clientHeight
  }
  else {
    return
  }
  list.scrollTo({ top: target, behavior })
}
