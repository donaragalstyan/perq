import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Domain unit tests need no DOM; spatial/DB integration tests use the pg pool directly.
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "poc/**", ".next/**"],
    // Integration tests share ONE local database and each file TRUNCATEs between tests.
    // Run test files sequentially (single fork) so parallel files can't wipe each other's
    // rows mid-test. Pure unit tests are fast, so the cost is negligible.
    fileParallelism: false,
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
