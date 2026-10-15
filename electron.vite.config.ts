import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Honor an assigned PORT (e.g. from a preview launcher); Electron loads whatever URL Vite ends up on.
    server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src'),
        // Paged.js paginates the thesis PDF; its package exports don't expose the dist/ builds.
        'pagedjs-dist': resolve(__dirname, 'node_modules/pagedjs/dist')
      }
    },
    // Loaded as raw text for the print window; pre-bundling a `?raw` import breaks it in dev.
    optimizeDeps: { exclude: ['pagedjs-dist'] },
    plugins: [
      react(),
      tailwindcss(),
      {
        // React Fast Refresh injects an inline script in dev; production keeps the strict CSP.
        name: 'dev-csp',
        apply: 'serve',
        transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      }
    ],
    build: {
      target: 'chrome140',
      minify: 'esbuild',
      cssMinify: true,
      chunkSizeWarningLimit: 2000,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
