# Changelog

## v1.0.5 - Metadata Reliability & Library Health Polish

- Fixed partial audio feature retry not clearing after successful local Essentia analysis.
- Fixed retry queues replaying already-completed tracks.
- Improved BPM and audio feature candidate selection consistency.
- Added post-save verification logging for local metadata analysis.
- Improved Library Health count/filter accuracy.
- Improved whole-track Essentia temp cleanup and worker safety.
- Added separate too-short status handling.
- Added GitHub repository link.
- Improved provider/status breakdowns in Dashboard and Library Health.

## v1.0.4 - Local/API Metadata Controls

- Added settings to enable or disable API BPM lookup.
- Added settings to enable or disable API Audio Feature lookup.
- Added local Essentia-only mode for BPM.
- Added local Essentia-only mode for Audio Features.
- Added API-preferred vs local-preferred effective value logic.
- Added provider breakdowns to Dashboard and Library Health.
- Added retry behavior that respects configured providers.

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
