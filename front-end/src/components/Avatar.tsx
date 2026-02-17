import { Bookmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../utils/cx';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  savedMessages?: boolean;
  src?: string;
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

export function Avatar({ name, size = 'md', online, savedMessages = false, src = '' }: AvatarProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadSrc = async () => {
      if (!src) {
        setResolvedSrc('');
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        setResolvedSrc(src);
        return;
      }

      try {
        const response = await fetch(src, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          setResolvedSrc(src);
          return;
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setResolvedSrc(objectUrl);
        }
      } catch {
        setResolvedSrc(src);
      }
    };

    loadSrc();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (savedMessages) {
    return (
      <div className={cx('avatar', `avatar--${size}`)}>
        <div
          className="avatar__circle avatar__circle--saved"
          style={{
            width: `${sizeMap[size]}px`,
            height: `${sizeMap[size]}px`,
          }}
        >
          <Bookmark size={iconSizeMap[size]} color="white" fill="white" />
        </div>
      </div>
    );
  }

  return (
    <div className={cx('avatar', `avatar--${size}`)}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt={name} className="avatar__image" loading="lazy" />
      ) : (
        <div className={cx('avatar__circle', `avatar-color-${getColorIndex(name)}`)}>
          {getInitials(name)}
        </div>
      )}
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
