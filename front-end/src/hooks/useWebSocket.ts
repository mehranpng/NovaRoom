// useWebSocket.ts
import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';

interface UseWebSocketProps {
    token: string | null;
    onNewMessage: (chatId: string, message: any) => void;
    onMessageEdited?: (chatId: string, message: any) => void;
    onMessageDeleted?: (chatId: string, messageId: string, lastMessage?: any) => void;
    onUserStatusChange?: (userId: string, online: boolean) => void;
    onMessagesSeen?: (chatId: string) => void;
    onConnectionChange?: (isConnected: boolean) => void;
}

type OutgoingEvent =
    | { type: 'message'; chatId: string; text: string; replyToId?: string }
    | { type: 'edit_message'; chatId: string; messageId: string; text: string }
    | { type: 'delete_message'; chatId: string; messageId: string }
    | { type: 'seen'; chatId: string }
    | { type: 'ping' };

const WS_RECONNECT_DELAY_MS = 1500;

export function useWebSocket({
    token,
    onNewMessage,
    onMessageEdited,
    onMessageDeleted,
    onUserStatusChange,
    onMessagesSeen,
    onConnectionChange,
}: UseWebSocketProps) {
    const socketRef = useRef<WebSocket | null>(null);
    const isConnectedRef = useRef(false);

    // Queue outgoing events while socket is not OPEN (fixes lost "seen" on reconnect).
    const outboxRef = useRef<string[]>([]);

    const reconnectTimerRef = useRef<number | null>(null);
    const shouldReconnectRef = useRef(true);

    const clearReconnectTimer = () => {
        if (reconnectTimerRef.current != null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
    };

    const flushOutbox = () => {
        const ws = socketRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        while (outboxRef.current.length > 0) {
            const payload = outboxRef.current.shift();
            if (!payload) break;
            try {
                ws.send(payload);
            } catch {
                // Put it back and let reconnect handle it.
                outboxRef.current.unshift(payload);
                break;
            }
        }
    };

    const scheduleReconnect = useCallback(() => {
        if (!shouldReconnectRef.current) return;
        if (!token) return;
        if (reconnectTimerRef.current != null) return;

        reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
        }, WS_RECONNECT_DELAY_MS);
    }, [token]);

    const connect = useCallback(() => {
        if (!token) return;

        // If socket exists but isn't OPEN, let its onclose handle reconnection.
        if (socketRef.current) return;

        clearReconnectTimer();

        const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnectedRef.current = true;
            onConnectionChange?.(true);
            flushOutbox();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'new_message') {
                    onNewMessage(data.chatId, data.message);
                } else if (data.type === 'message_edited') {
                    onMessageEdited?.(data.chatId, data.message);
                } else if (data.type === 'message_deleted') {
                    onMessageDeleted?.(data.chatId, data.messageId, data.lastMessage);
                } else if (data.type === 'user_status') {
                    onUserStatusChange?.(data.userId, data.online);
                } else if (data.type === 'messages_seen') {
                    onMessagesSeen?.(data.chatId);
                }
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        };

        ws.onclose = () => {
            isConnectedRef.current = false;
            onConnectionChange?.(false);

            // Important: release ref so connect() can create a new socket.
            socketRef.current = null;

            // Reconnect (single timer) to restore realtime status/seen updates.
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        socketRef.current = ws;
    }, [token, onNewMessage, onMessageEdited, onMessageDeleted, onUserStatusChange, onMessagesSeen, onConnectionChange, scheduleReconnect]);

    const send = useCallback(
        (event: OutgoingEvent): boolean => {
            const payload = JSON.stringify(event);
            const ws = socketRef.current;

            if (ws?.readyState === WebSocket.OPEN) {
                try {
                    ws.send(payload);
                    return true;
                } catch {
                    outboxRef.current.push(payload);
                    scheduleReconnect();
                    return false;
                }
            }

            // Queue for later and make sure we are (re)connecting.
            outboxRef.current.push(payload);
            connect();
            scheduleReconnect();
            return false;
        },
        [connect, scheduleReconnect]
    );

    const sendMessage = useCallback(
        (chatId: string, text: string, replyToId?: string) => {
            if (!chatId || !text.trim()) return false;
            return send({ type: 'message', chatId, text, replyToId });
        },
        [send]
    );

    const editMessage = useCallback(
        (chatId: string, messageId: string, text: string) => {
            if (!chatId || !messageId || !text.trim()) return false;
            return send({ type: 'edit_message', chatId, messageId, text });
        },
        [send]
    );

    const deleteMessage = useCallback(
        (chatId: string, messageId: string) => {
            if (!chatId || !messageId) return false;
            return send({ type: 'delete_message', chatId, messageId });
        },
        [send]
    );

    const sendSeen = useCallback(
        (chatId: string) => {
            if (!chatId) return;
            send({ type: 'seen', chatId });
        },
        [send]
    );

    const disconnect = useCallback(() => {
        shouldReconnectRef.current = false;
        clearReconnectTimer();

        try {
            socketRef.current?.close();
        } finally {
            socketRef.current = null;
            isConnectedRef.current = false;
            onConnectionChange?.(false);
        }
    }, [onConnectionChange]);

    useEffect(() => {
        shouldReconnectRef.current = true;

        if (token) {
            connect();
        } else {
            disconnect();
        }

        return () => {
            disconnect();
        };
    }, [token, connect, disconnect]);

    // Optional: keep connection warm on some proxies.
    useEffect(() => {
        if (!token) return;

        const interval = window.setInterval(() => {
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                send({ type: 'ping' });
            }
        }, 25000);

        return () => window.clearInterval(interval);
    }, [token, send]);

    return { sendMessage, editMessage, deleteMessage, sendSeen, isConnected: isConnectedRef.current };
}
