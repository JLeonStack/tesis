import { useRef } from 'react'

/** Zero-width drag handle between panes; shows an accent hairline on hover. */
export function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const last = useRef(0)
  return (
    <div className="relative z-20 w-0" role="separator" aria-orientation="vertical">
      <div
        className="absolute inset-y-0 -left-[3px] w-[6px] cursor-col-resize transition-colors delay-150 hover:bg-[linear-gradient(to_right,transparent_2px,var(--primary)_2px,var(--primary)_4px,transparent_4px)]"
        onPointerDown={(e) => {
          last.current = e.clientX
          e.currentTarget.setPointerCapture(e.pointerId)
          document.body.classList.add('resizing')
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const dx = e.clientX - last.current
          last.current = e.clientX
          if (dx) onResize(dx)
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          document.body.classList.remove('resizing')
        }}
      />
    </div>
  )
}
