import { Bookmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../utils/cx';
import { API_BASE_URL } from '../config/api';
import { decryptAvatarBytesClientSide, decryptFileBytesClientSide } from '../utils/e2ee';

interface AvatarProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
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

const sizeMap = { xs: 28, sm: 40, md: 48, lg: 64, xl: 80 };
const iconSizeMap = { xs: 14, sm: 20, md: 24, lg: 32, xl: 40 };

// Global cache: src key → blob URL (or passthrough URL for data/blob/http)
const avatarCache = new Map<string, string>();
// In-flight requests to avoid duplicates
const avatarFetching = new Map<string, Promise<string>>();

function resolveAvatarUrl(src: string): string {
  if (!src) return '';

  // Passthrough for local URLs
  if (src.startsWith('blob:')) return src;
  if (src.startsWith('data:')) return src;

  if (src.startsWith('http://') || src.startsWith('https://')) {
    if (
      API_BASE_URL &&
      src.startsWith(API_BASE_URL) &&
      !src.includes('/files/') &&
      !src.includes('/avatars/')
    ) {
      const fileId = src.slice(API_BASE_URL.length).replace(/^\//, '');
      if (fileId) return `${API_BASE_URL}/files/${fileId}`;
    }
    return src;
  }

  if (src.startsWith('/')) {
    return `${API_BASE_URL}${src}`;
  }

  // Treat everything else as fileId
  return `${API_BASE_URL}/files/${src}`;
}

async function fetchAvatar(src: string): Promise<string> {
  const cacheKey = src;

  if (avatarCache.has(cacheKey)) return avatarCache.get(cacheKey)!;
  if (avatarFetching.has(cacheKey)) return avatarFetching.get(cacheKey)!;

  const promise = (async (): Promise<string> => {
    const fullUrl = resolveAvatarUrl(src);
    if (!fullUrl) return '';

    // data/blob can be used directly; no server fetch
    if (fullUrl.startsWith('data:') || fullUrl.startsWith('blob:')) {
      avatarCache.set(cacheKey, fullUrl);
      return fullUrl;
    }

    // External http(s) should be used directly.
    // For our own API files, we fetch with Authorization and turn into a blob URL.
    const isHttp = fullUrl.startsWith('http://') || fullUrl.startsWith('https://');
    const isOurApi = Boolean(API_BASE_URL && isHttp && fullUrl.startsWith(API_BASE_URL));
    const isProtectedAsset = isOurApi && (fullUrl.includes('/files/') || fullUrl.includes('/avatars/'));

    if (isHttp && !isProtectedAsset) {
      avatarCache.set(cacheKey, fullUrl);
      return fullUrl;
    }

    const token = localStorage.getItem('token');
    if (!token) return '';

    try {
      const response = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'ngrok-skip-browser-warning': 'true',
        },
      });

      if (!response.ok) return '';

      const encryptedBytes = new Uint8Array(await response.arrayBuffer());
      let plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, 'profile_avatar_shared');
      if (plainBytes === encryptedBytes) {
        plainBytes = await decryptAvatarBytesClientSide(encryptedBytes, token);
      }
      const blob = new Blob([plainBytes], { type: response.headers.get('content-type') || 'image/*' });
      const blobUrl = URL.createObjectURL(blob);
      avatarCache.set(cacheKey, blobUrl);
      return blobUrl;
    } catch {
      return '';
    } finally {
      avatarFetching.delete(cacheKey);
    }
  })();

  avatarFetching.set(cacheKey, promise);
  return promise;
}

export function Avatar({ name, size = 'md', online, savedMessages = false, src = '' }: AvatarProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
    if (!src) return '';
    return avatarCache.get(src) || '';
  });

  useEffect(() => {
    if (!src) {
      setResolvedSrc('');
      return;
    }

    if (avatarCache.has(src)) {
      setResolvedSrc(avatarCache.get(src)!);
      return;
    }

    let cancelled = false;
    fetchAvatar(src).then((url) => {
      if (!cancelled) setResolvedSrc(url);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  const px = sizeMap[size];

  if (savedMessages) {
    return (
      <div className={cx('avatar', `avatar--${size}`)}>
        <div
          className="avatar__circle avatar__circle--saved"
          style={{ width: `${px}px`, height: `${px}px` }}
        >
          <Bookmark size={iconSizeMap[size]} color="white" fill="white" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx('avatar', `avatar--${size}`)}
      style={{ width: `${px}px`, height: `${px}px`, flexShrink: 0 }}
    >
      {resolvedSrc ? (
        <img
          src={resolvedSrc}
          alt={name}
          className="avatar__image"
          loading="lazy"
          style={{
            width: `${px}px`,
            height: `${px}px`,
            borderRadius: '50%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          className={cx('avatar__circle', `avatar-color-${getColorIndex(name)}`)}
          style={{ width: `${px}px`, height: `${px}px`, fontSize: size === 'xs' ? 11 : undefined }}
        >
          {getInitials(name)}
        </div>
      )}
      {online === true && (
        <span className="avatar__status avatar__status--online" />
      )}
    </div>
  );
}
