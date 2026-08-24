import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Fix: Browser refresh on any sub-route returns index.html (dev server)
    historyApiFallback: true,
  },
  preview: {
    // Same fix for vite preview builds
    historyApiFallback: true,
  },
})

