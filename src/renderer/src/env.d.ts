/// <reference types="vite/client" />
import type { Api } from '@shared/api'

declare global {
  interface Window {
    api: Api
  }

  /** Electron's <webview> (used only for the Excalidraw whiteboard). */
  interface WebviewElement extends HTMLWebViewElement {
    reload(): void
    getURL(): string
    sendInputEvent(event: { type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers?: string[] }): void
  }
}

