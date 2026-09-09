import { defineConfig } from "vitest/config";
import path from "node:path";

const url = process.env.ERP_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/erp_test") {
  throw new Error("Run integration tests through npm run test:integration to create a disposable database.");
}
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 15000 },
});
