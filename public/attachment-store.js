// Browser-only delivery buffer. Acknowledged file bytes live in private Storage.
let database;
function open() {
  database ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open("kahuron-files",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("files");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error("File storage is unavailable in this browser."));
  });
  return database;
}
async function transaction(mode,action) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("files",mode);
    const request=action(tx.objectStore("files"));
    tx.oncomplete=()=>resolve(request?.result);
    tx.onerror=tx.onabort=()=>reject(new Error("Could not save the attachment on this device."));
  });
}
export const putFile=(id,blob)=>transaction("readwrite",store=>store.put(blob,id));
export const getFile=id=>transaction("readonly",store=>store.get(id));
export async function removeFile(id,keepOriginal=false) {
  await transaction("readwrite",store=>store.delete(id));
  if(!keepOriginal)await transaction("readwrite",store=>store.delete(`${id}:original`));
}

export async function prepareAttachment(file,signal,onProgress,id=crypto.randomUUID()) {
  const {validateFile,extractFile}=await import("./extract-file.js");
  const ext=validateFile(file);
  let blob,mimeType;
  if (["pdf","png","jpg","jpeg","webp"].includes(ext)) {
    mimeType={pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp"}[ext];
    const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
    const ascii=new TextDecoder().decode(header);
    const valid=ext==="pdf"?ascii.startsWith("%PDF-"):ext==="png"?header[0]===137&&ascii.slice(1,4)==="PNG":ext==="webp"?ascii.startsWith("RIFF")&&ascii.slice(8,12)==="WEBP":header[0]===255&&header[1]===216;
    if (!valid) throw new Error("The file contents do not match its format. Export a valid copy.");
    blob=new Blob([file],{type:mimeType});
  } else {
    const text=await extractFile(file,{signal,onProgress});
    if (text.length>100000) throw new Error("This document exceeds 100,000 characters. Split it into smaller documents.");
    mimeType="text/plain";
    blob=new Blob([text],{type:mimeType});
  }
  signal.throwIfAborted();
  const attachment={id,name:file.name,mimeType,size:blob.size};
  await putFile(attachment.id,blob);
  // Originals stay on this device; cloud attachments remain the bounded AI text payload.
  if(["docx","xlsx"].includes(ext)) {
    try { await putFile(`${id}:original`,new Blob([file])); }
    catch(error) {await removeFile(id);throw error;}
  }
  if(signal.aborted) { await removeFile(attachment.id);signal.throwIfAborted(); }
  return attachment;
}
