import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '../mail_scheduler/public/dist',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.js'),
      name: 'MailScheduler',
      fileName: 'mail_scheduler',
      formats: ['iife']
    },
    rollupOptions: {
      external: ['vue', 'frappe-ui'],
      output: {
        globals: {
          vue: 'Vue',
          'frappe-ui': 'FrappeUI'
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
