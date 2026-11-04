import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';

export interface TrackInfo {
  fileId: string;
  fileName: string;
  audioUrl: string;
  mimeType: string;
  title?: string;
  artist?: string;
  coverArtUrl?: string;
}

interface MusicPlayerState {
  track: TrackInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface MusicPlayerContextValue extends MusicPlayerState {
  playTrack: (track: TrackInfo) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export const MusicPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const playTrack = useCallback((newTrack: TrackInfo) => {
    const audio = audioRef.current;
    if (track?.fileId === newTrack.fileId) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play();
      }
      return;
    }
    audio.pause();
    audio.src = newTrack.audioUrl;
    setTrack(newTrack);
    setCurrentTime(0);
    setDuration(0);
    audio.load();
    audio.play().catch(console.error);
  }, [track, isPlaying]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setTrack(null);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return (
    <MusicPlayerContext.Provider value={{ track, isPlaying, currentTime, duration, playTrack, togglePlay, seek, stop, audioRef }}>
      {children}
    </MusicPlayerContext.Provider>
  );
};

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};
