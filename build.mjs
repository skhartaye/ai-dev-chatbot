import { build } from "esbuild";
await build({
  entryPoints: ["public/app.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: "public/bundle.js",
  minify: true,
  legalComments: "linked",
});
