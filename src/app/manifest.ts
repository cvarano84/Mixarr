import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mixarr',
    short_name: 'Mixarr',
    description: 'Smart Playlist Builder for Plex',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#8b5cf6',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
