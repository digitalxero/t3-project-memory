import { build } from "esbuild";
await build({
  entryPoints: ["src/plugin.mjs"],
  outfile: "dist/plugin.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "eof",
});
