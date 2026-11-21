import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { execSync } from "child_process";
import type { Plugin } from "vite";

// Build stamp: peers swap it over the mesh and compare `builtAt` to learn
// that a newer build is deployed (src/lib/p2p/appVersion.ts). version.json
// carries the same stamp so a tab can ask its own host what is live.
function resolveBuildId(builtAt: number): string {
  const fromEnv = process.env.VITE_BUILD_ID?.trim();
  if (fromEnv) return fromEnv.slice(0, 64);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || builtAt.toString(36);
  } catch {
    return builtAt.toString(36);
  }
}
const BUILT_AT = Date.now();
const APP_BUILD = { id: resolveBuildId(BUILT_AT), builtAt: BUILT_AT };

function buildStampPlugin(): Plugin {
  return {
    name: "swarm-build-stamp",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(APP_BUILD) });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD),
  },
  plugins: [
    react(),
    buildStampPlugin(),
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
      'webtorrent': path.resolve(__dirname, './src/lib/p2p/transports/stubs/webtorrent-stub.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    exclude: ['webtorrent'],
  },
  build: {
    rollupOptions: {
      external: ['webtorrent', 'bittorrent-dht', 'torrent-discovery'],
    },
  },
}));
