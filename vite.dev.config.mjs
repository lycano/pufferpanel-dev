// Vite dev server (HMR) for PufferPanel's frontend, used by `start-puffer-upstream.py --watch`.
// Run from <repo>/client/frontend: `yarn vite --config <this file>`. Takes the repo's own vite.config.js unchanged and
// adds a dev server on :5173 that proxies every backend route to the Go panel on :8080 (run by air).
//   Vite serves:  index.html and every client-side route (/servers, /auth/login, ...), /src, /@vite, /node_modules
//                 and public/ (fonts, img, js/ace, favicon.*, sw.js)
//   Go serves:    /api (+ console WebSocket), /auth POST/PUT, /auth/publickey, /oauth2, /daemon, /swagger,
//                 /manifest.json, /theme (theme tars from panel.web.files)
// changeOrigin stays false: Go sees Host localhost:5173 and its host-only cookies (puffer_auth, ...) stay on :5173.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// installed in this repo (package.json here), never in a PufferPanel tree; Alt+Shift+D in the page, or /__devtools__/
import vueDevTools from 'vite-plugin-vue-devtools'

const frontend = process.cwd()
const backend = 'http://localhost:8080'
const { default: base } = await import(pathToFileURL(path.join(frontend, 'vite.config.js')).href)

const route = (extra = {}) => ({ target: backend, changeOrigin: false, ...extra })

// /auth/login, /auth/register, /auth/invite are SPA pages; the backend has POST/PUT handlers on the same paths
const spaPage = (req) => {
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) return '/index.html'
}

// Dev-only fix for an upstream bug in src/plugins/hotkeys.js (served code only, the file stays unchanged): under the
// dev server, plugin-vue compiles <script setup> with an implicit expose(), so a directive's binding.instance is
// Vue's exposeProxy, which has no `_`; getGroup() reads i._.root and the app fails to mount. Production builds inline
// the template (no expose()) and pass the full proxy. `.$.proxy` is the full proxy in both cases.
const hotkeysDevFix = {
  name: 'pufferpanel-dev:hotkeys-instance',
  transform(code, id) {
    if (!id.endsWith('/src/plugins/hotkeys.js')) return
    const from = 'getGroup(binding.instance)'
    if (!code.includes(from)) {
      this.warn(`pufferpanel-dev: "${from}" not found in hotkeys.js; the dev fix no longer applies, check upstream`)
      return
    }
    return code.replace(from, 'getGroup(binding.instance.$.proxy)')
  }
}

export default {
  ...base,
  root: frontend,
  plugins: [...base.plugins, hotkeysDevFix, vueDevTools()],
  resolve: {
    ...base.resolve,
    // the `pufferpanel` API client from source, so changes in client/api hot-reload too (no dist build needed)
    alias: [
      { find: /^pufferpanel$/, replacement: path.resolve(frontend, '../api/src/index.js') },
      ...base.resolve.alias
    ]
  },
  // pufferpanel-conditions loads conditions_bg.wasm via new URL(..., import.meta.url); pre-bundled into
  // node_modules/.vite/deps that URL has no file behind it and the SPA fallback answers with index.html
  optimizeDeps: {
    ...base.optimizeDeps,
    exclude: [...(base.optimizeDeps?.exclude || []), 'pufferpanel-conditions']
  },
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': route({ ws: true }),
      '/auth': route({ bypass: spaPage }),
      '/oauth2': route(),
      '/daemon': route({ ws: true }),
      '/swagger': route(),
      '/manifest.json': route(),
      '/theme': route()
    }
  }
}
