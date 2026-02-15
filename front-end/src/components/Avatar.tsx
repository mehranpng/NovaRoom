import { Bookmark } from 'lucide-react';
import { cx } from '../utils/cx';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  savedMessages?: boolean;
}

function getColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 8;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const sizeMap = {
  sm: 40,
  md: 48,
  lg: 64,
  xl: 80,
};

const iconSizeMap = {
  sm: 20,
  md: 24,
  lg: 32,
  xl: 40,
};

export function Avatar({ name, size = 'md', online, savedMessages = false }: AvatarProps) {
  if (savedMessages) {
    return (
      <div className={cx('avatar', `avatar--${size}`)}>
        <div
          style={{
            width: `${sizeMap[size]}px`,
            height: `${sizeMap[size]}px`,
            borderRadius: '50%',
            backgroundColor: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Bookmark size={iconSizeMap[size]} color="white" fill="white" />
        </div>
      </div>
    );
  }

  return (
    <div className={cx('avatar', `avatar--${size}`)}>
      <div className={cx('avatar__circle', `avatar-color-${getColorIndex(name)}`)}>
        {getInitials(name)}
      </div>
      {online !== undefined && (
        <span
          className={cx(
            'avatar__status',
            online ? 'avatar__status--online' : 'avatar__status--offline'
          )}
        />
      )}
    </div>
  );
}
