import React, { useRef, useState, useLayoutEffect, useEffect, useMemo } from 'react';
import { useMusicPlayer, type TrackInfo } from '../contexts/MusicPlayerContext';
import { useShowTransition } from '../hooks/useShowTransition';
import TelegramIcon, { type TelegramIconName } from './TelegramIcon';
import { PlayIcon, PauseIcon } from './icons/TelegramIcons';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.5, 2];

function formatTime(t: number): string {
  if (!isFinite(t) || isNaN(t) || t < 0) return '0:00';
  const totalSeconds = Math.floor(t);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

export const MiniMusicPlayer: React.FC = () => {
  const {
    track,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playbackRate,
    isLooping,
    togglePlay,
    seek,
    stop,
    setVolume,
    toggleMute,
    setPlaybackRate,
    toggleLoop,
  } = useMusicPlayer();

  const lastTrackRef = useRef<TrackInfo | null>(track);
  if (track) {
    lastTrackRef.current = track;
  }
  const activeTrack = track ?? lastTrackRef.current;

  const isOpen = Boolean(track);
  const { shouldRender, className: transitionClass } = useShowTransition(isOpen, 280);

  const [isSeeking, setIsSeeking] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(0);
  const [isRateMenuOpen, setIsRateMenuOpen] = useState(false);
  const seekLineRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);
  const rateWrapperRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (track) {
      document.body.setAttribute('data-music-player', 'active');
    } else {
      document.body.removeAttribute('data-music-player');
    }
    return () => {
      document.body.removeAttribute('data-music-player');
    };
  }, [Boolean(track)]);

  useEffect(() => {
    if (!isRateMenuOpen) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (rateWrapperRef.current && !rateWrapperRef.current.contains(e.target as Node)) {
        setIsRateMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [isRateMenuOpen]);

  const volumeIcon: TelegramIconName = useMemo(() => {
    if (volume === 0 || isMuted) return 'muted';
    if (volume < 0.3) return 'volume-1';
    if (volume < 0.6) return 'volume-2';
    return 'speaker';
  }, [volume, isMuted]);

  if (!shouldRender || !activeTrack) return null;

  const liveProgress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const displayedProgress = isSeeking ? scrubProgress : liveProgress;
  const displayedTime = isSeeking && duration > 0 ? scrubProgress * duration : currentTime;

  const title = activeTrack.title?.trim() || stripExtension(activeTrack.fileName);
  const artist = activeTrack.artist?.trim() || '';

  const getProgressFromClientX = (clientX: number): number => {
    const el = seekLineRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    isSeekingRef.current = true;
    setIsSeeking(true);
    const nextProgress = getProgressFromClientX(e.clientX);
    setScrubProgress(nextProgress);
  };

  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    e.stopPropagation();
    const nextProgress = getProgressFromClientX(e.clientX);
    setScrubProgress(nextProgress);
    if (duration > 0) {
      seek(nextProgress * duration);
    }
  };

  const handleSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    e.stopPropagation();
    isSeekingRef.current = false;
    setIsSeeking(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const finalProgress = getProgressFromClientX(e.clientX);
    if (duration > 0) {
      seek(finalProgress * duration);
    }
  };

  const handleSeekPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    e.stopPropagation();
    isSeekingRef.current = false;
    setIsSeeking(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const rateText = `${playbackRate === 1 ? 2 : playbackRate}X`;
  const isRateApplied = playbackRate !== 1;

  const handleRateButtonClick = () => {
    if ('ontouchstart' in window) {
      setIsRateMenuOpen((prev) => !prev);
      return;
    }
    setIsRateMenuOpen(false);
    setPlaybackRate(playbackRate === 1 ? 2 : 1);
  };

  return (
    <div
      className={`mini-music-player tg-music-player${transitionClass ? ` ${transitionClass}` : ''}${!isOpen ? ' is-closing' : ''}`}
      dir="ltr"
    >
      <div className="tg-music-player__cover" aria-hidden="true">
        {activeTrack.coverArtUrl ? (
          <img src={activeTrack.coverArtUrl} alt="" />
        ) : (
          <TelegramIcon name="music-note" size={18} />
        )}
      </div>

      <button
        type="button"
        className="tg-music-player__btn tg-music-player__play-btn"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <span className={`tg-music-player__morph-icon${isPlaying ? ' is-hidden' : ''}`}>
          <PlayIcon size={22} />
        </span>
        <span className={`tg-music-player__morph-icon${!isPlaying ? ' is-hidden' : ''}`}>
          <PauseIcon size={22} />
        </span>
      </button>

      <div className="tg-music-player__content" onClick={togglePlay}>
        <div className="tg-music-player__title" dir="auto" title={title}>
          {title}
        </div>
        <div className="tg-music-player__subtitle" dir="auto">
          <span className="tg-music-player__time" dir="ltr">
            {formatTime(displayedTime)}
            {duration > 0 ? ` / ${formatTime(duration)}` : ''}
          </span>
          {artist && <span className="tg-music-player__bullet">{' \u2022 '}</span>}
          {artist && <span className="tg-music-player__artist">{artist}</span>}
        </div>
      </div>

      <button
        type="button"
        className={`tg-music-player__btn${isLooping ? ' is-applied' : ''}`}
        onClick={toggleLoop}
        aria-label="Repeat track"
        title="Repeat track"
      >
        <TelegramIcon name="repeat-one" size={20} />
      </button>

      <div className="tg-music-player__volume-wrapper">
        <button
          type="button"
          className={`tg-music-player__btn${isMuted || volume === 0 ? ' is-applied' : ''}`}
          onClick={toggleMute}
          aria-label="Mute or unmute"
        >
          <TelegramIcon name={volumeIcon} size={20} />
        </button>
        <div className="tg-music-player__volume-popover">
          <div className="tg-music-player__volume-spacer" />
          <div className="tg-music-player__volume-pill">
            <div className="tg-music-player__volume-slider-box">
              <div
                className="tg-music-player__volume-fill"
                style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
              />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((isMuted ? 0 : volume) * 100)}
                onChange={(e) => setVolume(Number(e.currentTarget.value) / 100)}
                className="tg-music-player__volume-input"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className="tg-music-player__rate-wrapper"
        ref={rateWrapperRef}
        onMouseEnter={() => {
          if (!('ontouchstart' in window)) setIsRateMenuOpen(true);
        }}
        onMouseLeave={() => {
          if (!('ontouchstart' in window)) setIsRateMenuOpen(false);
        }}
      >
        <button
          type="button"
          className={`tg-music-player__btn tg-music-player__rate-btn${isRateApplied ? ' is-applied' : ''}`}
          onClick={handleRateButtonClick}
          aria-label="Playback speed"
        >
          <span
            className={`tg-music-player__rate-badge${
              rateText.length === 4 ? ' is-small' : rateText.length >= 5 ? ' is-tiny' : ''
            }`}
          >
            {rateText}
          </span>
        </button>

        {isRateMenuOpen && (
          <div className="tg-music-player__rate-menu">
            <div className="tg-music-player__rate-spacer" />
            <div className="tg-music-player__rate-bubble">
              {PLAYBACK_RATES.map((rate) => {
                const selected = playbackRate === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    className={`tg-music-player__rate-item${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      setPlaybackRate(rate);
                      setIsRateMenuOpen(false);
                    }}
                  >
                    <span className="tg-music-player__rate-check">
                      {selected && <TelegramIcon name="check" size={14} />}
                    </span>
                    <span>{rate === 1 ? 'Normal' : `${rate}x`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="tg-music-player__btn tg-music-player__close-btn"
        onClick={stop}
        aria-label="Close player"
      >
        <TelegramIcon name="close" size={20} />
      </button>

      <div className="tg-music-player__seek-root">
        <div
          ref={seekLineRef}
          className={`tg-music-player__seek-line${isSeeking ? ' is-seeking' : ''}`}
          data-no-message-gesture
          onPointerDown={handleSeekPointerDown}
          onPointerMove={handleSeekPointerMove}
          onPointerUp={handleSeekPointerUp}
          onPointerCancel={handleSeekPointerCancel}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tg-music-player__seek-clip">
            <div className="tg-music-player__seek-track" />
            <div
              className="tg-music-player__seek-fill"
              style={{ transform: `scaleX(${displayedProgress})` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
