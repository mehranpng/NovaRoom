import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import fs from 'fs'

const rootDir = path.resolve(__dirname, '..')
const envDir = fs.existsSync(path.resolve(rootDir, '.env')) ? rootDir : __dirname

export default defineConfig({
    envDir,
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
        allowedHosts: [
            'novaroom.org',
            'api.novaroom.org',
            'test.pngwr.shop',
            'localhost'
        ],
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
                ws: true,
            }
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-motion': ['framer-motion'],
                    'vendor-icons': ['lucide-react'],
                    'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-breaks'],
                }
            }
        }
    }
})
