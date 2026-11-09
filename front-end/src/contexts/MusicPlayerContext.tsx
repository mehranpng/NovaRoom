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
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isLooping: boolean;
}

interface MusicPlayerContextValue extends MusicPlayerState {
  playTrack: (track: TrackInfo) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export const MusicPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [isLooping, setIsLooping] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (!audio.loop) {
        setIsPlaying(false);
      }
    };
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
        audio.play().catch(console.error);
      }
      return;
    }
    audio.pause();
    audio.src = newTrack.audioUrl;
    audio.volume = volume;
    audio.muted = isMuted;
    audio.playbackRate = playbackRate;
    audio.loop = isLooping;
    setTrack(newTrack);
    setCurrentTime(0);
    setDuration(0);
    audio.load();
    audio.play().catch(console.error);
  }, [track, isPlaying, volume, isMuted, playbackRate, isLooping]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, Number.isFinite(time) ? time : 0);
    audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    const audio = audioRef.current;
    audio.volume = clamped;
    setVolumeState(clamped);
    if (clamped > 0 && isMuted) {
      audio.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    const nextMuted = !isMuted;
    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  }, [isMuted]);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    audio.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  const toggleLoop = useCallback(() => {
    const audio = audioRef.current;
    const nextLoop = !isLooping;
    audio.loop = nextLoop;
    setIsLooping(nextLoop);
  }, [isLooping]);

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
    <MusicPlayerContext.Provider
      value={{
        track,
        isPlaying,
        currentTime,
        duration,
        volume,
        isMuted,
        playbackRate,
        isLooping,
        playTrack,
        togglePlay,
        seek,
        stop,
        setVolume,
        toggleMute,
        setPlaybackRate,
        toggleLoop,
        audioRef,
      }}
    >
      {children}
    </MusicPlayerContext.Provider>
  );
};

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
};
