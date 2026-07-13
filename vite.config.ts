import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Honor a launcher-assigned port (e.g. preview tooling); fall back to Vite's default.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
})
