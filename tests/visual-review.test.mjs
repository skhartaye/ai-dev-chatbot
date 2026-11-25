import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";
test("visual download waits for the rendered comparison, and closing releases previews and the download URL", async () => {
  const result = await build({
    entryPoints: ["public/edit-review.js"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Review",
    plugins: [
      {
        name: "preview-boundary",
        setup(b) {
          b.onResolve(
            {
              filter:
                /\/(cloud|attachment-store|edit-file|visual-edit-review)\.js$/,
            },
            (args) => ({
              path: args.path.split("/").at(-1),
              namespace: "test",
            }),
          );
          b.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents:
              path === "cloud.js"
                ? `export const downloadAttachment=async()=>new Blob(['original']);`
                : path === "attachment-store.js"
                  ? `export const getFile=async()=>new Blob(['original']);export const putFile=async()=>{};`
                  : path === "edit-file.js"
                    ? `export const validateFileEdit=(p,files)=>files[0];export const editFile=async()=>({kind:'image',blob:new Blob(['edited']),name:'image-edited.png',log:[{location:'Image',description:'Rotate 90 degrees.'}]});`
                    : `export const mountVisualReview=()=>new Promise(resolve=>{window.previewStarted=true;window.finishPreview=()=>resolve(()=>{window.previewReleased=true;});});`,
          }));
        },
      },
    ],
  });
  const dom = new JSDOM('<!doctype html><div id="answer"></div>', {
      url: "https://kahuron.netlify.app",
      runScripts: "outside-only",
    }),
    w = dom.window;
  w.Blob = Blob;
  w.AbortController = AbortController;
  w.URL.createObjectURL = () => "blob:edited-file";
  w.URL.revokeObjectURL = () => {
    w.revoked = true;
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  try {
    runInContext(result.outputFiles[0].text, dom.getInternalVMContext());
    w.Review.appendEditReviews(
      w.document.querySelector("#answer"),
      [
        {
          fileId: "file",
          name: "image.png",
          changes: [{ op: "rotate", degrees: 90 }],
        },
      ],
      [{ id: "file", name: "image.png" }],
    );
    w.document.querySelector(".edit-proposal button").click();
    await new Promise((r) => setTimeout(r, 20));
    const download = w.document.querySelector(".edit-review a");
    assert.equal(w.previewStarted, true);
    assert.equal(download.hidden, true);
    assert.equal(download.hasAttribute("href"), false);
    w.finishPreview();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(download.hidden, false);
    assert.equal(download.download, "image-edited.png");
    w.Review.closeEditReview();
    assert.equal(w.previewReleased, true);
    assert.equal(w.revoked, true);
    assert.equal(w.document.querySelector("dialog").open, false);
  } finally {
    dom.window.close();
  }
});
