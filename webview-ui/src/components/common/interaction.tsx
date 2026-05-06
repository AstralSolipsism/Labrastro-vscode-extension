import {
  Component,
  For,
  JSX,
  Show,
  createEffect,
  createMemo,
  createUniqueId,
  onCleanup,
  onMount,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { isDismissKey, isRovingKey, nextRovingIndex } from "./interaction-keys"

export { isDismissKey, isRovingKey, nextRovingIndex } from "./interaction-keys"

type SurfaceElement = "section" | "div" | "aside"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

let surfaceSequence = 0
const activeSurfaceStack: number[] = []

interface DialogSurfaceProps {
  ariaLabel: string
  backdropClass: string
  surfaceClass: string
  as?: SurfaceElement
  closeOnBackdrop?: boolean
  initialFocusSelector?: string
  children: JSX.Element
  onClose: () => void
}

export const DialogSurface: Component<DialogSurfaceProps> = (props) => {
  let surfaceRef: HTMLElement | undefined
  let previouslyFocused: Element | null = null
  const surfaceId = ++surfaceSequence
  const closeOnBackdrop = () => props.closeOnBackdrop !== false

  const isTopSurface = () => activeSurfaceStack[activeSurfaceStack.length - 1] === surfaceId

  const focusInitialElement = () => {
    if (!surfaceRef) return
    const requested = props.initialFocusSelector
      ? surfaceRef.querySelector<HTMLElement>(props.initialFocusSelector)
      : undefined
    const first = requested || getFocusableElements(surfaceRef)[0] || surfaceRef
    first.focus()
  }

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!isTopSurface()) return
    if (isDismissKey(event.key)) {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key !== "Tab" || !surfaceRef) return

    const focusable = getFocusableElements(surfaceRef)
    if (focusable.length === 0) {
      event.preventDefault()
      surfaceRef.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMount(() => {
    previouslyFocused = document.activeElement
    activeSurfaceStack.push(surfaceId)
    document.addEventListener("keydown", handleDocumentKeyDown)
    window.setTimeout(focusInitialElement, 0)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleDocumentKeyDown)
    const index = activeSurfaceStack.lastIndexOf(surfaceId)
    if (index >= 0) activeSurfaceStack.splice(index, 1)
    if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
      window.setTimeout(() => previouslyFocused instanceof HTMLElement && previouslyFocused.focus(), 0)
    }
  })

  return (
    <div
      class={props.backdropClass}
      onClick={(event) => {
        if (closeOnBackdrop() && event.target === event.currentTarget) props.onClose()
      }}
    >
      <Dynamic
        component={props.as || "section"}
        ref={surfaceRef}
        class={props.surfaceClass}
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
        tabIndex={-1}
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        {props.children}
      </Dynamic>
    </div>
  )
}

export const DrawerSurface: Component<Omit<DialogSurfaceProps, "as">> = (props) => (
  <DialogSurface {...props} as="aside" />
)

interface DropdownMenuProps {
  ariaLabel: string
  title: string
  open: boolean
  disabled?: boolean
  triggerClass: string
  triggerClassList?: Record<string, boolean | undefined>
  menuClass: string
  triggerContent: JSX.Element
  children: JSX.Element
  onOpenChange: (open: boolean) => void
}

export const DropdownMenu: Component<DropdownMenuProps> = (props) => {
  const menuId = createUniqueId()
  let rootRef: HTMLDivElement | undefined
  let triggerRef: HTMLButtonElement | undefined
  let menuRef: HTMLDivElement | undefined
  let wasOpen = false

  const setOpen = (open: boolean) => {
    if (props.disabled && open) return
    props.onOpenChange(open)
  }

  const focusMenuItem = (key: string, fallbackIndex = 0) => {
    const items = getMenuItems(menuRef)
    if (!items.length) return
    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = nextRovingIndex(activeIndex >= 0 ? activeIndex : fallbackIndex - 1, items.length, key)
    if (nextIndex >= 0) items[nextIndex].focus()
  }

  const handleDocumentPointerDown = (event: MouseEvent) => {
    if (!props.open || !rootRef) return
    if (!rootRef.contains(event.target as Node)) setOpen(false)
  }

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!props.open) return
    if (isDismissKey(event.key)) {
      event.preventDefault()
      setOpen(false)
    }
  }

  createEffect(() => {
    if (props.open) {
      wasOpen = true
      window.setTimeout(() => {
        const selected = menuRef?.querySelector<HTMLElement>('[aria-checked="true"], .prompt-menu__item--selected')
        const first = getMenuItems(menuRef)[0]
        ;(selected || first)?.focus()
      }, 0)
    } else if (wasOpen) {
      wasOpen = false
      window.setTimeout(() => triggerRef?.focus(), 0)
    }
  })

  onMount(() => {
    document.addEventListener("mousedown", handleDocumentPointerDown)
    document.addEventListener("keydown", handleDocumentKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("mousedown", handleDocumentPointerDown)
    document.removeEventListener("keydown", handleDocumentKeyDown)
  })

  return (
    <div class="prompt-selector-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        class={props.triggerClass}
        classList={props.triggerClassList}
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-controls={props.open ? menuId : undefined}
        disabled={props.disabled}
        title={props.title}
        onClick={() => setOpen(!props.open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            setOpen(true)
            window.setTimeout(() => focusMenuItem(event.key, event.key === "ArrowUp" ? 0 : -1), 0)
          }
        }}
      >
        {props.triggerContent}
      </button>
      <Show when={props.open}>
        <div
          id={menuId}
          ref={menuRef}
          class={props.menuClass}
          role="menu"
          aria-label={props.ariaLabel}
          onKeyDown={(event) => {
            if (isRovingKey(event.key)) {
              event.preventDefault()
              focusMenuItem(event.key)
            }
          }}
        >
          {props.children}
        </div>
      </Show>
    </div>
  )
}

interface SelectableListProps {
  ariaLabel: string
  items: string[]
  selectedId?: string
  class?: string
  renderItem: (id: string) => JSX.Element
  renderAction?: (id: string) => JSX.Element
  onSelect: (id: string) => void
}

export const SelectableList: Component<SelectableListProps> = (props) => {
  let listRef: HTMLDivElement | undefined
  const itemIds = createMemo(() => props.items)
  const activeTabId = () => props.selectedId || itemIds()[0]

  const optionButtons = () => Array.from(listRef?.querySelectorAll<HTMLButtonElement>('[data-selectable-option="true"]') || [])
  const focusByIndex = (index: number) => {
    const buttons = optionButtons()
    const button = buttons[index]
    if (!button) return
    button.focus()
    const id = button.dataset.optionId
    if (id) props.onSelect(id)
  }

  return (
    <div
      ref={listRef}
      class={`selectable-list ${props.class || ""}`}
      role="listbox"
      aria-label={props.ariaLabel}
      onKeyDown={(event) => {
        if (!isRovingKey(event.key)) return
        const buttons = optionButtons()
        if (!buttons.length) return
        const activeIndex = buttons.findIndex((button) => button === document.activeElement)
        const nextIndex = nextRovingIndex(activeIndex, buttons.length, event.key)
        if (nextIndex < 0) return
        event.preventDefault()
        focusByIndex(nextIndex)
      }}
    >
      <For each={itemIds()}>
        {(id) => {
          const selected = () => id === props.selectedId
          return (
            <div
              class="settings-master-item"
              classList={{ "settings-master-item--active": selected() }}
            >
              <button
                type="button"
                class="settings-master-item__select"
                role="option"
                aria-selected={selected()}
                tabIndex={activeTabId() === id ? 0 : -1}
                data-selectable-option="true"
                data-option-id={id}
                onClick={() => props.onSelect(id)}
              >
                {props.renderItem(id)}
              </button>
              {props.renderAction?.(id)}
            </div>
          )
        }}
      </For>
    </div>
  )
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute("disabled")) return false
    if (element.getAttribute("aria-hidden") === "true") return false
    return element.offsetParent !== null || element.getClientRects().length > 0 || element === document.activeElement
  })
}

function getMenuItems(menu: HTMLElement | undefined): HTMLElement[] {
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])'))
}
