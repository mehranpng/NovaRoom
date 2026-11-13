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

    // Tiny chips (xxs: 18px) render a simplified micro crown
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
        <svg className="chess-champ-svg" viewBox="-12 0 124 68" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* Rich 24K Metallic Gold */}
            <linearGradient id={goldGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFDF0" />
              <stop offset="25%" stopColor="#FDE047" />
              <stop offset="55%" stopColor="#EAB308" />
              <stop offset="85%" stopColor="#CA8A04" />
              <stop offset="100%" stopColor="#854D0E" />
            </linearGradient>

            {/* Specular Highlight Gold */}
            <linearGradient id={hiGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="40%" stopColor="#FEF08A" />
              <stop offset="100%" stopColor="#EAB308" />
            </linearGradient>

            {/* Dark Obsidian Core */}
            <linearGradient id={darkGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#241e17" />
              <stop offset="50%" stopColor="#14110d" />
              <stop offset="100%" stopColor="#0a0806" />
            </linearGradient>
          </defs>

          {/* 1. Stretched Left Heraldic Wing (Extended & sweeping gracefully along circle curve) */}
          <path
            d="M 32 28 C 19 21, 6 14, -6 4 C -2 15, 6 26, 18 33 C 8 30, 0 23, -7 16 C -3 27, 8 36, 22 40 C 14 38, 7 34, 3 28 C 7 38, 17 45, 33 46 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.7"
          />
          <path
            d="M 32 30 C 20 24, 9 17, 1 10 C 6 18, 14 27, 24 33 Z"
            fill={`url(#${hiGradId})`}
            opacity="0.6"
          />

          {/* 2. Stretched Right Heraldic Wing (Symmetrical mirror, sweeping out to x = 106) */}
          <path
            d="M 68 28 C 81 21, 94 14, 106 4 C 102 15, 94 26, 82 33 C 92 30, 100 23, 107 16 C 103 27, 92 36, 78 40 C 86 38, 93 34, 97 28 C 93 38, 83 45, 67 46 Z"
            fill={`url(#${goldGradId})`}
            stroke="#78350F"
            strokeWidth="0.7"
          />
          <path
            d="M 68 30 C 80 24, 91 17, 99 10 C 94 18, 86 27, 76 33 Z"
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
          {/* Small Ruby Gem on crown apex */}
          <circle cx="50" cy="1" r="2.2" fill="#EF4444" stroke="#FFF" strokeWidth="0.6" />
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
          {/* Left Star */}
          <g transform="translate(-4, 8)">
            <path
              d="M 0 -6 L 1.5 -1.8 L 6 0 L 1.5 1.8 L 0 6 L -1.5 1.8 L -6 0 L -1.5 -1.8 Z"
              fill={`url(#${hiGradId})`}
              stroke="#78350F"
              strokeWidth="0.4"
            />
            <circle cx="0" cy="0" r="1.2" fill="#FFFFFF" />
          </g>
          {/* Right Star */}
          <g transform="translate(104, 8)">
            <path
              d="M 0 -6 L 1.5 -1.8 L 6 0 L 1.5 1.8 L 0 6 L -1.5 1.8 L -6 0 L -1.5 -1.8 Z"
              fill={`url(#${hiGradId})`}
              stroke="#78350F"
              strokeWidth="0.4"
            />
            <circle cx="0" cy="0" r="1.2" fill="#FFFFFF" />
          </g>
        </svg>

        {/* 8. Golden Sparks Emitter (Underneath badge, drifting strictly downwards) */}
        <div className="chess-champ-emitter">
          <span className="champ-spark s-1" />
          <span className="champ-spark s-2" />
          <span className="champ-spark s-3" />
          <span className="champ-spark s-4" />
          <span className="champ-spark s-5" />
        </div>
      </div>
    );
  }
);

ChessChampionDecoration.displayName = 'ChessChampionDecoration';
