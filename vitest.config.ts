import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { readdirSync } from "node:fs";

function routeFiles(directory: string): string[] {
  return readdirSync(path.join(__dirname, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? routeFiles(file) : entry.name === "route.ts" ? [file] : [];
  });
}
const criticalFiles = [
  ...["auth", "tickets", "validation", "totals", "attachment-access", "email"].map((name) => `lib/${name}.ts`),
  ...routeFiles("app/api"),
];
const interactiveFiles = ["app/_components/TicketForm.tsx", "app/_components/upload.ts",
  "app/admin/_components/AdminEntriesTable.tsx", "app/admin/_components/AdminReviewDialog.tsx"];
// One glob per source file enforces individual gates without imposing them on
// presentation files. Escape dynamic route brackets so they match literally.
const filePattern = (file: string) => file.replace(/[[\]]/g, "\\$&");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    projects: [
      { extends: true, test: {
        name: "server", environment: "node", setupFiles: ["./tests/setup.server.ts"],
        include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"],
      } },
      { extends: true, test: {
        name: "ui", environment: "jsdom", setupFiles: ["./vitest.setup.ts"],
        include: ["app/_components/**/*.test.{ts,tsx}", "app/admin/_components/**/*.test.{ts,tsx}"],
      } },
    ],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "lib/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 80, lines: 80, branches: 75, functions: 75,
        ...Object.fromEntries(criticalFiles.map((file) => [filePattern(file), {
          lines: 95, statements: 95, branches: 90, functions: 95,
        }])),
        ...Object.fromEntries(interactiveFiles.map((file) => [filePattern(file), {
          lines: 90, statements: 90, branches: 85, functions: 90,
        }])),
      },
    },
  },
});
