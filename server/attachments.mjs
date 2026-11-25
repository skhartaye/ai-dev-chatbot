import {pdfDetails} from './pdf-details.mjs';
export async function loadAttachments(db,conversationId,compilationIds) {
  const {data,error}=await db.from("attachments")
    .select("*,prompts!inner(conversation_id,compilation_id)")
    .eq("prompts.conversation_id",conversationId)
    .in("prompts.compilation_id",compilationIds)
    .order("created_at");
  if (error) { const e=new Error("Attachments unavailable.");e.retryable=true;throw e; }
  if ((data||[]).reduce((n,a)=>n+a.size,0)>10485760) throw new Error("Attachment size limit exceeded.");
  const result=[];
  for (const file of data||[]) {
    const scope=file.prompts?.compilation_id===compilationIds[0]?"current":"history";
    const {data:blob,error:downloadError}=await db.storage.from("chat-attachments").download(file.storage_path);
    if (downloadError || !blob) { const e=new Error("Attachment download interrupted.");e.retryable=true;throw e; }
    const bytes=Buffer.from(await blob.arrayBuffer());
    if (bytes.length!==file.size) throw new Error("Incomplete attachment.");
    if (file.mime_type==="text/plain") {
      const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      if(text.length>100000) throw new Error("Document text exceeds context limit.");
      result.push({id:file.id,name:file.name,text,scope});
    } else {
      const valid=file.mime_type==="application/pdf"?bytes.subarray(0,5).toString()==="%PDF-":file.mime_type==="image/png"?bytes[0]===137&&bytes.subarray(1,4).toString()==="PNG":file.mime_type==="image/jpeg"?bytes[0]===255&&bytes[1]===216:file.mime_type==="image/webp"?bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP":false;
      if(!valid) throw new Error("Invalid attachment format.");
      const details=file.mime_type==='application/pdf'?await pdfDetails(bytes):undefined;
      result.push({id:file.id,name:file.name,mimeType:file.mime_type,data:bytes.toString("base64"),scope,...(details?{details}:{})});
    }
  }
  return result;
}
