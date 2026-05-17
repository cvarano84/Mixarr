import { normalizeGenreName } from "./genreFilters";
import {
  getDiscogsTrackTags,
  isDiscogsTagLookupEnabled,
} from "./providers/discogs";
import { getDeezerTrackTags } from "./providers/deezer";
import { getLastFmTrackTags } from "./providers/lastfm";
import { getMusicBrainzTrackTags } from "./providers/musicbrainz";
import {
  getSpotifyTrackTags,
  isSpotifyTagLookupEnabled,
} from "./providers/spotify";

export type TrackTagProviderName = "deezer" | "discogs" | "musicbrainz" | "spotify" | "lastfm";

export type TrackTagResolution = {
  tags: string[];
  provider: TrackTagProviderName | null;
  attemptedProviders: TrackTagProviderName[];
  rateLimited: boolean;
};

const DEFAULT_PROVIDER_ORDER: TrackTagProviderName[] = [
  "deezer",
  "discogs",
  "musicbrainz",
  "spotify",
  "lastfm",
];

const BLOCKED_TAGS = new Set([
  "seen live",
  "favorites",
  "favourites",
  "favorite",
  "favourite",
  "albums i own",
  "songs i own",
  "spotify",
  "lastfm",
  "last fm",
  "youtube",
  "cover",
  "covers",
  "single",
  "various artists",
  "0",
]);

const providerLookups: Record<TrackTagProviderName, (artist: string, track: string) => Promise<string[]>> = {
  deezer: getDeezerTrackTags,
  discogs: getDiscogsTrackTags,
  musicbrainz: getMusicBrainzTrackTags,
  spotify: getSpotifyTrackTags,
  lastfm: getLastFmTrackTags,
};

function envEnabled(name: string, defaultValue: boolean) {
  const value = process.env[name]?.toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function hasLastFmCredentials() {
  return Boolean(process.env.LASTFM_API_KEY);
}

function providerEnabled(provider: TrackTagProviderName) {
  if (provider === "deezer") {
    return envEnabled("DEEZER_TAGS_ENABLED", true);
  }
  if (provider === "discogs") {
    return isDiscogsTagLookupEnabled();
  }
  if (provider === "musicbrainz") {
    return envEnabled("MUSICBRAINZ_TAGS_ENABLED", true);
  }
  if (provider === "spotify") {
    return isSpotifyTagLookupEnabled();
  }
  return envEnabled("LASTFM_TAG_FALLBACK_ENABLED", true) && hasLastFmCredentials();
}

function resolveProviderOrder() {
  const configured = process.env.TRACK_TAG_PROVIDER_ORDER?.split(",")
    .map(value => value.trim().toLowerCase())
    .filter((value): value is TrackTagProviderName =>
      value === "deezer" || value === "discogs" || value === "musicbrainz" || value === "spotify" || value === "lastfm",
    );

  return configured?.length ? configured : DEFAULT_PROVIDER_ORDER;
}

function resolveMaxTags() {
  const configured = Number(process.env.TRACK_TAG_MAX_TAGS || 8);
  return Number.isInteger(configured) && configured > 0 ? configured : 8;
}

function normalizeTags(tags: string[], artist: string, track: string) {
  const normalizedArtist = normalizeGenreName(artist);
  const normalizedTrack = normalizeGenreName(track);
  const unique = new Set<string>();

  for (const tag of tags) {
    const cleanTag = normalizeGenreName(tag);
    if (cleanTag.length < 3) continue;
    if (BLOCKED_TAGS.has(cleanTag)) continue;
    if (cleanTag === normalizedArtist || cleanTag === normalizedTrack) continue;
    if (/^\d+$/.test(cleanTag)) continue;
    unique.add(cleanTag);
  }

  return Array.from(unique);
}

export const resolveTrackGenreTags = async (
  artist: string,
  track: string,
): Promise<TrackTagResolution> => {
  const attemptedProviders: TrackTagProviderName[] = [];
  let rateLimited = false;

  for (const provider of resolveProviderOrder()) {
    if (!providerEnabled(provider)) continue;

    attemptedProviders.push(provider);
    try {
      const tags = normalizeTags(await providerLookups[provider](artist, track), artist, track)
        .slice(0, resolveMaxTags());

      if (tags.length > 0) {
        return {
          tags,
          provider,
          attemptedProviders,
          rateLimited: false,
        };
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      if (message.startsWith("RATE_LIMIT")) rateLimited = true;
      console.warn(`[TrackTagProviders] ${provider} returned no tags for ${artist} - ${track}: ${message}`);
    }
  }

  return {
    tags: [],
    provider: null,
    attemptedProviders,
    rateLimited,
  };
};
