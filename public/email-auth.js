export async function requestEmailLink(auth,email,{upgrade=false}={}) {
  const redirectTo='https://kahuron.netlify.app/chat';
  const result=upgrade
    ?await auth.updateUser({email},{emailRedirectTo:redirectTo})
    :await auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}});
  if(result.error) throw result.error;
}
export function emailError(error) {
  if(['email_exists','user_already_exists','identity_already_exists'].includes(error.code)) return 'This email already has an account. Choose “Sign in to an existing account” below.';
  if(error.status===429||error.code==='over_email_send_rate_limit') return 'Too many email requests. Wait a minute, then try again.';
  if(error.code==='otp_expired'||error.code==='flow_state_expired'||error.code==='bad_code_verifier') return 'This sign-in link expired or was opened in another browser. Request a fresh link here.';
  return 'Could not send the email. Check your connection and email address, then try again.';
}
