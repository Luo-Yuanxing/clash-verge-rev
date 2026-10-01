import path from 'node:path'

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  root: 'src',
  server: {
    port: 3000,
    // Atomic writers (editors, agents) create `.<file>.<pid>.<uuid>.tmpdir`
    // next to the target and rename it in place. Watching those short-lived
    // temp files races with the rename and kills the dev server with EBUSY on
    // Windows, so ignore them. Vite merges this with its default ignore list.
    //
    // Ignoring them also swallows the notification for the replacement itself:
    // the rename the watcher reports carries the temp path, which lands in the
    // ignore list, so the edit never reaches HMR. Polling detects the change by
    // itself and cannot miss it, at the cost of a little CPU.
    watch: {
      ignored: ['**/.*tmpdir/**'],
      usePolling: true,
      interval: 400,
    },
  },
  plugins: [
    svgr(),
    react(),
    legacy({
      modernTargets: ['edge>=109', 'safari>=14'],
      renderLegacyChunks: false,
      modernPolyfills: ['es.object.has-own', 'web.structured-clone'],
      additionalModernPolyfills: [
        path.resolve('./src/polyfills/matchMedia.js'),
        path.resolve('./src/polyfills/WeakRef.js'),
        path.resolve('./src/polyfills/RegExp.js'),
      ],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '@root': path.resolve('.'),
      'monaco-editor/esm/vs/editor/editor.worker.js':
        'monaco-editor/editor/editor.worker',
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
})
