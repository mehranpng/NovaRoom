// useWebSocket.ts
import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';

interface UseWebSocketProps {
    token: string | null;
    onNewMessage: (chatId: string, message: any) => void;
    onUserStatusChange?: (userId: string, online: boolean) => void;
    onConnectionChange?: (isConnected: boolean) => void;
}

export function useWebSocket({
    token,
    onNewMessage,
    onUserStatusChange,
    onConnectionChange
}: UseWebSocketProps) {
    const socketRef = useRef<WebSocket | null>(null);
    const isConnectedRef = useRef(false);

    const connect = useCallback(() => {
        if (!token || socketRef.current) return;

        const ws = new WebSocket(`${API_BASE_URL.replace('http', 'ws')}/ws?token=${token}`);

        ws.onopen = () => {
            isConnectedRef.current = true;
            onConnectionChange?.(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'new_message') {
                    onNewMessage(data.chatId, data.message);
                } else if (data.type === 'user_status') {
                    onUserStatusChange?.(data.userId, data.online);
                }
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        };

        ws.onclose = () => {
            isConnectedRef.current = false;
            onConnectionChange?.(false);
            socketRef.current = null;
            setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        socketRef.current = ws;
    }, [token, onNewMessage, onUserStatusChange, onConnectionChange]);

    const sendMessage = useCallback((chatId: string, text: string) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(
                JSON.stringify({
                    type: 'message',
                    chatId,
                    text,
                })
            );
            return true;
        }
        return false;
    }, []);

    const disconnect = useCallback(() => {
        socketRef.current?.close();
        socketRef.current = null;
    }, []);

    useEffect(() => {
        if (token) {
            connect();
        } else {
            disconnect();
        }
        return () => disconnect();
    }, [token, connect, disconnect]);

    return { sendMessage, isConnected: isConnectedRef.current };
}
