import { ImageResponse } from 'next/og';
 
export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
 
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
          color: 'white',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="100"
          height="100"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
