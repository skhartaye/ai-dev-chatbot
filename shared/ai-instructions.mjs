export const INSTRUCTIONS_LIMIT = 4000;
export function validateInstructions(value) {
  if (typeof value !== 'string' || value.length > INSTRUCTIONS_LIMIT)
    throw new Error(`Use up to ${INSTRUCTIONS_LIMIT.toLocaleString('en-US')} characters.`);
  return value.trim();
}
export function accountInstructions(user) {
  try { return validateInstructions(user?.user_metadata?.kahuron_instructions ?? ''); }
  catch { return ''; }
}
