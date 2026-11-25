import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { accountInstructions } from '../shared/ai-instructions.mjs';

// Explicit columns keep auth credentials and worker lease tokens out of the archive.
const tables = [
  ['conversations', 'id,title,title_is_manual,created_at', 'owner_id', 'created_at'],
  ['prompts', 'id,conversation_id,content,compilation_id,revision_of,created_at,conversations!inner(owner_id)', 'conversations.owner_id', 'created_at'],
  ['compilations', 'id,conversation_id,status,answer,model,usage,attempts,available_at,error_code,created_at,completed_at,regeneration_of,conversations!inner(owner_id)', 'conversations.owner_id', 'created_at'],
  ['attachments', 'id,prompt_id,name,mime_type,size,storage_path,created_at,prompts!inner(conversations!inner(owner_id))', 'prompts.conversations.owner_id', 'created_at'],
  ['compilation_events', 'id,compilation_id,status,recorded_at,compilations!inner(conversations!inner(owner_id))', 'compilations.conversations.owner_id', 'recorded_at'],
];

export async function buildAccountExport({ db, user, local, isCurrent, getLocalFile, signal, onProgress = () => {} }) {
  const check = () => {
    signal?.throwIfAborted();
    if (!isCurrent()) throw new Error('Account changed. Open Settings and export again.');
  };
  check();
  if (!user?.id) throw new Error('Sign in before exporting your account.');
  const startedAt = new Date().toISOString();
  const data = {
    format: 'kahuron-account-export', version: 1, startedAt,
    account: { id: user.id, email: user.is_anonymous ? null : user.email, createdAt: user.created_at, instructions: accountInstructions(user) },
    browser: local,
  };
  for (const [table, columns, owner, date] of tables) {
    data[table] = [];
    onProgress('Reading saved chats…');
    for (let offset = 0; ; offset += 1000) {
      check();
      let query = db.from(table).select(columns).eq(owner, user.id).lte(date, startedAt).order(date).order('id').range(offset, offset + 999);
      if (signal) query = query.abortSignal(signal);
      const result = await query;
      check();
      if (result.error || !Array.isArray(result.data)) throw new Error('Could not read all account data. Reconnect and export again.');
      for (const row of result.data) {
        const { conversations, prompts, compilations, ...record } = row;
        data[table].push(record);
      }
      if (result.data.length < 1000) break;
    }
  }
  const chunks = [];
  let zipError;
  const archive = new Zip((error, chunk) => { if (error) zipError = error; else chunks.push(chunk); });
  const add = (path, bytes) => {
    check();
    const entry = new ZipPassThrough(path); archive.add(entry); entry.push(bytes, true);
    if (zipError) throw zipError;
  };
  const name = value => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 150) || 'file';
  const files = new Map(data.attachments.map(file => [file.id, file]));
  // Only this account's in-memory drafts and outbox are supplied, never a browser-wide scan.
  for (const draft of Object.values(local.drafts || {})) for (const file of draft.attachments || []) if (!files.has(file.id)) files.set(file.id, file);
  for (const action of local.pendingDelivery || []) for (const file of action.prompt?.attachments || []) if (!files.has(file.id)) files.set(file.id, file);
  data.files = [];
  let index = 0;
  try {
    for (const file of files.values()) {
      check(); onProgress(`Preparing files ${++index} of ${files.size}…`);
      const office = /\.(docx|xlsx)$/i.test(file.name);
      const base = `files/${name(file.id)}/${name(file.name)}`;
      let blob;
      if (file.storage_path) {
        const result = await db.storage.from('chat-attachments').download(file.storage_path);
        if (result.error) throw new Error('Could not download every saved file. Reconnect and export again.');
        blob = result.data;
      } else blob = await getLocalFile(file.id);
      check();
      if (!blob || blob.size !== file.size) throw new Error('A pending attachment is unavailable on this device. Reattach it before exporting.');
      const path = office ? `${base}.extracted.txt` : base;
      add(path, new Uint8Array(await blob.arrayBuffer()));
      const record = { id: file.id, name: file.name, path };
      if (office) {
        const original = await getLocalFile(`${file.id}:original`);
        check();
        record.originalAvailable = Boolean(original);
        if (original) { record.originalPath = base; add(base, new Uint8Array(await original.arrayBuffer())); }
      }
      data.files.push(record);
    }
    // Storage object paths are internal; archive paths above are sufficient for export readers.
    for (const file of data.attachments) delete file.storage_path;
    data.finishedAt = new Date().toISOString();
    add('account.json', strToU8(JSON.stringify(data, null, 2)));
    add('README.txt', strToU8('Kahuron account export\n\naccount.json contains saved conversations, prompts, answers, usage reports, queue history, account instructions, and drafts/pending delivery from the exporting browser. It is a read-only export, not an import format.\n\nFiles are listed in account.json > files. Word/Excel cloud copies are extracted text. Original Office files are included only when present on this browser; originalAvailable records this. Edited copies previously downloaded by you are not retained by the service.\n\nRows created after the export started are excluded. Answers and queue status can change while exporting; this is not a transactional database backup. No login credentials are included. Keep this archive private.\n'));
    archive.end();
    check(); if (zipError) throw zipError;
    return { blob: new Blob(chunks, { type: 'application/zip' }), conversations: data.conversations.length, missingOriginals: data.files.filter(f => f.originalAvailable === false).length };
  } catch (error) { archive.terminate(); throw error; }
}

export function downloadAccountExport(doc, blob) {
  const url = URL.createObjectURL(blob), link = doc.createElement('a');
  link.href = url; link.download = `kahuron-account-${new Date().toISOString().slice(0, 10)}.zip`;
  doc.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
