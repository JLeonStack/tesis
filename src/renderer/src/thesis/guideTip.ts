// The template's guidance for a heading or a sheet, as an ⓘ next to it that
// shows the text on hover. Takes no room on the page, so pagination ignores it.

const INFO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'

let open: { tip: HTMLElement; owner: HTMLElement } | null = null

function hide() {
  open?.tip.remove()
  open = null
}

function show(owner: HTMLElement, text: string) {
  if (open?.owner === owner) return
  hide()
  const tip = document.createElement('div')
  tip.className = 'guide-tip'
  tip.setAttribute('role', 'tooltip')
  tip.textContent = text
  document.body.append(tip)
  const r = owner.getBoundingClientRect()
  const w = tip.offsetWidth
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))
  const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight
  tip.style.left = `${left}px`
  tip.style.top = `${below ? r.bottom + 6 : r.top - 6 - tip.offsetHeight}px`
  open = { tip, owner }
}

/** An ⓘ that shows `text` on hover (and on focus, for the keyboard). */
export function guideTip(text: string): HTMLElement {
  const anchor = document.createElement('span')
  anchor.className = 'guide-anchor'
  anchor.contentEditable = 'false'
  const dot = document.createElement('span')
  dot.className = 'guide-dot'
  dot.tabIndex = -1
  dot.setAttribute('aria-label', text)
  dot.innerHTML = INFO_SVG
  dot.addEventListener('mouseenter', () => show(dot, text))
  dot.addEventListener('mouseleave', hide)
  // Clicking shows it too, without moving the caret.
  dot.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    show(dot, text)
  })
  anchor.append(dot)
  return anchor
}

window.addEventListener('scroll', hide, true)
