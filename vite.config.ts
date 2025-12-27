import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-wasm-correctly',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Ensure WASM files are served with correct content type and not as HTML
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm')
            // Don't let SPA fallback handle WASM requests
            return next()
          }
          next()
        })
      }
    }
  ],
  optimizeDeps: {
    exclude: ['aubiojs']
  },
  assetsInclude: ['**/*.wasm']
})
