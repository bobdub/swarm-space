import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    nodePolyfills({
      // Enable polyfills for specific modules
      include: ['events', 'path', 'crypto', 'stream', 'buffer'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub out problematic Node.js modules
      'bittorrent-dht': path.resolve(__dirname, './src/lib/p2p/transports/stubs/dht-stub.ts'),
      'torrent-discovery': path.resolve(__dirname, './src/lib/p2p/transports/stubs/discovery-stub.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    exclude: ['webtorrent', 'gun'],
  },
  build: {
    rollupOptions: {
      external: ['webtorrent', 'gun', 'bittorrent-dht', 'torrent-discovery'],
    },
  },
}));
