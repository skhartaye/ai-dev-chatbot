import { build } from "esbuild";
await build({
  entryPoints: { bundle: "public/app.js" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outdir: "public",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  legalComments: "linked",
});
