# Mixarr

**Mixarr** is a self-hosted Plex music companion app that helps you explore your music library, generate smarter playlists, analyze tracks, and unlock richer music discovery tools.

[![GitHub Repo](https://img.shields.io/badge/GitHub-cvarano84%2FMixarr-181717?logo=github)](https://github.com/cvarano84/Mixarr)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/B7xMvAhaF)
[![Docker](https://img.shields.io/badge/Docker-self--hosted-2496ED?logo=docker&logoColor=white)](https://github.com/cvarano84/Mixarr/pkgs/container/mixarr)
![Beta](https://img.shields.io/badge/status-beta%20%2F%20experimental-f59e0b)

Mixarr is actively developed. Some newer metadata, local audio-analysis, and v2.0.0 preview features are beta or experimental and may change as the app evolves.

**Need help, found a bug, or want to shape the roadmap? Join the Discord:**  
https://discord.com/invite/B7xMvAhaF

![Dashboard Desktop](Screenshots/01.Dashboard-normal.png)

## What is Mixarr?

Mixarr connects to your Plex music library, syncs your artists, albums, tracks, tags, play history, ratings, and metadata into a local PostgreSQL cache, then lets you build playlists and discovery views from that data.

Use it to:

- Browse and filter your Plex music library faster than Plex alone.
- Build smart playlist-style mixes from rules like genre, BPM, energy, mood, popularity, year, rating, play count, and track traits.
- Enrich tracks with genre tags, popularity scores, BPM, and audio features.
- Push generated playlists back into Plex.
- Inspect library health, missing tracks, enrichment coverage, and retry/backfill queues.

## Beta Notice

Mixarr is still moving quickly. Core Plex sync, library browsing, playlist generation, and Docker deployment are usable today, but some enrichment and local analysis features are newer and should be treated as beta or experimental.

Please report bugs, setup issues, provider problems, and unexpected results in Discord:

https://discord.com/invite/B7xMvAhaF

## Join the Discord

Discord is the best place for:

- Bug reports
- Feature requests
- Beta feedback
- Setup help
- Roadmap discussion

Join here: https://discord.com/invite/B7xMvAhaF

## Support Mixarr / Get Beta Access

Want early access to the private beta and upcoming experimental features? Become a monthly GitHub Sponsor for Mixarr and help support development.

Monthly supporters may receive access to private beta builds, early experimental features, and preview work as it becomes available. Sponsorship helps fund ongoing development, testing, and infrastructure, but it does not guarantee a specific feature, release date, or support response time.

[Become a GitHub Sponsor](https://github.com/sponsors/cvarano84)

## Current Features

### Plex Library Integration

- Plex OAuth sign-in and Plex server discovery.
- Music library selection and default playlist source selection.
- Syncs Plex artists, albums, tracks, genres/tags, ratings, play counts, last-played data, media paths, and track traits.
- Local PostgreSQL cache for fast filtering and playlist generation.
- Library reconciliation for active, missing, and deleted Plex records.

### Smart Playlists & Discovery

- Rule-based playlist builder with AND/OR groups.
- Filters for popularity, energy, mood/valence, BPM/tempo, release year, duration, Plex rating, play count, genre, artist, album, title, live tracks, remasters, explicit tracks, and popularity coverage.
- Quick templates for deep cuts, decade mixes, workout/high-BPM mixes, seasonal mixes, and anti-seasonal mixes.
- Duplicate control with one-version-per-song behavior.
- Negative filters for holiday tracks, live tracks, remasters, explicit tracks, intros/outros, minimum rating, recently played tracks, and duration ranges.
- Playlist preview with match reasons, pinning, drag reordering, removal, blocked tracks, and open-slot regeneration.
- Saved smart playlist rules, manual refresh, optional auto-refresh, and playlist export/update to Plex.
- Playlist generation/export history.

### Library Browsing

- Dashboard cards for library health, BPM coverage, audio-feature coverage, and sync status.
- Library Explorer for searching, sorting, and filtering tracks.
- Track browsing with artist and album context from the synced library views.
- Genre browser with searchable track-level genre tags.
- "Build From View" flow from library filters into the playlist builder.
- 30-second Plex audio preview/play integration where Plex can stream or transcode the track.

### Metadata & Audio Analysis

- API metadata enrichment through supported providers:
  - Deezer for popularity, tags, and BPM where available.
  - Last.fm for popularity and final tag fallback.
  - MusicBrainz for genre/tag lookup.
  - Discogs genre/style lookup when enabled.
  - Spotify popularity, audio features, and optional artist genre lookup when configured.
  - AudioDB audio-feature fallback.
- Audio feature fields for energy, mood/valence, danceability, acousticness, tempo/BPM, loudness, and confidence/source tracking.
- Provider confidence/source fields so Mixarr can distinguish API, local, imported, estimated, and mixed metadata.

### BPM Tools

- BPM lookup and backfill from API providers where supported.
- Local BPM analysis using Essentia when available.
- Aubio fallback support when Essentia is unavailable or unsupported.
- Windowed and whole-track local analysis modes.
- BPM confidence, source, scope, status, and failure-reason tracking.
- Retry/backfill tools for missing, failed, no-data, extraction-failed, analyzer-failed, and too-short tracks.

### Library Health & Backfills

- Library Health view with Plex/Mixarr count comparison.
- Missing track viewer with search, filters, restore checks, CSV export, JSON export, and safe cleanup review.
- BPM, genre, popularity, and audio-feature coverage summaries.
- Retry queues for BPM, audio features, genres, and popularity.
- Provider-mode retry options, including configured providers, API-only, local-only, and force-local where supported.
- Background job locking, progress logging, status polling, and conservative DB concurrency controls.

### Dashboard & Stats

- Dashboard health widget for active/missing tracks and latest sync.
- BPM and audio-feature cards with API/local/imported/missing/failed breakdowns.
- Sync progress and background job status.
- Optional Prometheus metrics endpoint and included Grafana dashboard resource.

### Self-Hosted Deployment

- Docker and Docker Compose deployment.
- Published container image at `ghcr.io/cvarano84/mixarr:latest`.
- PostgreSQL-backed storage through Prisma.
- Optional media path mappings for local BPM/audio analysis inside Docker.

## Experimental / Beta Features

These features are actively being tested and may change:

- Local Essentia audio-feature analysis for energy, mood, danceability, acousticness, tempo, loudness, spectral/rhythm descriptors, and confidence scoring.
- Local Essentia-only modes for BPM and audio features.
- Whole-track local BPM/audio-feature analysis.
- Mixed API/local effective metadata selection.
- Provider controls for API-preferred vs local-preferred metadata.
- Advanced retry/backfill behavior from Library Health.
- Prometheus/Grafana monitoring.
- v2.0.0 dashboard preview cards and future discovery concepts.

## Coming in v2.0.0

v2.0.0 is where larger experimental Mixarr features are being explored. These items are planned or in preview, not finished release promises:

- More advanced smart playlist builder.
- Better mood/energy-based playlist generation.
- Improved local audio analysis workflows.
- Better genre cleanup and library intelligence.
- More powerful discovery tools.
- Deeper Plex music insights.
- More automation around mixes, playlist refreshes, stations, and recommendations.
- Private beta testing for experimental features.
- Cleaner dashboard experience.
- Better release notes and changelog flow.

## Roadmap Beyond v2.0.0

Longer-term ideas under consideration:

- Infinite or station-style discovery modes.
- Playlist flow scoring for variety, pacing, energy balance, and repeat risk.
- Music DNA-style visualizations for mood, BPM, popularity, genre coverage, and library shape.
- Anti-repeat and cooldown rules for tracks, artists, and albums.
- More provider integrations where they are reliable and policy-compatible.
- More library cleanup and metadata quality tools.

These are ideas, not guaranteed features.

## Previews

### Dashboard

| Desktop | Mobile |
| :---: | :---: |
| ![Dashboard Desktop](Screenshots/01.Dashboard-normal.png) | <img src="Screenshots/01.Dashboard-mobile.PNG" width="250"> |

### Playlist Builder

| Desktop | Mobile |
| :---: | :---: |
| ![Builder Desktop](Screenshots/02.Build%20Playlist-normal.png) | <img src="Screenshots/02.Build%20Playlist-mobile.PNG" width="250"> |

### Library View

| Desktop | Mobile |
| :---: | :---: |
| ![Library Desktop](Screenshots/03.Library-normal.png) | <img src="Screenshots/03.Library-mobile.PNG" width="250"> |

### Genres Page

| Desktop | Mobile |
| :---: | :---: |
| ![Genres Desktop](Screenshots/04-Genres-normal.png) | <img src="Screenshots/04-Genres-mobile.png" width="250"> |

### Settings & Integration

| Desktop | Mobile |
| :---: | :---: |
| ![Settings Desktop](Screenshots/04-Settings-norma.png) | <img src="Screenshots/04-Settings-mobile.PNG" width="250"> |

## Installation

1. Clone this repository.

```bash
git clone https://github.com/cvarano84/Mixarr.git
cd Mixarr
```

2. Duplicate `.env.example` to `.env` and fill in the required values.

```bash
cp .env.example .env
```

At minimum, set a `PLEX_CLIENT_IDENTIFIER`. A random UUID works well.

3. Start Mixarr and PostgreSQL with Docker Compose.

```bash
docker compose up -d
```

If you want to build the image locally from this repository instead of using the published image:

```bash
docker compose -f docker-compose-build.yml up -d --build
```

4. Open Mixarr.

```text
http://localhost:3030
```

Then sign in with Plex, choose your music library, and start a sync.

## Configuration

Most configuration lives in `.env`. See `.env.example` for the full list.

Important areas:

- `PLEX_CLIENT_IDENTIFIER` and `PLEX_PRODUCT_NAME` configure the Plex app identity.
- `DATABASE_URL` controls the PostgreSQL connection used by Prisma.
- `TRACK_TAG_PROVIDER_ORDER`, `DEEZER_TAGS_ENABLED`, `DISCOGS_TAGS_ENABLED`, `MUSICBRAINZ_TAGS_ENABLED`, `SPOTIFY_TAGS_ENABLED`, and `LASTFM_TAG_FALLBACK_ENABLED` control genre/tag enrichment.
- `LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET` enable optional provider features.
- `ENABLE_API_BPM`, `ENABLE_LOCAL_BPM`, `PREFER_LOCAL_BPM`, and `LOCAL_BPM_ANALYSIS_SCOPE` control BPM lookup and local analysis behavior.
- `ENABLE_API_AUDIO_FEATURES`, `ENABLE_LOCAL_AUDIO_FEATURES`, `PREFER_LOCAL_AUDIO_FEATURES`, and `LOCAL_AUDIO_FEATURES_SCOPE` control audio-feature enrichment.
- `PLEX_MEDIA_PATH_HOST`, `MIXARR_MEDIA_PATH_CONTAINER`, and `MIXARR_PATH_MAPPINGS` help Mixarr analyze local media files from inside Docker.
- `SYNC_CRON_SCHEDULE` and `SYNC_MAX_PIPELINE_MS` control the autonomous nightly sync pipeline.
- `METRICS_PORT` enables the optional Prometheus `/metrics` endpoint.

### Local BPM and Audio Analysis Notes

Local BPM analysis defaults to `LOCAL_BPM_ANALYZER=auto`, which prefers Essentia when available and falls back to Aubio. Local BPM and local audio-feature analysis use `ffmpeg`/`ffprobe` and need access to playable Plex media, either through Plex streaming/transcoding or through Docker media path mappings.

`LOCAL_BPM_ANALYSIS_SCOPE` and `LOCAL_AUDIO_FEATURES_SCOPE` support:

- `windows`: faster multi-window analysis.
- `whole_track`: slower full-track analysis.

Large local audio-feature jobs can be CPU-heavy. Automatic initial enrichment does not launch the large local Essentia audio-feature backfill unless `LOCAL_AUDIO_FEATURES_AUTO_BACKFILL=1`, except when API audio features are disabled and local analysis is enabled.

## Database and Job Tuning

Mixarr keeps Prisma traffic conservative by default:

- `MIXARR_DB_JOB_CONCURRENCY=4`
- `MIXARR_STATUS_CACHE_SECONDS=5`
- `MIXARR_STATUS_POLL_SECONDS=10`
- `MIXARR_STATUS_IDLE_POLL_SECONDS=30`

If a larger install needs more room, Prisma supports connection-string parameters such as `connection_limit` and `pool_timeout`:

```env
DATABASE_URL=postgresql://mixarr:mixarrpass@db:5432/mixarrdb?schema=public&connection_limit=20&pool_timeout=20
```

Prefer lowering job concurrency and avoiding overlapping syncs before raising the pool size.

## Architecture

- **Frontend:** Next.js 14 App Router, React, CSS modules, responsive UI.
- **Backend:** Next.js route handlers and Node.js background workers.
- **Database:** PostgreSQL with Prisma ORM.
- **Jobs:** Plex sync, metadata enrichment, local BPM/audio analysis, playlist refreshes, and nightly scheduling.
- **Containerization:** Docker and Docker Compose.
- **Monitoring:** Optional Prometheus metrics endpoint and Grafana dashboard resource.

## Changelog / Release Notes

Release notes live in [CHANGELOG.md](CHANGELOG.md). The changelog lists versions from oldest to newest.

## Contributing / Feedback

Bug reports, feature requests, and setup questions are welcome.

- Join Discord: https://discord.com/invite/B7xMvAhaF
- Open an issue: https://github.com/cvarano84/Mixarr/issues
- Follow development: https://github.com/cvarano84/Mixarr

Please include your Mixarr version, Docker/Compose setup, Plex music library size, relevant provider settings, and any useful logs when reporting bugs.
