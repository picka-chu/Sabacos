import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node:sqlite does not behave well inside worker_threads; run in child processes.
    pool: "forks",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
