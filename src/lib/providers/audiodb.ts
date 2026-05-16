import axios from "axios";

export const AUDIO_DB_MOOD_MATRIX: Record<string, { energy: number, valence: number }> = {
  "Happy": { energy: 0.7, valence: 0.9 },
  "Sad": { energy: 0.3, valence: 0.2 },
  "Relaxed": { energy: 0.2, valence: 0.6 },
  "Aggressive": { energy: 0.9, valence: 0.3 },
  "Energetic": { energy: 0.8, valence: 0.7 },
  "Melancholy": { energy: 0.4, valence: 0.3 },
  "Calm": { energy: 0.2, valence: 0.5 },
  "Angry": { energy: 0.9, valence: 0.2 },
  "Upbeat": { energy: 0.8, valence: 0.8 },
  "Romantic": { energy: 0.4, valence: 0.7 },
  "Dark": { energy: 0.6, valence: 0.2 },
  "Chill": { energy: 0.3, valence: 0.6 },
};

export const getAudioDbFeatures = async (artist: string, track: string) => {
  try {
    const cleanArtist = encodeURIComponent(artist.replace(/[^\w\s]/gi, ''));
    const cleanTrack = encodeURIComponent(track.replace(/[^\w\s]/gi, ''));
    
    const url = `https://theaudiodb.com/api/v1/json/2/searchtrack.php?s=${cleanArtist}&t=${cleanTrack}`;
    const response = await axios.get(url);

    if (response.data && response.data.track && response.data.track.length > 0) {
      const trackData = response.data.track[0];
      const mood = trackData.strMood;
      
      if (mood) {
        // Find exact or case-insensitive match
        const matchedMoodKey = Object.keys(AUDIO_DB_MOOD_MATRIX).find(k => k.toLowerCase() === mood.toLowerCase());
        
        if (matchedMoodKey) {
          const scores = AUDIO_DB_MOOD_MATRIX[matchedMoodKey];
          return {
            energy: scores.energy,
            valence: scores.valence,
            danceability: 0.5, // Default estimate
            tempo: 120, // Default estimate
            source: `AudioDB (${mood})`
          };
        } else {
          // If we have a mood but it's not in our matrix, default to mid
          return {
            energy: 0.5,
            valence: 0.5,
            danceability: 0.5,
            tempo: 120,
            source: `AudioDB (Unknown Mood: ${mood})`
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[AudioDB] Fetch failed for ${artist} - ${track}`);
    return null;
  }
};
