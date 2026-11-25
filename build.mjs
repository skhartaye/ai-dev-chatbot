import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const publicRoot=resolve("public");
for (const name of ["chunks","extraction-assets"]) {
  const target=resolve(publicRoot,name);
  if(dirname(target)!==publicRoot) throw new Error("Generated output is outside public");
  await rm(target,{recursive:true,force:true});
}
await build({
  entryPoints: { bundle: "public/app.js", "extract-office.worker": "public/extract-office.worker.source.js", "calculate.worker":"public/calculate.worker.source.js", "media-edit.worker":"public/media-edit.worker.source.js" },
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
await mkdir("public/extraction-assets/licenses", { recursive: true });
await Promise.all([
  ...["mammoth", "read-excel-file"].map(name => cp(`node_modules/${name}/LICENSE`, `public/extraction-assets/licenses/${name}.txt`)),
  cp("node_modules/pdfjs-dist/LICENSE", "public/extraction-assets/licenses/pdfjs-dist.txt"),
  cp("node_modules/lucide/LICENSE", "public/extraction-assets/licenses/lucide.txt"),
  cp("node_modules/fflate/LICENSE", "public/extraction-assets/licenses/fflate.txt"),
  cp("node_modules/pdf-lib/LICENSE.md","public/extraction-assets/licenses/pdf-lib.txt"),
  cp("node_modules/image-size/LICENSE","public/extraction-assets/licenses/image-size.txt"),
  cp("node_modules/@ironcalc/wasm/wasm_bg.wasm","public/extraction-assets/ironcalc.wasm"),
  cp("node_modules/@ironcalc/wasm/LICENSE-MIT","public/extraction-assets/licenses/ironcalc.txt"),
  cp("node_modules/@ironcalc/wasm/THIRD-PARTY-NOTICES.md","public/extraction-assets/licenses/ironcalc-third-party.txt"),
  cp("node_modules/@xmldom/xmldom/LICENSE","public/extraction-assets/licenses/xmldom.txt"),
  cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/extraction-assets/pdf.worker.mjs"),
  cp("node_modules/pdfjs-dist/cmaps", "public/extraction-assets/cmaps",{recursive:true}),
  cp("node_modules/pdfjs-dist/standard_fonts", "public/extraction-assets/standard_fonts",{recursive:true}),
  cp("node_modules/pdfjs-dist/wasm", "public/extraction-assets/pdf-wasm",{recursive:true}),
]);
