import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
        allowedHosts: [
            'novaroom.org',
            'api.novaroom.org',
            'test.pngwr.shop',
            'localhost'
        ]
    },
    build: {
        outDir: '../front-end-export',
    }
})
