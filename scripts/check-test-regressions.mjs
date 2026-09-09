import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Targeted checks from UNIT_TEST_AUDIT.md, not an exhaustive mutation score.
// Mutate a throwaway copy, so interrupted runs cannot change working source.
const run = promisify(execFile);
const root = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), "erp-test-regressions-"));
const cases = [
  ["zero retry backoff", "app/_components/upload.ts", "[1000, 3000]", "[0, 0]"],
  ["incorrect intermediate progress", "app/_components/upload.ts", "onProgress(Math.round((e.loaded / e.total) * 100))", "onProgress(100)"],
  ["wrong creation HTTP method", "app/_components/TicketForm.tsx", 'method: "POST"', 'method: "PUT"'],
  ["missing required inputs", "app/_components/TicketForm.tsx", "          required\n", ""],
  ["missing creation navigation", "app/_components/TicketForm.tsx", 'router.push("/dashboard");', 'void "/dashboard";'],
  ["incorrect email success result", "lib/email.ts", "    return true;", "    return false;"],
  ["incorrect email client heading", "lib/email.ts", ">Client</td>", ">Customer</td>"],
  ["incorrect upload timeout (control)", "app/_components/upload.ts", "xhr.timeout = 120_000;", "xhr.timeout = 1;"],
];
async function check(label, expectFailure) {
  const report = path.join(directory, "result.json");
  await rm(report, { force: true });
  let failed = false;
  try {
    await run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${report}`],
      { cwd: directory, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    if (error.killed || error.signal || typeof error.code !== "number") throw error;
    failed = true;
  }
  const result = JSON.parse(await readFile(report, "utf8"));
  // Startup/import failures do not count as detecting a behavioral regression.
  if (!result.numTotalTests || (expectFailure && (!failed || !result.numFailedTests)) || (!expectFailure && failed)) {
    throw new Error(`${label}: unexpected test result (${result.numPassedTests} passed, ${result.numFailedTests} failed)`);
  }
  console.log(`${label}: ${expectFailure ? "detected" : "passed"} (${result.numFailedTests} failing tests)`);
}
try {
  for (const name of ["app", "lib", "tests", "vitest.config.ts", "vitest.setup.ts", "tsconfig.json", "package.json"]) {
    await cp(path.join(root, name), path.join(directory, name), { recursive: true });
  }
  await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  await check("Unmodified baseline", false);
  for (const [label, filename, originalText, replacement] of cases) {
    const filenameInCopy = path.join(directory, filename);
    const source = await readFile(filenameInCopy, "utf8");
    if (!source.includes(originalText)) throw new Error(`${label}: update the mutation target after the source refactor`);
    try {
      await writeFile(filenameInCopy, source.replaceAll(originalText, replacement));
      await check(label, true);
    } finally { await writeFile(filenameInCopy, source); }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
