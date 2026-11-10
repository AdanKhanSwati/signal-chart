# SignalChart — WhatsApp verification visibility and delivery readiness

Date: 2026-11-10  
Branch: `signalchart-recovery-staging`  
Status: **UI fixed and tested in staging source. Real WhatsApp OTP delivery NOT enabled. Not released.**

## Why it was missing

1. `account.html` placed the phone verification controls inside the member-only area, so unsigned visitors could not locate the process.
2. `signals.html` had no prominent link to phone verification.
3. `sc-trial-ui.js` initialized its own Supabase client and did not reliably refresh its verification form after a same-page sign-in through `candriva-v2.js`.
4. The preview's `SC_TRIAL_PHONE_DELIVERY_ENABLED` flag is disabled.
5. Live Supabase Auth public settings inspection returned **HTTP 200**, `external.phone=false`, `sms_provider=twilio`, `external.email=true`. Having Twilio selected is not proof that a Twilio WhatsApp sender or OTP delivery is configured.

## Changes implemented in staging source

- A prominent, visible WhatsApp verification guide on Account, including before login.
- A direct verification path on the Trading Signals page.
- The guide reflects whether the backend says WhatsApp OTP sending is enabled; it does not claim a code will be sent when disabled.
- After Supabase `SIGNED_IN`, `SIGNED_OUT` or `USER_UPDATED`, Account notifies the trial component and it refreshes immediately without needing a browser reload.
- Signed-in users with an eligible trial can see the mobile-number and OTP forms; new requests are disabled until the provider is ready.
- OTP guidance uses WhatsApp rather than SMS.
- Responsive scoped styles for the new guide.
- New `tests/whatsapp-visibility.test.js` covers discoverability, state changes, and fail-closed delivery checks.

The full isolated suite passed **148 tests, zero failures**. The historical release source gate still blocks release for **11 unverified original files**.

## Requirements for genuine WhatsApp OTP

1. Activate **Authentication → Providers → Phone** in the connected Supabase project.
2. Configure a working Twilio Verify WhatsApp or Twilio WhatsApp sender (including any required sender/template approval) in the relevant provider account. Configure Supabase provider credentials directly in the provider dashboards; never commit them to GitHub or paste them into a chat.
3. With a dedicated, email-verified test account, test `PUT /auth/v1/user` with the desired phone number and `channel:'whatsapp'`, then `POST /auth/v1/verify` with `type:'phone_change'`. Confirm the resulting Supabase user ID, exact phone number and `phone_confirmed_at`. The backend already checks these before granting a trial.
4. Only after real successful delivery and code verification, enable `SC_TRIAL_PHONE_DELIVERY_ENABLED=true` for the target environment. Keep WhatsApp provider errors fail-closed; no unadvertised SMS fallback.
5. Verify anti-abuse rules: one 72-hour trial per verified number, three unique premium unlocks; same unlocked signals can reopen until the term expires.
6. Perform a protected preview deployment only within the user's conservative five-assistant-deployments-per-24-hours limit. Production release requires clearing the source gate and broader QA.

## Current deployment state

No new Vercel preview or production deployment was created for this change because of the user-set deployment budget. Existing deployed URLs still serve older code, so the newly visible guides will not appear there until a new approved deployment. **Automatic signal publishing, payment collection and WhatsApp message sending remain disabled.**

Official references:
- https://supabase.com/docs/guides/auth/phone-login
- https://supabase.com/docs/reference/javascript/auth-signinwithotp
- https://supabase.com/docs/guides/auth/auth-mfa/phone
