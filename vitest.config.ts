import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const excluded = [...configDefaults.exclude, "**/.next/**", ".claude/worktrees/**"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    exclude: excluded,
    projects: [
      {
        extends: true,
        test: {
          name: "unit-node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: [...excluded, "**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: [...excluded, "**/*.db.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["**/*.db.test.ts"],
        },
      },
    ],
  },
});
