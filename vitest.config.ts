import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30000,
    passWithNoTests: false,
    setupFiles: [path.resolve(workspaceRoot, "artifacts/api-server/tests/setup.ts")],
  },
});
