'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
test('Admin-only password recovery is completed through Supabase Auth, never SQL or static secrets',()=>{
 const html=src('admin-login.html'),js=src('admin-auth.js');
 assert.match(html,/id="admin-password-reset"/);
 assert.match(html,/id="admin-recovery-form" hidden/);
 assert.match(html,/autocomplete="new-password"/);
 assert.match(js,/resetPasswordForEmail/);
 assert.match(js,/onAuthStateChange/);
 assert.match(js,/PASSWORD_RECOVERY/);
 assert.match(js,/updateUser\(\{password\}\)/);
 assert.match(js,/\/api\/admin-session/);
 assert.match(js,/if\(!check\.ok/);
 assert.doesNotMatch(js,/encrypted_password|password_hash|service_role|sb_secret_/);
});
