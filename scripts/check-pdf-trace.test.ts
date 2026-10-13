import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-pdf-trace.mjs", import.meta.url));
let root: string;
let tracePath: string;
let requiredFiles: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "assetomy-pdf-trace-"));
  tracePath = join(root, ".next/server/app/api/uploads/route.js.nft.json");
  requiredFiles = [
    "cmaps/UniKS-UCS2-H.bcmap", "cmaps/Adobe-Korea1-UCS2.bcmap", "cmaps/another.bcmap",
    "legacy/build/pdf.worker.mjs", "legacy/build/pdf.mjs",
  ].map((file) => join(root, "node_modules/pdfjs-dist", file));
  for (const file of requiredFiles) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeTrace(files: string[]) {
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, JSON.stringify({ version: 1, files: files.map((file) => relative(dirname(tracePath), file)) }));
}

describe("check-pdf-trace", () => {
  it("resolves trace-relative paths and succeeds when all maps and both modules are present", () => {
    writeTrace(requiredFiles);
    const output = execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(output).toContain("3");
    expect(output).toContain("pdf.worker.mjs");
    expect(output).toContain("pdf.mjs");
  });

  it("fails with the missing count and filenames when maps or the worker are omitted", () => {
    writeTrace(requiredFiles.filter((file) => !file.endsWith("UniKS-UCS2-H.bcmap") && !file.endsWith("pdf.worker.mjs")));
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2");
    expect(result.stderr).toContain("UniKS-UCS2-H.bcmap");
    expect(result.stderr).toContain("pdf.worker.mjs");
  });

  it("fails when the main legacy PDF module is omitted", () => {
    writeTrace(requiredFiles.filter((file) => !file.endsWith("/pdf.mjs")));
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pdf.mjs");
  });

  it("fails with the trace path when the build trace is missing", () => {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(tracePath);
  });
});
