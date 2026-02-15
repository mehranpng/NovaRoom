import { cx } from '../utils/cx';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  avatar?: string;
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

export function Avatar({ name, size = 'md', online, avatar }: AvatarProps) {
  return (
    <div className={cx('avatar', `avatar--${size}`)}>
      <div className={cx('avatar__circle', `avatar-color-${getColorIndex(name)}`)}>
        {avatar ? (
          <img src={avatar} alt={name} className="avatar__img" />
        ) : (
          getInitials(name)
        )}
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
