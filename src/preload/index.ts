import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/api'
import type { AiEvent } from '../shared/types'

const api: Api = {
  platform: process.platform,
  db: {
    load: () => ipcRenderer.invoke('db:load'),
    put: (col, doc) => ipcRenderer.send('db:put', col, doc),
    remove: (col, id) => ipcRenderer.send('db:remove', col, id)
  },
  papers: {
    import: (paths) => ipcRenderer.invoke('papers:import', paths),
    read: (fileName) => ipcRenderer.invoke('papers:read', fileName),
    reveal: (fileName) => ipcRenderer.send('papers:reveal', fileName),
    trash: (fileName) => ipcRenderer.invoke('papers:trash', fileName),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  text: {
    save: (id, pages) => ipcRenderer.invoke('text:save', id, pages),
    get: (id) => ipcRenderer.invoke('text:get', id)
  },
  meta: {
    byDoi: (doi) => ipcRenderer.invoke('meta:doi', doi),
    byTitle: (title) => ipcRenderer.invoke('meta:title', title)
  },
  ai: {
    account: (provider) => ipcRenderer.invoke('ai:account', provider),
    login: (provider) => ipcRenderer.invoke('ai:login', provider),
    prepare: (opts) => ipcRenderer.invoke('ai:prepare', opts),
    send: (opts) => ipcRenderer.invoke('ai:send', opts),
    interrupt: (chatId) => ipcRenderer.invoke('ai:interrupt', chatId),
    reset: (chatId) => ipcRenderer.invoke('ai:reset', chatId),
    extract: (prompt, schema, opts) => ipcRenderer.invoke('ai:extract', prompt, schema, opts),
    assist: (opts) => ipcRenderer.invoke('ai:assist', opts),
    onEvent: (cb) => {
      const fn = (_: unknown, e: AiEvent) => cb(e)
      ipcRenderer.on('ai:event', fn)
      return () => ipcRenderer.removeListener('ai:event', fn)
    }
  },
  shell: {
    openExternal: (url) => ipcRenderer.send('shell:open', url),
    saveFile: (name, content, filters) => ipcRenderer.invoke('shell:save', name, content, filters),
    saveBinary: (name, bytes, filters) => ipcRenderer.invoke('shell:saveBinary', name, bytes, filters)
  },
  thesis: {
    exportPdf: (html, name) => ipcRenderer.invoke('thesis:pdf', html, name),
    calibri: () => ipcRenderer.invoke('thesis:calibri')
  },
  onMenu: (cb) => {
    const fn = (_: unknown, a: string) => cb(a)
    ipcRenderer.on('menu', fn)
    return () => ipcRenderer.removeListener('menu', fn)
  }
}

contextBridge.exposeInMainWorld('api', api)
