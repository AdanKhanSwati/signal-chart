# SignalChart Android

Separate customer and super-admin Android packages using Android Browser Helper's Trusted Web Activity (TWA). These are browser-backed Android apps, not a separately reimplemented native trading client. Website changes are reflected immediately; the backend remains authoritative for login, trials, membership and administrator access.

| Variant | Debug application ID | Entry point |
| --- | --- | --- |
| Customer | `pro.signalchart.app.debug` | `/app.html` |
| Admin | `pro.signalchart.app.admin.debug` | `/ops.html` |

Both default to `https://signal-chart.auxwork3.workers.dev`. Release application IDs omit `.debug`. Production host selection requires the explicit Gradle property `-Pproduction=true`; this does not deploy or publish anything.

## Build

Requires Android 7.0 (API 24) or newer. Use JDK 17, Gradle 8.11.1 and Android SDK 36 with build-tools 35.0.0:

```sh
cd mobile/android
gradle testCustomerDebugUnitTest testAdminDebugUnitTest lintCustomerDebug lintAdminDebug assembleCustomerDebug assembleAdminDebug
```

The `SignalChart Android previews` workflow builds both debug APKs and unsigned release bundles. Artifacts are retained for 30 days. Debug APKs are installable test packages; unsigned AABs are build outputs, not Play-ready uploads. No signing keys or tokens are stored in source.

## Behavior

- Uses the portal's existing browser session, password manager, receipt file chooser and authentication redirects.
- Shows a native connection-recovery screen when offline, with retry and connection settings.
- Rejects inbound links to other origins, unsafe schemes, API endpoints and unsupported routes. This protects launcher navigation; it does not substitute for server authorization.
- Customer and admin entry links do not compete for the same Android App Link route.
- Reuses the repository's orange SignalChart launcher artwork with adaptive-icon insets.
- Delegated web notifications are supported by the browser helper, but require an enabled backend, granted notification permission, verified domain association and device testing. No claim of working payment/message push is made here.
- No account credentials, privileged API keys, market data, receipts or offline premium signal cache are stored by the native shell.

## Before full-screen release

1. Configure durable release signing securely outside source control (and Play App Signing for Play distribution).
2. Obtain the actual signing certificate SHA-256 for each published package. Do not use a debug certificate in production.
3. Generate Digital Asset Links using `node mobile/android/assetlinks.cjs <package> <SHA256> [<package> <SHA256> ...]` and publish the JSON at `https://<portal-host>/.well-known/assetlinks.json`. Use the Play signing certificate for Play-installed apps, not the upload certificate.
4. Confirm association on a real Android device. Until association is installed and verified, the app opens a Custom Tab with the browser toolbar. This is an intentional fallback, not a verification bypass.
5. Verify login/logout/email-confirmation return, process restart, back navigation, connection recovery, chart gestures, file upload, admin permission rejection and notification delivery on Android. Use a test account; do not approve payments during a smoke test.
6. Finish backend billing/admin migration, premium publishing, account deletion/privacy information and store requirements before public release. Existing migration release controls remain intact.

## Landing page and concurrent work

The current migration branch already serves `launch.html` at `/` and links to `/dashboard.html`, `/terminal.html` and `/app.html`. This Android change does not replace that landing page, alter its ongoing redesign, or deploy to the production domain. Add a download/Play button only when a signed, tested release actually exists.
