import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/chatbot-demo',
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/chatbot-demo/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chatbot-demo/, ''),
      },
    },
  },
})
