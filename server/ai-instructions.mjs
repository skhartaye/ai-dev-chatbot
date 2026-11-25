import { accountInstructions } from '../shared/ai-instructions.mjs';

export async function loadAccountInstructions(db, conversationId) {
  const owner = await db.from('conversations').select('owner_id').eq('id', conversationId).single();
  if (owner.error || !owner.data?.owner_id) throw unavailable();
  const result = await db.auth.admin.getUserById(owner.data.owner_id);
  if (result.error || !result.data?.user) throw unavailable();
  return accountInstructions(result.data.user);
}
function unavailable() {
  const error = new Error('Account preferences unavailable.');
  error.retryable = true;
  return error;
}
