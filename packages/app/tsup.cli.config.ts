import { defineConfig } from "tsup";

export default defineConfig({
  clean: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  entry: {
    "wikipage-spine": "src/cli/main.ts",
  },
  format: ["cjs"],
  outDir: "bin",
  sourcemap: true,
  splitting: false,
  target: "node20",
});
