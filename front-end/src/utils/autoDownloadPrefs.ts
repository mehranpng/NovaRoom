const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export const autoDownloadCookieKeys = {
  image: 'auto_download_images',
  video: 'auto_download_videos',
  audio: 'auto_download_audios',
  file: 'auto_download_files',
} as const;

export const setAutoDownloadCookie = (name: string, value: '0' | '1') => {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SEC}; samesite=lax`;
};

export const getAutoDownloadCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const key = `${encodeURIComponent(name)}=`;
  const row = document.cookie.split('; ').find((item) => item.startsWith(key));
  return row ? decodeURIComponent(row.slice(key.length)) : null;
};

export const isAutoDownloadEnabled = (name: string): boolean => getAutoDownloadCookie(name) === '1';
