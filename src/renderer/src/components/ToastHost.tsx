import { useEffect } from 'react'
import { AnimatedToastStack, useAnimatedToastStack } from '@/components/motion/animated-toast-stack'
import { setToastSink } from '../store'

/** beUI animated toast stack, fed by the store's `toast()` helper. */
export function ToastHost() {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ defaultDuration: 3200, limit: 3 })

  useEffect(() => {
    setToastSink((text, { action, status, description }) => {
      showToast({
        title: text,
        description,
        status: status ?? 'neutral',
        duration: action ? 6000 : undefined,
        action: action && {
          label: action.label,
          onClick: (t) => {
            action.run()
            dismissToast(t.id)
          }
        }
      })
    })
    return () => setToastSink(null)
  }, [showToast, dismissToast])

  return <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-center" fixed maxVisible={3} />
}
