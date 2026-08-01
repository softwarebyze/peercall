import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    port: 3000,
    strictPort: false,
    proxy: {
      '/signal': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      '/config': {
        target: 'http://localhost:8080',
      },
    },
  },
  plugins: [
    tanstackStart(),
    tsconfigPaths(),
    react(),
  ],
})
