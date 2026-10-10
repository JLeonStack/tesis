import { toast } from '../store'
import { liveThesis } from './bridge'
import { buildThesisModel } from './model'
import { fullTitle } from './template'

const fileSafe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Trabajo Final'

function currentModel() {
  const live = liveThesis()
  if (!live) {
    toast('Todavía no creaste la tesis')
    return null
  }
  return { model: buildThesisModel(live.doc, live.thesis.meta), name: fileSafe(fullTitle(live.thesis.meta) || 'Trabajo Final') }
}

export async function exportThesisDocx(): Promise<void> {
  const cur = currentModel()
  if (!cur) return
  try {
    const { buildDocx } = await import('./docx')
    const bytes = await buildDocx(cur.model)
    const path = await window.api.shell.saveBinary(`${cur.name}.docx`, bytes, [{ name: 'Word', extensions: ['docx'] }])
    if (path) toast('Tesis exportada a Word', undefined, { status: 'success', description: 'Al abrirla, Word actualiza la tabla de contenido.' })
  } catch (e) {
    console.error(e)
    toast('No se pudo exportar a Word', undefined, { status: 'error', description: String((e as Error).message ?? e) })
  }
}

export async function exportThesisPdf(): Promise<void> {
  const cur = currentModel()
  if (!cur) return
  try {
    const { buildPrintHtml } = await import('./pdf')
    const html = await buildPrintHtml(cur.model)
    const path = await window.api.thesis.exportPdf(html, `${cur.name}.pdf`)
    if (path) toast('Tesis exportada a PDF', undefined, { status: 'success' })
  } catch (e) {
    console.error(e)
    toast('No se pudo exportar a PDF', undefined, { status: 'error', description: String((e as Error).message ?? e) })
  }
}
