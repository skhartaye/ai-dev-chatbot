import {createElement,FileText,FileSpreadsheet,Image,Paperclip,Eye,X,Download,ChevronLeft,ChevronRight,FolderOpen} from "lucide";
import {getFile} from "./attachment-store.js";
import {downloadAttachment} from "./cloud.js";
import {reveal} from "./motion.js";

const $=selector=>document.querySelector(selector);
const node=(tag,className,text)=>{const el=document.createElement(tag);el.className=className||"";if(text)el.textContent=text;return el;};
export const fileIcon=(icon,attrs={})=>createElement(icon,{width:20,height:20,"stroke-width":1.65,"aria-hidden":"true",...attrs});
export function filePresentation(file) {
  const extension=file.name.split(".").at(-1).toLowerCase();
  if(extension==="pdf")return {kind:"pdf",label:"PDF document",icon:FileText,mark:"PDF"};
  if(["xlsx","xls","csv"].includes(extension))return {kind:"sheet",label:"Spreadsheet",icon:FileSpreadsheet,mark:extension.toUpperCase()};
  if(["png","jpg","jpeg","webp"].includes(extension))return {kind:"image",label:"Image",icon:Image,mark:extension.toUpperCase()};
  return {kind:"document",label:extension==="docx"?"Word document":"Text document",icon:FileText,mark:extension.toUpperCase()};
}
const blobs=new Map(),urls=new Map();
let conversationId,files=[],removeDraft,previewGeneration=0,pdfPreview,pageNumber=1,previewFile;
const panel=$("#file-panel"),panelDialog=$("#files-dialog"),preview=$("#file-preview-dialog");
const docked=matchMedia("(min-width: 1180px)");
async function readBlob(file) {
  if(!blobs.has(file.id)) {
    const promise=getFile(file.id).catch(()=>null).then(blob=>blob||downloadAttachment(file.id));
    blobs.set(file.id,promise);
    promise.catch(()=>{if(blobs.get(file.id)===promise)blobs.delete(file.id);});
  }
  return blobs.get(file.id);
}
function blobUrl(file,blob) {
  if(!urls.has(file.id)) urls.set(file.id,URL.createObjectURL(blob));
  return urls.get(file.id);
}
export function resetAttachmentUI() {
  previewGeneration++;
  if(preview.open)preview.close();
  void pdfPreview?.destroy();pdfPreview=null;
  for(const url of urls.values())URL.revokeObjectURL(url);
  urls.clear();blobs.clear();
  for(const list of document.querySelectorAll(".file-card-list, .draft-attachments"))list.replaceChildren();
}
window.addEventListener("pagehide",resetAttachmentUI);
function closePanel() {
  if(panelDialog.open)panelDialog.close();
  panel.hidden=true;
  $(".work-area").classList.remove("files-open");
  $("#open-files").setAttribute("aria-expanded","false");
}
function openPanel(focus=true) {
  panel.hidden=false;
  $("#open-files").setAttribute("aria-expanded","true");
  if(docked.matches){$(".work-area").classList.add("files-open");if(focus)$("#close-files").focus({preventScroll:true});}
  else if(!panelDialog.open)panelDialog.showModal();
  syncCards($("#conversation-files"),files);
}
function placePanel() {
  const wasOpen=!panel.hidden;
  if(panelDialog.open)panelDialog.close();
  $(".work-area").classList.remove("files-open");
  (docked.matches?$(".work-area"):panelDialog).append(panel);
  if(wasOpen)openPanel();
}
placePanel();docked.addEventListener("change",placePanel);
$("#open-files").prepend(fileIcon(Paperclip));
$("#open-files").addEventListener("click",()=>panel.hidden?openPanel():closePanel());
$("#close-files").append(fileIcon(X));
$("#close-files").addEventListener("click",()=>{const desktop=docked.matches;closePanel();if(desktop)$("#open-files").focus({preventScroll:true});});
panelDialog.addEventListener("close",()=>{if(panel.parentElement===panelDialog&&!panelDialog.open)closePanel();});
$("#files-empty-icon").append(fileIcon(FolderOpen,{width:34,height:34}));
$("#files-choose").addEventListener("click",()=>{closePanel();$("#attach-files").click();});
$("#preview-close").append(fileIcon(X));
$("#preview-download").prepend(fileIcon(Download));
$("#pdf-previous").append(fileIcon(ChevronLeft));
$("#pdf-next").append(fileIcon(ChevronRight));
preview.addEventListener("close",()=>{if(preview.open)return;previewGeneration++;void pdfPreview?.destroy();pdfPreview=null;$("#preview-image").removeAttribute("src");});
$("#preview-retry").addEventListener("click",()=>{if(previewFile)void openPreview(previewFile);});

function makeCard(file) {
  const card=node("li","file-card");card.dataset.fileId=file.id;
  const button=node("button","file-card-open");button.type="button";
  const visual=node("span","file-visual");
  const copy=node("span","file-copy");
  copy.append(node("span","file-name"),node("span","file-meta"),node("span","file-state"));
  const eye=node("span","file-preview-hint");eye.append(fileIcon(Eye));
  button.append(visual,copy,eye);
  button.addEventListener("click",()=>{if(card.file?.status!=="preparing")void openPreview(card.file);});
  const remove=node("button","file-remove");remove.type="button";remove.append(fileIcon(X,{width:16,height:16}));
  remove.addEventListener("click",()=>removeDraft?.(card.file));
  const progress=node("progress","file-progress");progress.setAttribute("aria-label",`Preparing ${file.name}`);progress.hidden=true;
  card.append(button,remove,progress);
  return card;
}
async function removeCard(card) {
  card.dataset.closing="";card.inert=true;card.setAttribute("aria-hidden","true");
  const animations=card.getAnimations?.()||[];
  if(animations.length)await Promise.race([Promise.allSettled(animations.map(a=>a.finished)),new Promise(resolve=>setTimeout(resolve,350))]);
  card.remove();
}
function syncCards(list,entries,animate=false) {
  const ids=new Set(entries.map(f=>f.id));
  for(const card of Array.from(list.children))if(!ids.has(card.dataset.fileId)&&!card.hasAttribute("data-closing"))void removeCard(card);
  for(const file of entries) {
    let card=Array.from(list.children).find(el=>el.dataset.fileId===file.id&&!el.hasAttribute("data-closing"));
    const fresh=!card;
    if(fresh){card=makeCard(file);if(animate)card.dataset.enter="";list.append(card);}
    card.file=file;
    const presentation=filePresentation(file);
    card.dataset.kind=presentation.kind;card.dataset.status=file.status||"ready";
    card.querySelector(".file-name").textContent=file.name;
    card.querySelector(".file-meta").textContent=presentation.label;
    card.querySelector(".file-state").textContent=file.statusLabel||"Ready to send";
    const opener=card.querySelector(".file-card-open");
    opener.setAttribute("aria-label",`Preview ${file.name}`);
    card.querySelector(".file-state").id=`${list.id}-${file.id}-status`;
    opener.setAttribute("aria-describedby",`${list.id}-${file.id}-status`);
    opener.disabled=file.status==="preparing";
    const remove=card.querySelector(".file-remove");remove.hidden=!file.draft||file.status==="preparing";
    remove.setAttribute("aria-label",`Remove ${file.name}`);
    card.querySelector("progress").hidden=!["preparing","uploading","reading"].includes(file.status);
    if(fresh) {
      const visual=card.querySelector(".file-visual");
      const paper=node("span","file-paper");paper.append(fileIcon(presentation.icon,{width:23,height:23}),node("span","file-extension",presentation.mark));visual.append(paper);
      if(animate&&typeof CSSStartingStyleRule==="undefined")reveal(card);
    }
      if(presentation.kind==="image"&&file.status!=="preparing"&&!card.dataset.thumbnailRequested&&(list.id!=="conversation-files"||!panel.hidden)) {
        card.dataset.thumbnailRequested="true";
        const origin=conversationId;
        void readBlob(file).then(blob=>{if(!card.isConnected||origin!==conversationId)return;const image=node("img","file-thumbnail");image.alt="";image.width=72;image.height=72;image.src=blobUrl(file,blob);card.querySelector(".file-visual").replaceChildren(image);}).catch(()=>{delete card.dataset.thumbnailRequested;});
      }
  }
  list.hidden=!entries.length;
}
export function renderAttachmentUI(c,preparing,onRemove,animate=false) {
  if(conversationId!==c.id){resetAttachmentUI();conversationId=c.id;}
  removeDraft=onRemove;
  const drafts=[...(c.draftAttachments||[]).map(f=>({...f,draft:true})),...preparing.filter(f=>f.conversationId===c.id)];
  files=c.prompts.flatMap((p,index)=>(p.attachments||[]).map(file=>{
    const job=c.jobs.find(j=>j.promptIds.includes(p.id));
    const busy=p.syncing||job?.status==="syncing";
    return {...file,status:busy?"uploading":job?.status==="processing"?"reading":"ready",statusLabel:busy?"Uploading…":job?.status==="processing"?"Reading with AI…":`Message ${index+1} · Saved`};
  })).reverse();
  syncCards($("#draft-attachments"),drafts,animate);
  $("#attachment-tray").hidden=!drafts.length;
  syncCards($("#conversation-files"),files);
  syncCards($("#panel-draft-files"),drafts);
  $("#panel-draft-heading").hidden=!drafts.length;
  $("#panel-saved-heading").hidden=!files.length;
  $("#files-empty").hidden=!!(files.length+drafts.length);
  $("#file-count").textContent=files.length+drafts.length;
  $("#file-panel-count").textContent=`${files.length+drafts.length} file${files.length+drafts.length===1?"":"s"}`;
  $("#empty-state h2").textContent=drafts.length?"Ask about your files.":"What are we building today?";
  $("#empty-state > p").hidden=!!drafts.length;
  if(animate&&drafts.length&&docked.matches&&panel.hidden)openPanel(false);
}
export function showConversationFiles(){openPanel();}

async function renderPdfPage(number) {
  if(!pdfPreview)return;
  const generation=previewGeneration;
  $("#pdf-previous").disabled=$("#pdf-next").disabled=true;
  try {
    await pdfPreview.render(number);
    if(generation!==previewGeneration)return;
    pageNumber=number;$("#pdf-page-label").textContent=`Page ${number} of ${pdfPreview.pages}`;
    $(".file-preview-body").scrollTop=0;
    $("#pdf-previous").disabled=number<=1;$("#pdf-next").disabled=number>=pdfPreview.pages;
    return true;
  }catch{if(generation===previewGeneration){$("#preview-status").textContent="This page could not be rendered. Download the PDF to view it.";$("#preview-retry").hidden=false;}return false;}
}
$("#pdf-previous").addEventListener("click",()=>void renderPdfPage(pageNumber-1));
$("#pdf-next").addEventListener("click",()=>void renderPdfPage(pageNumber+1));
async function openPreview(file) {
  previewFile=file;
  void pdfPreview?.destroy();pdfPreview=null;
  const generation=++previewGeneration;
  $("#preview-title").textContent=file.name;
  $("#preview-kind").textContent=filePresentation(file).label;
  $("#preview-status").textContent="Opening private preview…";
  for(const id of ["preview-image","preview-text","preview-pdf","pdf-controls","preview-download"])$("#"+id).hidden=true;
  $("#preview-retry").hidden=true;
  preview.showModal();
  try {
    const blob=await readBlob(file);
    if(generation!==previewGeneration)return;
    const download=$("#preview-download");download.href=blobUrl(file,blob);
    const converted=file.mimeType==="text/plain"&&/\.(docx|xlsx)$/i.test(file.name);
    download.download=file.name+(converted?".txt":"");download.hidden=false;
    $("#preview-download-label").textContent=converted?"Download text":"Download";
    if(file.mimeType?.startsWith("image/")) {
      const image=$("#preview-image");image.src=blobUrl(file,blob);image.alt=file.name;await image.decode();if(generation!==previewGeneration)return;image.hidden=false;
    }else if(file.mimeType==="application/pdf") {
      $("#preview-pdf").hidden=false;
      const {createPdfPreview}=await import("./pdf-preview.js");
      const pdf=await createPdfPreview(blob,$("#preview-pdf"));
      if(generation!==previewGeneration){await pdf.destroy();return;}
      pdfPreview=pdf;$("#pdf-controls").hidden=false;if(!await renderPdfPage(1))return;
    }else {
      const text=await blob.text();if(generation!==previewGeneration)return;
      $("#preview-text").textContent=text;$("#preview-text").hidden=false;
    }
    if(generation===previewGeneration)$("#preview-status").textContent=converted?"Text preview · original formatting and embedded images aren’t included.":"";
  }catch(error){
    if(generation!==previewGeneration)return;
    $("#preview-status").textContent=error.name==="PasswordException"?"This PDF is password protected. Download it to open with its password.":"Could not open this preview. Check your connection and try again.";
    $("#preview-retry").hidden=false;
  }
}
