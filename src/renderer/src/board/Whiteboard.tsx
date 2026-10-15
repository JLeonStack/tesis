import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { RotateCcw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextShimmer } from '@/components/motion/text-shimmer'
import { EmptyState } from '../components/common'
import { registerBoard } from './bridge'

const BOARD_URL = 'https://excalidraw.com/'
/** Must match WHITEBOARD_PARTITION in main: a persistent session, so the drawing survives restarts. */
const PARTITION = 'persist:excalidraw'

/**
 * Lets Excalidraw open links (main routes them to the browser or back into the
 * board). React drops a boolean on this non-standard attribute, so it goes in as a string.
 */
const POPUPS = { allowpopups: 'true' } as unknown as { allowpopups: boolean }

/** Menu shortcuts the app's menu would swallow, forwarded to Excalidraw while the board is active. */
const FORWARD: Record<string, string> = { 'zoom-in': '=', 'zoom-out': '-', 'zoom-fit': '0', find: 'f' }

/**
 * Excalidraw as a tab. It runs in a locked-down <webview> (see guardWhiteboard
 * in main) and saves the scene itself, in its own persistent storage. The
 * assistant, in the side panel, can read the board and draw on it (board/bridge).
 */
export function Whiteboard({ active }: { active: boolean }) {
  const ref = useRef<WebviewElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const ready = () => {
      setState('ready')
      // The assistant reads and draws through this webview.
      registerBoard(wv)
    }
    const failed = (e: Event) => {
      const { errorCode, isMainFrame } = e as Event & { errorCode: number; isMainFrame: boolean }
      if (isMainFrame && errorCode !== -3) setState('error') // -3: aborted by a newer navigation
    }
    wv.addEventListener('dom-ready', ready)
    wv.addEventListener('did-fail-load', failed)
    return () => {
      wv.removeEventListener('dom-ready', ready)
      wv.removeEventListener('did-fail-load', failed)
      registerBoard(null)
    }
  }, [])

  // Draw right away: keyboard focus follows the tab.
  useEffect(() => {
    if (active && state === 'ready') ref.current?.focus()
  }, [active, state])

  useEffect(() => {
    if (!active) return
    const onCmd = (e: Event) => {
      const key = FORWARD[(e as CustomEvent<string>).detail]
      const wv = ref.current
      if (!key || !wv || state !== 'ready') return
      const modifiers = [window.api.platform === 'darwin' ? 'meta' : 'control']
      wv.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
      wv.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
    }
    window.addEventListener('reader-command', onCmd)
    return () => window.removeEventListener('reader-command', onCmd)
  }, [active, state])

  return (
    <div className="relative min-h-0 flex-1 bg-background">
      <webview ref={ref} src={BOARD_URL} partition={PARTITION} {...POPUPS} className="absolute inset-0 size-full" />
      <AnimatePresence>
        {state !== 'ready' && (
          <motion.div
            className="absolute inset-0 flex bg-background"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            {state === 'error' ? (
              <EmptyState
                icon={<WifiOff />}
                title="No se puede conectar con Excalidraw"
                description="Tu dibujo está guardado en esta Mac. Revisá la conexión e intentá de nuevo."
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setState('loading')
                    ref.current?.reload()
                  }}
                >
                  <RotateCcw /> Reintentar
                </Button>
              </EmptyState>
            ) : (
              <div className="grid flex-1 place-items-center">
                <TextShimmer duration={1.6} className="text-[13px] font-medium">
                  Abriendo tu pizarra…
                </TextShimmer>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
