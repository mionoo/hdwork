import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const port = Number(env.VITE_DEV_PORT) || 5173

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],

    server: {
      port,
      strictPort: true,
    },

    preview: {
      port,
      strictPort: true,
    },

    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  }
})
