import { useEffect, useRef, useState } from 'react';
import { readAudioMetadata, type AudioMetadata } from '../utils/audioMetadata';

export function useAudioMetadata(mediaUrl: string | null, withCover = true): AudioMetadata | undefined {
  const [parsed, setParsed] = useState<{ url: string; data: AudioMetadata } | null>(null);
  const coverUrlRef = useRef('');

  useEffect(() => {
    if (!mediaUrl || !mediaUrl.startsWith('blob:')) return;

    let cancelled = false;

    fetch(mediaUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const data = readAudioMetadata(buffer, withCover) ?? {};
        if (cancelled) {
          if (data.coverUrl) URL.revokeObjectURL(data.coverUrl);
          return;
        }
        if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
        coverUrlRef.current = data.coverUrl ?? '';
        setParsed({ url: mediaUrl, data });
      })
      .catch(() => {
        if (!cancelled) setParsed({ url: mediaUrl, data: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [mediaUrl, withCover]);

  return parsed && parsed.url === mediaUrl ? parsed.data : undefined;
}
