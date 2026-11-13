import { useEffect, useState } from 'react';
import TelegramIcon from './TelegramIcon';
import { ChessChampionDecoration } from './ChessChampionDecoration';
import { useChessChampion } from '../contexts/ChessChampionContext';
import { cx } from '../utils/cx';
import { API_BASE_URL } from '../config/api';
import { decryptAvatarBytesClientSide, decryptFileBytesClientSide } from '../utils/e2ee';
import { getOrCacheBlob, deleteCachedBlob } from '../utils/mediaCache';

interface AvatarProps {
  name: string;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'md-lg' | 'lg' | 'xl';
  online?: boolean;
  savedMessages?: boolean;
  src?: string;
  plain?: boolean;
  userId?: string;
  isChessChampion?: boolean;
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

const sizeMap = { xxs: 18, xs: 28, sm: 40, md: 48, 'md-lg': 50, lg: 64, xl: 80 };
const plainSizeMap = { xxs: 24, xs: 40, sm: 40, md: 58, 'md-lg': 60, lg: 70, xl: 96 };


const avatarCache = new Map<string, string>();

const avatarFetching = new Map<string, Promise<string>>();

function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const bmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
  const isoBmff = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  const tiff = (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  const svg = bytes[0] === 0x3c;
  return jpeg || png || gif || webp || bmp || isoBmff || tiff || svg;
}

function resolveAvatarUrl(src: string): string {
  if (!src) return '';

  
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
    if (src === '/favicon.png' || src.startsWith('/avatars/') || src.startsWith('/logo/')) return src;
    if (API_BASE_URL && src.startsWith(API_BASE_URL)) return src;
    return `${API_BASE_URL}${src}`;
  }

  
  return `${API_BASE_URL}/files/${src}`;
}

async function fetchAvatar(src: string): Promise<string> {
  const cacheKey = src;

  if (avatarCache.has(cacheKey)) return avatarCache.get(cacheKey)!;
  if (avatarFetching.has(cacheKey)) return avatarFetching.get(cacheKey)!;

  const promise = (async (): Promise<string> => {
    const fullUrl = resolveAvatarUrl(src);
    if (!fullUrl) return '';

    
    if (fullUrl.startsWith('data:') || fullUrl.startsWith('blob:')) {
      avatarCache.set(cacheKey, fullUrl);
      return fullUrl;
    }

    
    
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
      const blob = await getOrCacheBlob({
        cacheKey: `avatar:${cacheKey}`,
        loadBlob: async () => {
          const response = await fetch(fullUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              'ngrok-skip-browser-warning': 'true',
            },
          });
          if (!response.ok) throw new Error('Failed to load avatar');
          const encryptedBytes = new Uint8Array(await response.arrayBuffer());
          let plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, 'profile_avatar_shared');
          if (plainBytes === encryptedBytes) {
            plainBytes = await decryptAvatarBytesClientSide(encryptedBytes, token);
          }
          return new Blob([plainBytes as BlobPart], { type: response.headers.get('content-type') || 'image/*' });
        },
      });
      const previewBytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      if (!looksLikeImage(previewBytes)) {
        void deleteCachedBlob(`avatar:${cacheKey}`);
        avatarCache.set(cacheKey, '');
        return '';
      }
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

export const getAvatarDisplayUrl = async (src: string): Promise<string> => {
  const key = String(src || '').trim();
  if (!key) return '';
  return fetchAvatar(key);
};

export function extractFileIdFromAvatar(rawAvatar: string): string {
  const avatar = String(rawAvatar || '').trim();
  if (!avatar) return '';
  const withoutOrigin = avatar.startsWith(API_BASE_URL) ? avatar.slice(API_BASE_URL.length) : avatar;
  const match = withoutOrigin.match(/\/(?:files|avatars)\/([^/?#]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  if (!avatar.startsWith('http://') && !avatar.startsWith('https://') && !avatar.startsWith('/')) return avatar;
  return '';
}

export function Avatar({
  name,
  size = 'md',
  online,
  savedMessages = false,
  src = '',
  plain = false,
  userId,
  isChessChampion,
}: AvatarProps) {
  const { isChampion } = useChessChampion();
  const showChessChampion = !savedMessages && (isChessChampion ?? (userId ? isChampion(userId) : false));

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

  const px = plain ? plainSizeMap[size] : sizeMap[size];

  if (savedMessages) {
    return (
      <div className={cx('avatar', `avatar--${size}`)}>
        <div
          className="avatar__circle avatar__circle--saved"
          style={{ width: `${px}px`, height: `${px}px` }}
        >
          <TelegramIcon name="saved-messages-filled" size={Math.round(px * 0.5)} />
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
        plain ? (
          <img
            src={resolvedSrc}
            alt={name}
            loading="lazy"
            style={{
              width: `${px}px`,
              height: `${px}px`,
              borderRadius: 0,
              objectFit: 'contain',
              display: 'block',
            }}
          />
        ) : (
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
        )
      ) : (
        <div
          className={cx('avatar__circle', `avatar-color-${getColorIndex(name)}`)}
          style={{ width: `${px}px`, height: `${px}px`, fontSize: size === 'xs' ? 11 : undefined }}
        >
          {getInitials(name)}
        </div>
      )}
      {showChessChampion && (
        <ChessChampionDecoration size={size} />
      )}
      {online === true && (
        <span className="avatar__status avatar__status--online" style={{ zIndex: 6 }} />
      )}
    </div>
  );
}
