const nonGenreTags = new Set([
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
]);

export function normalizeGenreName(value: string) {
  return value
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArtistOrGroupTag(tagName: string, artistNames: Set<string>) {
  const normalized = normalizeGenreName(tagName);
  if (!normalized || nonGenreTags.has(normalized)) return true;
  if (artistNames.has(normalized)) return true;

  return normalized.endsWith(" fan club") || normalized.endsWith(" fans");
}
