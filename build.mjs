import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
await build({
  entryPoints: { bundle: "public/app.js", "extract-office.worker": "public/extract-office.worker.source.js" },
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
await mkdir("public/extraction-assets/core", { recursive: true });
await mkdir("public/extraction-assets/lang", { recursive: true });
await mkdir("public/extraction-assets/licenses", { recursive: true });
await Promise.all([
  cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/extraction-assets/pdf.worker.mjs"),
  cp("node_modules/pdfjs-dist/cmaps", "public/extraction-assets/cmaps", { recursive: true }),
  cp("node_modules/pdfjs-dist/standard_fonts", "public/extraction-assets/standard_fonts", { recursive: true }),
  cp("node_modules/pdfjs-dist/wasm", "public/extraction-assets/pdf-wasm", { recursive: true }),
  cp("node_modules/tesseract.js/dist/worker.min.js", "public/extraction-assets/ocr-worker.js"),
  cp("node_modules/tesseract.js-core", "public/extraction-assets/core", { recursive: true }),
  cp("node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "public/extraction-assets/lang/eng.traineddata.gz"),
  ...["pdfjs-dist", "mammoth", "read-excel-file"].map(name => cp(`node_modules/${name}/LICENSE`, `public/extraction-assets/licenses/${name}.txt`)),
  cp("node_modules/tesseract.js/LICENSE.md", "public/extraction-assets/licenses/tesseract.js.txt"),
]);
