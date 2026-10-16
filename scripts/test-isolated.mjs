import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { storageFixture } from "./storage-fixture.mjs";

// Always create our own local database. Never load or accept DATABASE_URL from
// the caller or .env; no shared database can be selected by this harness.
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
const port = await freePort();
const directory = await mkdtemp(path.join(tmpdir(), "erp-test-db-"));
const password = randomBytes(24).toString("hex");
const pg = new EmbeddedPostgres({ databaseDir: path.join(directory, "data"), port,
  user: "postgres", password, persistent: false, createPostgresUser: false,
  postgresFlags: ["-h", "127.0.0.1", "-k", directory], onLog: () => {}, onError: () => {},
});
const mode = process.argv[2] ?? "integration";
if (!["integration", "e2e"].includes(mode)) throw new Error("Expected integration or e2e");
let child;
let storage;
let started = false;
try {
  await pg.initialise(); await pg.start(); started = true;
  await pg.createDatabase("erp_test");
  const client = pg.getPgClient("erp_test", "127.0.0.1"); await client.connect();
  const tokens = {};
  try {
    await client.query(await readFile("tests/database.sql", "utf8"));
    const exportIndexes = await readFile("prisma/sql/20261017_ticket_export_indexes.sql", "utf8");
    // CONCURRENTLY must run one statement per transaction, including on rerun.
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const statement of exportIndexes.split(";").filter((sql) => sql.trim())) await client.query(statement);
    }
    await client.query(await readFile("prisma/sql/20260910_portal_sessions.sql", "utf8"));
    // Verify the additive rollout SQL can be applied twice safely.
    await client.query(await readFile("prisma/sql/20260910_portal_sessions.sql", "utf8"));
    for (const [role, email] of Object.entries({ employee: "employee@example.test", admin: "finance@example.test", other: "other@example.test" })) {
      tokens[role] = randomBytes(32).toString("hex");
      await client.query('INSERT INTO "ReimbursementSession" ("tokenHash", email, "expiresAt") VALUES ($1,$2,$3)', [createHash("sha256").update(tokens[role]).digest("hex"), email, new Date(Date.now() + 3600000)]);
    }
  } finally { await client.end(); }
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/erp_test?connection_limit=10`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, ERP_TEST_DATABASE_URL: url,
    ADMIN_EMAILS: "finance@example.test", ERP_TEST_SESSIONS: JSON.stringify(tokens),
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REDIRECT_URI: "",
    RESEND_API_KEY: "", RESEND_FROM: "", RESEND_REPLY_TO: "", APP_BASE_URL: "",
    R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET: "test", R2_PUBLIC_BASE_URL: "", R2_ENDPOINT: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const args = mode === "integration"
    ? ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(3)]
    : ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(3)];
  if (mode === "e2e") {
    env.ERP_TEST_PORT = String(await freePort());
    storage = await storageFixture(`http://127.0.0.1:${env.ERP_TEST_PORT}`);
    env.R2_ENDPOINT = storage.endpoint;
    if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && existsSync("/usr/bin/google-chrome")) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/google-chrome";
  }
  console.log(`Running ${mode} checks against a new disposable Postgres database.`);
  child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", terminate); process.once("SIGTERM", terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
  } finally { process.off("SIGINT", terminate); process.off("SIGTERM", terminate); }
} finally {
  try { if (storage) await storage.close(); }
  finally {
    try { if (started) await pg.stop(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

// embedded-postgres installs an exit hook that otherwise discards exitCode on
// beforeExit. Exit explicitly after awaited cleanup so failing tests fail CI.
process.exit(process.exitCode ?? 0);
