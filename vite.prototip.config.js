// Config SEPARAT pentru prototipul B „Necesită atenția ta" (read-only, fixture clona 103).
// Nu atinge aplicația: rădăcina e prototip/pt-atentie, build-ul iese în prototip/pt-atentie/dist (ignorat de git prin `dist/`).
//   npx vite --config vite.prototip.config.js              → http://localhost:5199
//   npx vite build --config vite.prototip.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const radacinaRepo = fileURLToPath(new URL('.', import.meta.url))
const radacina = fileURLToPath(new URL('./prototip/pt-atentie', import.meta.url))

export default defineConfig({
  root: radacina,
  plugins: [react()],
  envDir: radacina,        // fără .env-ul aplicației: prototipul n-are chei Supabase și nu face fetch
  publicDir: false,
  cacheDir: fileURLToPath(new URL('./prototip/pt-atentie/.cache-vite', import.meta.url)),   // nu atinge node_modules/.vite al aplicației (node_modules e partajat prin symlink)
  server: { port: 5199, strictPort: true, fs: { allow: [radacinaRepo] } },
  preview: { port: 5199, strictPort: true },
  build: { outDir: fileURLToPath(new URL('./prototip/pt-atentie/dist', import.meta.url)), emptyOutDir: true, chunkSizeWarningLimit: 3000, modulePreload: { polyfill: false } },
})
