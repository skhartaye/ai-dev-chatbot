import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc="/extraction-assets/pdf.worker.mjs";

export async function createPdfPreview(blob,canvas) {
  const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,
    cMapUrl:"/extraction-assets/cmaps/",cMapPacked:true,standardFontDataUrl:"/extraction-assets/standard_fonts/",wasmUrl:"/extraction-assets/pdf-wasm/"});
  let pdf;
  try { pdf=await loading.promise; }
  catch(error){await loading.destroy();throw error;}
  let active;
  return {
    pages:pdf.numPages,
    async render(number) {
      const page=await pdf.getPage(number);
      const base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(1.6,1200/Math.max(base.width,base.height))});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      active=page.render({canvasContext:canvas.getContext("2d"),viewport});
      await active.promise;page.cleanup();
    },
    async destroy(){active?.cancel();await loading.destroy();canvas.width=canvas.height=0;},
  };
}
