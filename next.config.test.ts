import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("Next.js security headers", () => {
  it("runs in the node environment", () => {
    expect(typeof document).toBe("undefined");
  });

  it("sets the required headers on every route", async () => {
    expect(await nextConfig.headers!()).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ]);
  });
});

describe("Next.js agent rules", () => {
  it("keeps next dev from rewriting the hand-maintained AGENTS.md", () => {
    expect(nextConfig.agentRules).toBe(false);
  });
});

describe("PDF upload function bundle", () => {
  it("keeps pdfjs-dist external and includes CID maps, fonts and the worker", () => {
    expect(nextConfig.serverExternalPackages).toEqual(["pdfjs-dist"]);
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/api/uploads": [
        "./node_modules/pdfjs-dist/cmaps/**/*",
        "./node_modules/pdfjs-dist/standard_fonts/**/*",
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      ],
    });
  });
});
