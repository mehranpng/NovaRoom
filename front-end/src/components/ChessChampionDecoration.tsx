import React, { useId } from 'react';

interface ChessChampionDecorationProps {
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'md-lg' | 'lg' | 'xl';
  className?: string;
}

export const ChessChampionDecoration: React.FC<ChessChampionDecorationProps> = React.memo(
  ({ size = 'md', className = '' }) => {
    const rawId = useId();
    const id = rawId.replace(/:/g, '');

    const goldGradId = `goldGrad_${id}`;
    const hiGradId = `hiGrad_${id}`;
    const darkGradId = `darkGrad_${id}`;
    const shineGradId = `shineGrad_${id}`;
    const goldClipId = `goldClip_${id}`;

    const isTiny = size === 'xxs';

    if (isTiny) {
      return (
        <div className={`chess-champ-wrap chess-champ-wrap--tiny ${className}`} aria-hidden="true">
          <svg className="chess-champ-svg" viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id={goldGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFDF0" />
                <stop offset="40%" stopColor="#FDE047" />
                <stop offset="100%" stopColor="#CA8A04" />
              </linearGradient>
            </defs>
            <path d="M 24 32 Q 40 44 56 32 L 54 38 Q 40 48 26 38 Z" fill={`url(#${goldGradId})`} />
            <path d="M 28 30 L 30 16 L 36 22 L 40 10 L 44 22 L 50 16 L 52 30 Z" fill={`url(#${goldGradId})`} />
          </svg>
        </div>
      );
    }

    return (
      <div className={`chess-champ-wrap chess-champ-wrap--${size} ${className}`} aria-hidden="true">
        <div className="chess-champ-sparkles">
          <svg className="chess-champ-sparkle sp-1" viewBox="0 0 12 12" fill="none">
            <path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="#FFFDF0" />
          </svg>
          <svg className="chess-champ-sparkle sp-2" viewBox="0 0 12 12" fill="none">
            <path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="#FEF08A" />
          </svg>
          <svg className="chess-champ-sparkle sp-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="#FFFDF0" />
          </svg>
          <svg className="chess-champ-sparkle sp-4" viewBox="0 0 12 12" fill="none">
            <path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="#FEF08A" />
          </svg>
        </div>
        <svg className="chess-champ-svg" viewBox="-38 -6 176 74" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id={goldGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFDF5" />
              <stop offset="18%" stopColor="#FDE047" />
              <stop offset="36%" stopColor="#D97706" />
              <stop offset="52%" stopColor="#FFF7CC" />
              <stop offset="70%" stopColor="#EAB308" />
              <stop offset="88%" stopColor="#B45309" />
              <stop offset="100%" stopColor="#78350F" />
            </linearGradient>

            <linearGradient id={hiGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="42%" stopColor="#FEF08A" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>

            <linearGradient id={darkGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#241e17" />
              <stop offset="50%" stopColor="#14110d" />
              <stop offset="100%" stopColor="#0a0806" />
            </linearGradient>

            <linearGradient id={shineGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="35%" stopColor="#FEF9C3" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.88" />
              <stop offset="65%" stopColor="#FEF9C3" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>

            <clipPath id={goldClipId}>
              <path d="M 32 30 C 10 28, -15 18, -34 -2 C -25 18, -10 32, 10 40 C -5 41, -20 35, -30 24 C -19 40, -1 49, 19 52 C 8 52, -3 48, -10 42 C -1 52, 14 57, 33 56 Z" />
              <path d="M 68 30 C 90 28, 115 18, 134 -2 C 125 18, 110 32, 90 40 C 105 41, 120 35, 130 24 C 119 40, 101 49, 81 52 C 92 52, 103 48, 110 42 C 101 52, 86 57, 67 56 Z" />
              <path d="M 33 16 L 50 12 L 67 16 L 70 36 C 70 48, 60 56, 50 60 C 40 56, 30 48, 30 36 Z" />
              <path d="M 36 15 L 32 5 L 40 10 L 50 1 L 60 10 L 68 5 L 64 15 Z" />
            </clipPath>
          </defs>

          {/* 1. Stretched Left Heraldic Wing (Fuller & larger along ~half the avatar circle) */}
          <path
            d="M 32 30 C 10 28, -15 18, -34 -2 C -25 18, -10 32, 10 40 C -5 41, -20 35, -30 24 C -19 40, -1 49, 19 52 C 8 52, -3 48, -10 42 C -1 52, 14 57, 33 56 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.7"
          />
          <path
            d="M 32 33 C 12 30, -9 21, -24 6 C -14 21, 1 32, 20 40 Z"
            fill={`url(#${hiGradId})`}
            opacity="0.6"
          />

          {/* 2. Stretched Right Heraldic Wing (Symmetrical mirror, sweeping out to x = 134) */}
          <path
            d="M 68 30 C 90 28, 115 18, 134 -2 C 125 18, 110 32, 90 40 C 105 41, 120 35, 130 24 C 119 40, 101 49, 81 52 C 92 52, 103 48, 110 42 C 101 52, 86 57, 67 56 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.7"
          />
          <path
            d="M 68 33 C 88 30, 109 21, 124 6 C 114 21, 99 32, 80 40 Z"
            fill={`url(#${hiGradId})`}
            opacity="0.6"
          />

          {/* 3. Central Shield Outer Rim */}
          <path
            d="M 33 16 L 50 12 L 67 16 L 70 36 C 70 48, 60 56, 50 60 C 40 56, 30 48, 30 36 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="1"
          />

          {/* 4. Central Obsidian Core */}
          <path
            d="M 36 18 L 50 15 L 64 18 L 66 35 C 66 45, 58 52, 50 56 C 42 52, 34 45, 34 35 Z"
            fill={`url(#${darkGradId})`}
            stroke={`url(#${hiGradId})`}
            strokeWidth="0.8"
          />

          {/* 5. Royal Crown (Perched on top of shield) */}
          <path
            d="M 36 15 L 32 5 L 40 10 L 50 1 L 60 10 L 68 5 L 64 15 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.9"
          />
          <polygon points="50,1 50,14 44,11" fill={`url(#${hiGradId})`} opacity="0.8" />
          <polygon points="50,1 50,14 56,11" fill="#CA8A04" opacity="0.9" />
          {/* Gold Gem on crown apex */}
          <circle cx="50" cy="1" r="2.2" fill="#FDE047" stroke="#78350F" strokeWidth="0.4" />
          <circle cx="32" cy="5" r="1.6" fill="#FEF08A" stroke="#78350F" strokeWidth="0.4" />
          <circle cx="68" cy="5" r="1.6" fill="#FEF08A" stroke="#78350F" strokeWidth="0.4" />

          {/* 6. Chess King Piece */}
          {/* Cross */}
          <rect x="49" y="19" width="2" height="5.5" rx="0.4" fill={`url(#${hiGradId})`} />
          <rect x="47" y="20.5" width="6" height="1.8" rx="0.4" fill={`url(#${hiGradId})`} />
          {/* Head */}
          <path
            d="M 44 26 C 44 23.5, 56 23.5, 56 26 C 57 28.5, 54 30.5, 50 30.5 C 46 30.5, 43 28.5, 44 26 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.5"
          />
          {/* Body */}
          <path d="M 45 30.5 L 55 30.5 L 53 36 L 47 36 Z" fill={`url(#${hiGradId})`} />
          {/* Base */}
          <path
            d="M 43 38 C 45 36, 55 36, 57 38 L 59 44 C 59 46, 41 46, 41 44 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.5"
          />
          <rect
            x="39"
            y="45"
            width="22"
            height="2.8"
            rx="0.8"
            fill={`url(#${hiGradId})`}
            stroke="#78350F"
            strokeWidth="0.5"
          />

          {/* 7. Crisp Small Diamond Stars on Wingtips */}
          <g transform="translate(-32, 2)">
            <g className="chess-champ-star chess-champ-star--left">
              <path
                d="M 0 -6 L 1.5 -1.8 L 6 0 L 1.5 1.8 L 0 6 L -1.5 1.8 L -6 0 L -1.5 -1.8 Z"
                fill={`url(#${hiGradId})`}
                stroke="#78350F"
                strokeWidth="0.4"
              />
              <circle cx="0" cy="0" r="1.2" fill="#FFFFFF" />
            </g>
          </g>
          <g transform="translate(132, 2)">
            <g className="chess-champ-star chess-champ-star--right">
              <path
                d="M 0 -6 L 1.5 -1.8 L 6 0 L 1.5 1.8 L 0 6 L -1.5 1.8 L -6 0 L -1.5 -1.8 Z"
                fill={`url(#${hiGradId})`}
                stroke="#78350F"
                strokeWidth="0.4"
              />
              <circle cx="0" cy="0" r="1.2" fill="#FFFFFF" />
            </g>
          </g>
          <g clipPath={`url(#${goldClipId})`} pointerEvents="none">
            <rect
              className="chess-champ-shine-beam"
              x="-24"
              y="-10"
              width="28"
              height="92"
              transform="skewX(-22)"
              fill={`url(#${shineGradId})`}
            />
          </g>
        </svg>
      </div>
    );
  }
);

ChessChampionDecoration.displayName = 'ChessChampionDecoration';
