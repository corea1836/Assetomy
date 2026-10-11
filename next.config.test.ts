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
