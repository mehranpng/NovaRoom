import React, { useRef, useEffect } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { Pause, Play, X, SkipBack, SkipForward } from 'lucide-react';

function formatTime(t: number): string {
  if (!isFinite(t) || isNaN(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MiniMusicPlayer: React.FC = () => {
  const { track, isPlaying, currentTime, duration, togglePlay, seek, stop } = useMusicPlayer();
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (track) {
      document.body.setAttribute('data-music-player', 'active');
    } else {
      document.body.removeAttribute('data-music-player');
    }
  }, [!!track]);

  if (!track) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const title = track.title?.trim() || track.fileName;
  const artist = track.title?.trim() ? (track.artist?.trim() || 'unknown') : (track.artist?.trim() || 'unknown');

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    seek(ratio * duration);
  };

  const handleSkipBack = () => seek(Math.max(0, currentTime - 10));
  const handleSkipForward = () => seek(Math.min(duration, currentTime + 10));

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: 'var(--bg-primary, #fff)',
      borderBottom: '1px solid var(--border-primary, #e5e7eb)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      display: 'flex',
      flexDirection: 'column',
      padding: '6px 12px 0',
      fontFamily: 'Vazir, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Music icon */}
        <div style={{
          width: 40, height: 40,
          borderRadius: 10,
          background: 'linear-gradient(135deg, #2F80ED, #56CCF2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          fontSize: 16,
          overflow: 'hidden',
        }}>
          {track.coverArtUrl ? (
            <img src={track.coverArtUrl} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>🎵</span>
          )}
        </div>

        {/* Track name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text-primary, #111)',
          }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)', display: 'flex', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{artist}</span>
            <span style={{ direction: 'ltr' }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <button onClick={handleSkipBack} style={btnStyle} title="-10s">
          <SkipBack size={16} />
        </button>
        <button onClick={togglePlay} style={{ ...btnStyle, background: '#2F80ED', color: '#fff', borderRadius: '50%', width: 32, height: 32 }}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={handleSkipForward} style={btnStyle} title="+10s">
          <SkipForward size={16} />
        </button>
        <button onClick={stop} style={btnStyle} title="بستن">
          <X size={16} />
        </button>
      </div>

      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        style={{
          height: 3,
          background: 'var(--border-primary, #e5e7eb)',
          borderRadius: 2,
          cursor: 'pointer',
          marginTop: 6,
          position: 'relative',
        }}
      >
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: '#2F80ED',
          borderRadius: 2,
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-primary, #333)',
  flexShrink: 0,
};
