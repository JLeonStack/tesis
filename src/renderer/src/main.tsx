import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import './styles/globals.css'
import './styles/content.css'
import './styles/thesis.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import { boot } from './store'

void boot().then(() =>
  createRoot(document.getElementById('root')!).render(
    <TooltipProvider delayDuration={450} skipDelayDuration={150}>
      <App />
    </TooltipProvider>
  )
)
