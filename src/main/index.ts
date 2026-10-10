import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './store'
import { CodexBridge } from './codex'
import { ClaudeBridge } from './claude'
import { lookupDoi, lookupTitle } from './crossref'
import type { AiEvent, AiProvider, CollectionName, PageText, Paper } from '../shared/types'
import type { ExtractOptions } from '../shared/api'
import { providerOf } from '../shared/ai'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

app.setName('Thesis Studio')
// Overrides let tests run against a throwaway library and profile.
if (process.env.THESIS_STUDIO_USER_DATA) app.setPath('userData', process.env.THESIS_STUDIO_USER_DATA)

const LIB = process.env.THESIS_STUDIO_LIBRARY || join(app.getPath('documents'), 'Thesis Studio')
const DIRS = {
  papers: join(LIB, 'Papers'),
  data: join(LIB, '.data'),
  text: join(LIB, '.data', 'text'),
  assistant: join(LIB, '.data', 'assistant')
}

const store = new Store(DIRS.data)
let win: BrowserWindow | null = null
const emitAi = (e: AiEvent) => win?.webContents.send('ai:event', e)
const bridges = { chatgpt: new CodexBridge(emitAi, DIRS.assistant), claude: new ClaudeBridge(emitAi, DIRS.assistant) }
/** The model id decides which subscription answers. */
const bridgeFor = (model?: string | null) => bridges[providerOf(model)]

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Thesis Studio',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#fbfbfa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webviewTag: true // only for the Excalidraw whiteboard, locked down in guardWhiteboard()
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The only guest page allowed is the whiteboard, with no preload and no Node.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (!isWhiteboardUrl(params.src) || params.partition !== WHITEBOARD_PARTITION) return e.preventDefault()
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

// ---------- whiteboard (Excalidraw) ----------

/** Persistent partition: Excalidraw autosaves the scene to its localStorage/IndexedDB, kept across restarts. */
const WHITEBOARD_PARTITION = 'persist:excalidraw'

function isWhiteboardUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'excalidraw.com' || u.hostname.endsWith('.excalidraw.com'))
  } catch {
    return false
  }
}

/** Keeps the whiteboard on excalidraw.com; every other link opens in the browser. */
function guardWhiteboard(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // Library browsing hands its picks back through excalidraw.com, so it stays in the board.
    if (isWhiteboardUrl(url)) void contents.loadURL(url)
    else if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (isWhiteboardUrl(url)) return
    e.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
}

function setupWhiteboardSession(): void {
  const ses = session.fromPartition(WHITEBOARD_PARTITION)
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fileSystem', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') guardWhiteboard(contents)
})

const menuSend = (action: string) => () => win?.webContents.send('menu', action)

function buildMenu(): void {
  const isDev = !app.isPackaged
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: menuSend('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Import PDFs…', accelerator: 'CmdOrCtrl+O', click: menuSend('import') },
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: menuSend('new-note') },
        { label: 'Open Thesis', accelerator: 'CmdOrCtrl+Alt+T', click: menuSend('open-thesis') },
        { label: 'Open Whiteboard', accelerator: 'CmdOrCtrl+Alt+B', click: menuSend('open-board') },
        { label: 'Open Literature Matrix', accelerator: 'CmdOrCtrl+Alt+L', click: menuSend('open-matrix') },
        { type: 'separator' },
        { label: 'Export Note as Markdown…', accelerator: 'CmdOrCtrl+Shift+E', click: menuSend('export-note') },
        { label: 'Export Thesis as Word…', click: menuSend('export-thesis-docx') },
        { label: 'Export Thesis as PDF…', click: menuSend('export-thesis-pdf') },
        { label: 'Export Bibliography…', click: menuSend('export-bib') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: menuSend('close-tab') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Paper', accelerator: 'CmdOrCtrl+F', click: menuSend('find') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: menuSend('palette') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: menuSend('toggle-sidebar') },
        { label: 'Toggle Assistant', accelerator: 'CmdOrCtrl+J', click: menuSend('toggle-assistant') },
        { label: 'Open Side Note', accelerator: 'CmdOrCtrl+Shift+N', click: menuSend('side-note') },
        { label: 'Skim Mode', accelerator: 'CmdOrCtrl+Alt+S', click: menuSend('skim') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: menuSend('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: menuSend('zoom-out') },
        { label: 'Fit Width', accelerator: 'CmdOrCtrl+0', click: menuSend('zoom-fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- library ----------

const safeName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)

function titleFromFile(file: string): string {
  return basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

async function importFiles(paths: string[]): Promise<Paper[]> {
  const existing = new Map(store.all<Paper>('papers').map((p) => [p.id, p]))
  const out: Paper[] = []
  for (const src of paths) {
    if (extname(src).toLowerCase() !== '.pdf') continue
    try {
      const buf = await readFile(src)
      const id = createHash('sha1').update(buf).digest('hex').slice(0, 12)
      const dupe = existing.get(id)
      if (dupe) {
        out.push(dupe)
        continue
      }
      const fileName = `${safeName(titleFromFile(src))} (${id.slice(0, 6)}).pdf`
      await copyFile(src, join(DIRS.papers, fileName))
      const now = Date.now()
      const paper: Paper = {
        id,
        fileName,
        title: titleFromFile(src),
        authors: [],
        type: 'article',
        tags: [],
        status: 'unread',
        textStatus: 'pending',
        addedAt: now,
        updatedAt: now
      }
      store.put('papers', paper)
      existing.set(id, paper)
      out.push(paper)
    } catch (e) {
      console.error('import failed', src, e)
    }
  }
  return out
}

function registerIpc(): void {
  ipcMain.handle('db:load', async () => ({ ...(await store.load()), libraryDir: LIB }))
  ipcMain.on('db:put', (_e, col: CollectionName, doc: { id: string }) => store.put(col, doc))
  ipcMain.on('db:remove', (_e, col: CollectionName, id: string) => store.remove(col, id))

  ipcMain.handle('papers:import', async (_e, paths?: string[]) => {
    if (!paths?.length) {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Import papers',
        buttonLabel: 'Import',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (r.canceled) return []
      paths = r.filePaths
    }
    return importFiles(paths)
  })
  ipcMain.handle('papers:read', async (_e, fileName: string) => {
    const buf = await readFile(join(DIRS.papers, basename(fileName)))
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  })
  ipcMain.on('papers:reveal', (_e, fileName: string) => shell.showItemInFolder(join(DIRS.papers, basename(fileName))))
  ipcMain.handle('papers:trash', async (_e, fileName: string) => {
    const p = join(DIRS.papers, basename(fileName))
    if (existsSync(p)) await shell.trashItem(p)
  })

  ipcMain.handle('text:save', (_e, id: string, pages: PageText[]) =>
    writeFile(join(DIRS.text, `${basename(id)}.json`), JSON.stringify(pages))
  )
  ipcMain.handle('text:get', async (_e, id: string) => {
    try {
      return JSON.parse(await readFile(join(DIRS.text, `${basename(id)}.json`), 'utf8'))
    } catch {
      return null
    }
  })

  ipcMain.handle('meta:doi', (_e, doi: string) => lookupDoi(doi))
  ipcMain.handle('meta:title', (_e, title: string) => lookupTitle(title))

  ipcMain.handle('ai:account', (_e, provider: AiProvider) => bridges[provider].account())
  ipcMain.handle('ai:login', (_e, provider: AiProvider) => bridges[provider].login())
  ipcMain.handle('ai:prepare', (_e, opts) => bridgeFor(opts.model).prepare(opts).then(() => undefined).catch(() => undefined))
  ipcMain.handle('ai:send', (_e, opts) => bridgeFor(opts.model).send(opts))
  // A chat may have run on either provider; both calls are no-ops when idle.
  ipcMain.handle('ai:interrupt', (_e, chatId: string) => Promise.all([bridges.chatgpt.interrupt(chatId), bridges.claude.interrupt(chatId)]).then(() => undefined))
  ipcMain.handle('ai:reset', (_e, chatId: string) => (bridges.chatgpt.reset(chatId), bridges.claude.reset(chatId)))
  ipcMain.handle('ai:extract', (_e, prompt: string, schema: object, opts?: ExtractOptions) => bridgeFor(opts?.model).extract(prompt, schema, opts))
  ipcMain.handle('ai:assist', (_e, opts) => bridgeFor(opts.model).assist(opts))

  ipcMain.on('shell:open', (_e, url: string) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle('shell:save', async (_e, defaultName: string, content: string, filters) => {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('documents'), defaultName),
      filters
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, content, 'utf8')
    return r.filePath
  })
  // Calibri ships inside Office on macOS (not as a system font); the thesis uses it when present.
  ipcMain.handle('thesis:calibri', async () => {
    const files = { regular: 'Calibri.ttf', bold: 'Calibrib.ttf', italic: 'Calibrii.ttf', boldItalic: 'Calibriz.ttf' }
    const dirs = [
      ...['Microsoft Word', 'Microsoft PowerPoint', 'Microsoft Excel', 'Microsoft Outlook'].map((a) => `/Applications/${a}.app/Contents/Resources/DFonts`),
      '/Library/Fonts',
      join(app.getPath('home'), 'Library/Fonts'),
      'C:\\Windows\\Fonts'
    ]
    for (const dir of dirs) {
      if (!existsSync(join(dir, files.regular))) continue
      try {
        const entries = await Promise.all(Object.entries(files).map(async ([k, f]) => [k, new Uint8Array(await readFile(join(dir, f)))] as const))
        return Object.fromEntries(entries)
      } catch {
        // A partial install: try the next location.
      }
    }
    return null
  })

  ipcMain.handle('shell:saveBinary', async (_e, defaultName: string, bytes: Uint8Array, filters) => {
    const path = await askSavePath(defaultName, filters)
    if (path) await writeFile(path, bytes)
    return path
  })

  ipcMain.handle('thesis:pdf', async (_e, html: string, defaultName: string) => {
    const path = await askSavePath(defaultName, [{ name: 'PDF', extensions: ['pdf'] }])
    if (path) await writeFile(path, await renderPdf(html))
    return path
  })
}

async function askSavePath(defaultName: string, filters?: Electron.FileFilter[]): Promise<string | null> {
  // Tests export without a dialog.
  if (process.env.THESIS_STUDIO_EXPORT_DIR) return join(process.env.THESIS_STUDIO_EXPORT_DIR, basename(defaultName))
  const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), defaultName), filters })
  return r.canceled || !r.filePath ? null : r.filePath
}

/**
 * Loads a self-contained Paged.js document in a hidden, sandboxed window and
 * prints it. The page sets `window.__pagedDone` once pagination has finished.
 */
async function renderPdf(html: string): Promise<Buffer> {
  const tmp = join(app.getPath('temp'), `thesis-studio-${Date.now()}.html`)
  await writeFile(tmp, html, 'utf8')
  const w = new BrowserWindow({
    show: false,
    width: 900,
    height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await w.loadFile(tmp)
    const deadline = Date.now() + 90_000
    while (!(await w.webContents.executeJavaScript('window.__pagedDone === true'))) {
      if (Date.now() > deadline) throw new Error('Timed out while paginating the thesis')
      await new Promise((r) => setTimeout(r, 150))
    }
    return await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
  } finally {
    w.destroy()
    void rm(tmp, { force: true })
  }
}

app.whenReady().then(async () => {
  await Promise.all(Object.values(DIRS).map((d) => mkdir(d, { recursive: true })))
  registerIpc()
  setupWhiteboardSession()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let flushed = false
app.on('before-quit', (e) => {
  if (flushed) return
  e.preventDefault()
  bridges.chatgpt.dispose()
  bridges.claude.dispose()
  void store.flush().finally(() => {
    flushed = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

