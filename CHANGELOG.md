# Changelog

## v1.0.3 - Library Health, Cleanup & Pool Stability

- Added Library Health page.
- Added Plex/Mixarr sync integrity stats.
- Added missing track viewer.
- Added safe cleanup tools for stale Plex records.
- Added missing track export.
- Added BPM health summary.
- Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.
- Improved dashboard counts to use active tracks only.
- Fixed Prisma connection pool exhaustion during long-running sync/status polling.
- Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.
- Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.
- Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.
