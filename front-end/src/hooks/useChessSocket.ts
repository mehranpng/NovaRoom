import { useCallback, useEffect, useRef, useState } from 'react';
import { API_WS_URL } from '../config/api';
import type { ChessColor, ChessEmote, ChessEvent, ChessGameView } from '../types';

interface Options {
    token: string | null;
    guestToken?: string | null;
    gameId: string | null;
    onState: (game: ChessGameView, event: ChessEvent | null) => void;
    onError: (code: string) => void;
    onEmote?: (by: ChessColor, emote: ChessEmote) => void;
}

export function useChessSocket({ token, guestToken, gameId, onState, onError, onEmote }: Options) {
    const [connected, setConnected] = useState(false);
    const [latencies, setLatencies] = useState<Record<string, number>>({});
    const socketRef = useRef<WebSocket | null>(null);
    const onStateRef = useRef(onState);
    const onErrorRef = useRef(onError);
    const onEmoteRef = useRef(onEmote);

    useEffect(() => {
        onStateRef.current = onState;
        onErrorRef.current = onError;
        onEmoteRef.current = onEmote;
    }, [onState, onError, onEmote]);

    useEffect(() => {
        if (!(token || guestToken) || !gameId) return;
        let closed = false;
        let attempts = 0;
        let retryTimer: number | null = null;

        const params = new URLSearchParams({ gameId });
        if (token) params.set('token', token);
        if (guestToken) params.set('guestToken', guestToken);

        const connect = () => {
            const ws = new WebSocket(`${API_WS_URL}/ws/chess?${params.toString()}`);
            socketRef.current = ws;
            ws.onopen = () => {
                attempts = 0;
                setConnected(true);
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'game_state') onStateRef.current(data.game, data.event ?? null);
                    else if (data.type === 'emote' && data.by && data.emote) {
                        onEmoteRef.current?.(data.by as ChessColor, data.emote as ChessEmote);
                    }
                    else if (data.type === 'ping' && data.ts !== undefined) {
                        ws.send(JSON.stringify({ type: 'pong', ts: data.ts }));
                    }
                    else if (data.type === 'latency' && data.latency) {
                        setLatencies(data.latency as Record<string, number>);
                    }
                    else if (data.type === 'error') onErrorRef.current(String(data.code || 'error'));
                } catch {
                    return;
                }
            };
            ws.onclose = (event) => {
                setConnected(false);
                setLatencies({});
                if (closed) return;
                if (event.code === 1008) {
                    onErrorRef.current('forbidden');
                    return;
                }
                if (attempts >= 8) return;
                attempts += 1;
                retryTimer = window.setTimeout(connect, 1500);
            };
        };

        connect();

        return () => {
            closed = true;
            if (retryTimer) window.clearTimeout(retryTimer);
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [token, guestToken, gameId]);

    const send = useCallback((payload: Record<string, unknown>) => {
        const ws = socketRef.current;
        if (ws?.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(payload));
        return true;
    }, []);

    return { connected, latencies, send };
}
