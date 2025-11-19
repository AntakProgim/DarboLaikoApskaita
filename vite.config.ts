
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.PORT) || 8080,
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 8080,
  },
})
