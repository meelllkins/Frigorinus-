import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icon-192.png', 'icon-512.png'],
      workbox: {
        // El bundle de la app pasó los 2 MiB que workbox precachea por defecto, y ante eso
        // el plugin no avisa: aborta el build (así se cayó el deploy en Vercel).
        // Se sube a 3 MiB para que el chunk actual (~2.1 MB) entre en el precache.
        // OJO: es un techo, no una solución de tamaño. Si el bundle vuelve a acercarse,
        // lo que corresponde es partirlo, no seguir subiendo este número.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'Frigorinus Logística',
        short_name: 'Frigorinus',
        description: 'Control de cobros de planta',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
