import { defineConfig } from "vitest/config";

// Standalone vitest config (does NOT extend vite.config.ts) so the
// dev server's PORT/BASE_PATH env-var requirements don't apply to tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});
