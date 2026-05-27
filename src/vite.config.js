import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 27.05.2026: optimizare bundle - manualChunks pentru vendor separation
// Înainte: 1 chunk de 3.5MB (warning Vite >500KB)
// După: ~5 chunks separate, cache mai bun pentru vendor (rar se schimbă)
export default defineConfig({
  plugins: [react()],
  build: {
    // Bundle-urile vendor pot ajunge la ~1MB legitim - mărim pragul warning
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          // React core - rar se schimbă, cache foarte bun
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // PDF generation - folosit la export ordin/aviz/service
          'vendor-pdf': ['jspdf', 'html2canvas'],
          // Excel + ZIP - folosit la import/export bulk
          'vendor-data': ['xlsx-js-style', 'jszip'],
          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
