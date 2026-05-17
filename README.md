# Mixarr - Smart Playlist Engine

**Mixarr** is a fully containerized, autonomous, and incredibly powerful Smart Playlist Engine for your Plex Media Server. Designed to bring dynamic, vibe-based mixes to your self-hosted music library.

![Dashboard Desktop](Screenshots/01.Dashboard-normal.png)

## Features

- **Blazing Fast Local Cache**: Mixarr autonomously syncs your entire Plex music library (Artists, Albums, Tracks, and Tags) into a local PostgreSQL database, enabling instant query times across tens of thousands of tracks.
- **Smart Metadata Enrichment**: 
  - Analyzes the "feel" of your music by mapping raw data into **Energy (0.0-1.0)**, **Valence/Mood (0.0-1.0)**, and exact **BPM (Tempo)** scores using **AudioDB** and **Deezer**.
  - Calculates global **Popularity** scores using **Last.fm** and **Deezer**.
  - Enriches track genre tags through **Deezer**, **MusicBrainz**, opt-in **Discogs**/**Spotify**, and **Last.fm** only as the final fallback.
- **Dynamic Rule Builder**: Create complex queries instantly. Find tracks where `Genre CONTAINS "Rock"`, `Energy > 0.8`, and `Popularity < 40`—all processed entirely locally.
- **Push to Plex**: Seamlessly export your generated mixes straight back to your Plex Media Server.
- **Premium UI / UX**: A gorgeous "Glassmorphic" interface powered by Next.js, featuring an animated floating mesh gradient, crisp typography (Google Inter & Outfit), and satisfying micro-animations.
- **Native Mobile Experience**: 100% responsive design. On mobile devices, the app seamlessly morphs into a mobile layout with a fixed bottom navigation bar, making it perfectly usable on the go.

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

### Settings & Integration
| Desktop | Mobile |
| :---: | :---: |
| ![Settings Desktop](Screenshots/04-Settings-norma.png) | <img src="Screenshots/04-Settings-mobile.PNG" width="250"> |

## Getting Started

1. Clone this repository.
2. Duplicate `.env.example` to `.env` and fill in your API keys (Plex Client Identifier, Discogs/Last.fm/Spotify as needed).
3. Spin up the entire stack using Docker:

```bash
docker-compose up -d --build
```

4. Navigate to `http://localhost:3000` to begin syncing your library.

## Architecture

- **Frontend**: Next.js 14 App Router, React, Vanilla CSS (Glassmorphism + Animations)
- **Backend**: Next.js Serverless Routes, Node.js background workers (SyncEngine)
- **Database**: PostgreSQL mapped with Prisma ORM
- **Containerization**: Docker & Docker Compose

## Future Features

- **Ideas**: Have and idead for a future fearture 'https://www.reddit.com/r/Softwarr/comments/1tbfb0r/plexmix_smart_playlist_builder_for_plex/' leave a comment with your ideas.
- **Multiple Tracks**: Will add functionality to allow for albums that have the same song from the same artist to only have one track show up in the playlist. might alsom have a settings toggle.
- **Discord**: will start a discord server if there is interest. Be a good way to provided feature ideas, get suggestions, and have feedback
