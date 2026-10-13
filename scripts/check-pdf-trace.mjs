import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const tracePath = join(root, ".next/server/app/api/uploads/route.js.nft.json");
if (!existsSync(tracePath)) {
  console.error(`PDF trace missing: ${tracePath}. Run npm run build first.`);
  process.exit(1);
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

try {
  const pdfDir = join(root, "node_modules/pdfjs-dist");
  const cmaps = listFiles(join(pdfDir, "cmaps"));
  const required = new Set([
    ...cmaps,
    join(pdfDir, "cmaps/UniKS-UCS2-H.bcmap"),
    join(pdfDir, "cmaps/Adobe-Korea1-UCS2.bcmap"),
    join(pdfDir, "legacy/build/pdf.worker.mjs"),
    join(pdfDir, "legacy/build/pdf.mjs"),
  ]);
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  const tracedFiles = new Set(trace.files.map((file) => resolve(dirname(tracePath), file)));
  const missing = [...required].filter((file) => !tracedFiles.has(file));
  if (missing.length) {
    console.error(`PDF trace missing ${missing.length} file(s): ${missing.slice(0, 5).map((file) => relative(pdfDir, file)).join(", ")}`);
    process.exit(1);
  }
  console.log(`PDF trace OK: ${cmaps.length} cmap files, legacy/build/pdf.worker.mjs and legacy/build/pdf.mjs (${required.size} required files).`);
} catch {
  console.error(`Cannot verify PDF trace: ${tracePath}. Check the trace and installed pdfjs-dist files.`);
  process.exit(1);
}
