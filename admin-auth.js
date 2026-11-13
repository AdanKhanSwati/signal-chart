(()=>{'use strict';
const $=id=>document.getElementById(id);
const status=$('admin-status'),form=$('admin-form'),submit=$('admin-submit'),emailBtn=$('admin-email-link'),resetBtn=$('admin-password-reset'),recovery=$('admin-recovery-form');
const adminStorageKey='signalchart-superadmin-auth-v1';
let auth=null,busy=false,recovering=false;
function message(value,error=false){status.textContent=value;status.dataset.error=error?'true':'false'}
function lock(value){busy=value;submit.disabled=value;emailBtn.disabled=value;resetBtn.disabled=value}
function showRecovery(){
 recovering=true;form.hidden=true;
 const actions=document.querySelector('.gate-helper-actions');if(actions)actions.hidden=true;
 recovery.hidden=false;
 message('Recovery link verified. Set a new password to continue.');
}
async function init(){
 try{
  const response=await fetch('/api/config',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error('Authentication configuration is unavailable.');
  const config=await response.json();
  if(!config.authReady||!config.supabaseUrl||!config.supabaseAnonKey)
   throw Error('Administrator authentication is not configured.');
  if(!window.supabase?.createClient){
   await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('Could not load the secure sign-in service.'));document.head.append(s)});
  }
  if(!window.supabase?.createClient)throw Error('Secure sign-in service is unavailable.');
  auth=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{
   storageKey:adminStorageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'
  }});
  auth.auth.onAuthStateChange((event)=>{
   if(event==='PASSWORD_RECOVERY')showRecovery();
  });
  const current=await auth.auth.getSession();
  if(recovering||new URLSearchParams(location.hash.slice(1)).get('type')==='recovery'||new URLSearchParams(location.search).get('type')==='recovery'){
   if(!recovering)message('Validating your password recovery link…');
   return;
  }
  if(current.data.session?.access_token){await authorize(current.data.session.access_token);return}
  message('Enter your administrator credentials to continue.');
 }catch(error){message(error.message||'Administrator login is temporarily unavailable.',true)}
}
async function authorize(token){
 const response=await fetch('/api/admin-session',{method:'GET',cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
 if(response.status===403){await auth.auth.signOut();message('This account is not authorized for SignalChart administration.',true);return false}
 if(response.status===401){await auth.auth.signOut();message('Your administrator session expired. Please sign in again.',true);return false}
 if(!response.ok){message('Administrator verification is unavailable. Try again later.',true);return false}
 const result=await response.json();
 if(result.authorized!==true){message('Administrator authorization could not be verified.',true);return false}
 location.replace('/ops.html');return true;
}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy||!auth)return;
 const email=$('admin-email').value.trim(),password=$('admin-password').value;
 lock(true);message('Verifying your administrator account…');
 try{
  const {data,error}=await auth.auth.signInWithPassword({email,password});
  if(error)throw error;
  if(!data?.session?.access_token)throw Error('Verified administrator sign-in is required.');
  await authorize(data.session.access_token);
 }catch(error){message(error.message||'Could not sign in.',true)}
 finally{lock(false);$('admin-password').value=''}
});
emailBtn.addEventListener('click',async()=>{
 if(busy||!auth)return;
 const email=$('admin-email').value.trim();if(!email||!$('admin-email').checkValidity()){message('Enter a valid administrator email first.',true);return}
 lock(true);
 try{
  const {error}=await auth.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+'/admin-login.html'}});
  if(error)throw error;
  message('If that administrator account can receive sign-in links, check its inbox. Open the link in the same browser.');
 }catch(error){message(error.message||'Unable to send sign-in link.',true)}
 finally{lock(false)}
});
resetBtn.addEventListener('click',async()=>{
 if(busy||!auth)return;
 const email=$('admin-email').value.trim();
 if(!email||!$('admin-email').checkValidity()){message('Enter the verified administrator email first.',true);return}
 lock(true);
 try{
  const {error}=await auth.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/admin-login.html'});
  if(error)throw error;
  message('If this email is eligible, a secure recovery link has been sent. Open it in this browser, then set your new password.');
 }catch(error){message(error.message||'Unable to send recovery email.',true)}
 finally{lock(false)}
});
recovery.addEventListener('submit',async e=>{
 e.preventDefault();if(!auth||busy||!recovering)return;
 const password=$('admin-new-password').value,confirm=$('admin-confirm-password').value;
 if(password.length<12||password!==confirm){message('Use at least 12 characters and ensure the passwords match.',true);return}
 lock(true);const btn=$('admin-recovery-submit');btn.disabled=true;
 try{
  const current=await auth.auth.getSession();
  if(!current.data.session?.access_token)throw Error('Recovery session expired. Request another password reset.');
  const check=await fetch('/api/admin-session',{cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+current.data.session.access_token}});
  if(!check.ok||(await check.json()).authorized!==true)throw Error('This account does not have administrator permission.');
  const {error}=await auth.auth.updateUser({password});
  if(error)throw error;
  $('admin-new-password').value='';$('admin-confirm-password').value='';
  message('Password changed. Opening the administration console…');
  location.replace('/ops.html');
 }catch(error){message(error.message||'Password update failed.',true)}
 finally{lock(false);btn.disabled=false}
});
init();
})();
