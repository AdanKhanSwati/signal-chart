# SignalChart — source recovery staging

**Status: partial source recovery only — NOT READY TO DEPLOY.**

- Original Vercel deployment: `dpl_7V8tjUnDnMNAmW1xAwBZUYvMRfzD`
- Total source files: **104**
- Recovered and verified byte-for-byte (SHA-1): **85**
- Still missing: **19** (17 backend/test source files and 2 PNG images)
- Source branch: `signalchart-recovery-staging`
- Production: untouched; do **not** merge this branch into `main` until complete and tested.

The 80 top-level non-binary sources, including pages, CSS, JS, SVG, JSON and manifests, are recovered. Five small server/test files are recovered. See `recovery-manifest.json` for the exact original content hashes and missing filenames.

Important: This is a snapshot of existing files, not the approved original-logo replacement. No colour or visual changes have been applied.

The repository is currently public; before uploading sensitive backend code or maintaining an anonymous brand, consider making it private in GitHub settings.
