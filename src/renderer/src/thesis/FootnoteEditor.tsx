import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { analyze } from './analyze'
import { FOOTNOTE_EVENT } from './schema'

interface Open {
  pos: number
  top: number
  left: number
}

/** Small floating editor for the footnote clicked (or just inserted). */
export function FootnoteEditor({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState<Open | null>(null)
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail.pos
      const node = editor.state.doc.nodeAt(pos)
      if (node?.type.name !== 'footnote') return
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      dom?.scrollIntoView({ block: 'nearest' })
      const r = dom?.getBoundingClientRect() ?? editor.view.dom.getBoundingClientRect()
      setText(node.attrs.text ?? '')
      setOpen({ pos, top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 24, window.innerWidth - 392)) })
    }
    window.addEventListener(FOOTNOTE_EVENT, onOpen)
    return () => window.removeEventListener(FOOTNOTE_EVENT, onOpen)
  }, [editor])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [text, open])

  useEffect(() => {
    if (!open) return
    ref.current?.focus()
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', away, true)
    return () => window.removeEventListener('mousedown', away, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const valid = () => editor.state.doc.nodeAt(open.pos)?.type.name === 'footnote'
  const update = (v: string) => {
    setText(v)
    if (valid()) editor.view.dispatch(editor.state.tr.setNodeMarkup(open.pos, undefined, { text: v }))
  }
  const remove = () => {
    if (valid()) editor.chain().deleteRange({ from: open.pos, to: open.pos + 1 }).focus(open.pos).run()
    setOpen(null)
  }
  function close() {
    if (!open) return
    if (!text.trim()) return remove()
    setOpen(null)
    editor.chain().focus(open.pos + 1).run()
  }
  const n = analyze(editor.state.doc).footnotes.find((f) => f.pos === open.pos)?.n

  return (
    <div
      ref={boxRef}
      className="fixed z-50 w-[380px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl"
      style={{ top: Math.min(open.top, window.innerHeight - 200), left: open.left }}
    >
      <div className="mb-2 flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
        <span>Nota al pie {n}</span>
        <span className="text-faint">Usá *asteriscos* para cursiva</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        rows={2}
        lang="es"
        placeholder="Escribí la nota…"
        onChange={(e) => update(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
            e.preventDefault()
            close()
          }
        }}
        className="w-full resize-none rounded-md border bg-background px-2.5 py-2 text-[13.5px] leading-relaxed outline-none focus:border-ring"
      />
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={remove}>
          <Trash2 /> Eliminar
        </Button>
        <Button size="xs" onClick={close}>
          Listo
        </Button>
      </div>
    </div>
  )
}
