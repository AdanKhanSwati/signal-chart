# SignalChart — Manual Payment and Admin Access Specification

## Hosting and costs
Keep the existing Vercel Hobby project for development and closed testing. Do not upgrade, provision paid resources or activate paid subscriptions without explicit founder approval. Select an appropriate commercial-compatible platform/plan before paid launch; Vercel Hobby cannot host the commercial service under its current terms.

## Customer payment flow
1. Customer signs in and sees an enabled BTC-mainnet invoice, correct wallet address, quoted amount and transfer instructions.
2. Customer independently transfers BTC from their own wallet/exchange.
3. Customer submits BTC TXID (64 hexadecimal characters), payment screenshot (PNG/JPEG, max 1.4 MB), and optional note.
4. Payment becomes PENDING REVIEW. It must not activate or renew access automatically.
5. Super Admin checks BTC amount, receiving wallet, network, on-chain confirmation and receipt.
6. Super Admin chooses APPROVE or REJECT and records an audit reason. Rejection does not create access. Only APPROVE extends the agreed subscription period. A payment can be reviewed only once.
7. Server stores screenshot privately, never publishes proofs or personal data on GitHub, and rejects duplicate TXIDs across customers.

No automated payment gateway, payment collection API or auto-approval is required.

## Founder-controlled access
- In Super Admin, find an EXISTING verified member and select a custom start/end date and required reason.
- A server-verified administrator creates an immutable grant event. The user's Supabase UID is used, not a client-supplied account email.
- The member receives access until the exact end timestamp, including durations unrelated to the paid monthly plan. Grant expiry locks access automatically if no paid/trial entitlement remains.
- Admin may revoke a specific grant with a reason. Paid subscription remains independently valid.
- All actions record admin ID, timestamp, member ID and reason; server-side checks apply to every protected API, including Android clients.

## What is built vs outstanding
The modules lib/manual-access.js and lib/manual-payments.js, and the entitlement changes, are committed on a non-deploying recovery branch. Their validation and access calculations have tests. They are NOT yet integrated into live Super Admin APIs or customer database.

The original API implementation is not completely recovered. Before activating these features: securely implement/preserve payment storage and uniqueness, verify Super Admin role against Supabase on the server, load events by verified customer UID in lib/candriva-core.js, integrate admin grant/revoke actions, and run real-user end-to-end tests.

## Android
If distributed on Google Play, the customer app's payment UI must comply with Play's payments rules for digital subscriptions, including any permitted alternative-billing exceptions. Web/manual crypto payment does not itself establish a Play exception. No customer billing feature should be published to Google Play before review.
