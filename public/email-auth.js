export async function requestEmailLink(auth,email,{upgrade=false}={}) {
  const redirectTo='https://kahuron.netlify.app/chat';
  const result=upgrade
    ?await auth.updateUser({email},{emailRedirectTo:redirectTo})
    :await auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}});
  if(result.error) throw result.error;
}
export async function verifyEmailCode(auth,{email,token,type='email'}) {
  token=token.replace(/\s/g,'');
  if(!/^\d{6,10}$/.test(token)) throw {code:'invalid_code'};
  if(!['email','email_change'].includes(type)) throw {code:'invalid_code'};
  const {data,error}=await auth.verifyOtp({email,token,type});
  if(error)throw error;
  return data;
}
export async function verifyEmailReturn(auth,url) {
  const token_hash=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
  if(!token_hash)return null;
  // Consume bearer material before awaiting the network; never leave it in history.
  url.searchParams.delete('token_hash');url.searchParams.delete('type');
  if(!['email','email_change'].includes(type))throw {code:'invalid_code'};
  const {data,error}=await auth.verifyOtp({token_hash,type});
  if(error)throw error;
  return data;
}
export function emailError(error) {
  if(error.code==='session_changed')return 'Your workspace changed. Request a fresh code for the current account.';
  if(error.code==='invalid_code')return 'Paste the complete numeric code from your email.';
  if(['email_exists','user_already_exists','identity_already_exists'].includes(error.code)) return 'This email already has an account. Choose “Sign in to an existing account” below.';
  if(error.status===429||error.code==='over_email_send_rate_limit') return 'Too many email requests. Wait a minute, then try again.';
  if(['otp_expired','flow_state_expired','bad_code_verifier','flow_state_not_found'].includes(error.code)) return 'This code or link is invalid or expired. Use the newest email, or request a new code.';
  return 'Could not send the email. Check your connection and email address, then try again.';
}
