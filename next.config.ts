import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AGENTS.md는 CLAUDE.md와 같은 내용으로 직접 관리한다. 에이전트가 띄운 next dev가 블록을 붙이지 않게 한다.
  agentRules: false,
  async headers() {
    return [
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
    ];
  },
};

export default nextConfig;
