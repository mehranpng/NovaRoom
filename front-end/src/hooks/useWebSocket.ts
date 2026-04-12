// useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import type { FileMetadata } from '../types';

interface UseWebSocketProps {
    token: string | null;
    onNewMessage: (chatId: string, message: any) => void;
    onMessageEdited?: (chatId: string, message: any) => void;
    onMessageDeleted?: (chatId: string, messageId: string, lastMessage?: any) => void;
    onUserStatusChange?: (userId: string, online: boolean) => void;
    onMessagesSeen?: (chatId: string) => void;
    onReactionUpdated?: (chatId: string, messageId: string, reactions: any[]) => void;
    onTypingStatus?: (chatId: string, userId: string, isTyping: boolean) => void;
    onConnectionChange?: (isConnected: boolean) => void;
    onReconnectExhausted?: () => void;
}

type OutgoingEvent =
    | { type: 'message'; chatId: string; text: string; replyToId?: string; file?: FileMetadata }
    | { type: 'edit_message'; chatId: string; messageId: string; text: string }
    | { type: 'delete_message'; chatId: string; messageId: string }
    | { type: 'seen'; chatId: string }
    | { type: 'get_chats'; requestId: string }
    | { type: 'get_messages'; requestId: string; chatId: string; limit?: number }
    | { type: 'react_message'; requestId: string; chatId: string; messageId: string; emoji: string }
    | { type: 'unreact_message'; requestId: string; chatId: string; messageId: string }
    | { type: 'forward_message'; requestId: string; messageId: string; targetChatId: string }
    | { type: 'typing'; chatId: string; isTyping: boolean }
    | { type: 'ping' };

const WS_RECONNECT_DELAY_MS = 1500;
const WS_PONG_TIMEOUT_MS = 45000;
const WS_MAX_RECONNECT_ATTEMPTS = 8;
const MAX_CHAT_MESSAGE_LENGTH = 6000;

export function useWebSocket({
    token,
    onNewMessage,
    onMessageEdited,
    onMessageDeleted,
    onUserStatusChange,
    onMessagesSeen,
    onReactionUpdated,
    onTypingStatus,
    onConnectionChange,
    onReconnectExhausted,
}: UseWebSocketProps) {
    const socketRef = useRef<WebSocket | null>(null);
    const isConnectedRef = useRef(false);
    const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
    const [reconnectExhausted, setReconnectExhausted] = useState(false);

    // Queue outgoing events while socket is not OPEN (fixes lost "seen" on reconnect).
    const outboxRef = useRef<string[]>([]);

    const reconnectTimerRef = useRef<number | null>(null);
    const shouldReconnectRef = useRef(true);
    const reconnectAttemptsRef = useRef(0);
    const lastPongAtRef = useRef<number>(Date.now());
    const pendingRequestsRef = useRef<Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timeoutId: number }>>(new Map());
    const requestCounterRef = useRef(0);

    const rejectAllPendingRequests = useCallback((reason: string) => {
        for (const [, pending] of pendingRequestsRef.current) {
            window.clearTimeout(pending.timeoutId);
            pending.reject(new Error(reason));
        }
        pendingRequestsRef.current.clear();
    }, []);

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
        if (reconnectAttemptsRef.current >= WS_MAX_RECONNECT_ATTEMPTS) {
            setReconnectExhausted(true);
            setConnectionState('disconnected');
            onReconnectExhausted?.();
            return;
        }

        reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            reconnectAttemptsRef.current += 1;
            connect();
        }, WS_RECONNECT_DELAY_MS);
    }, [token, onReconnectExhausted]);

    const connect = useCallback(() => {
        if (!token) return;

        if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
        if (socketRef.current?.readyState === WebSocket.CLOSING || socketRef.current?.readyState === WebSocket.CLOSED) {
            socketRef.current = null;
        }

        clearReconnectTimer();
        setConnectionState('connecting');

        const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnectedRef.current = true;
            reconnectAttemptsRef.current = 0;
            setReconnectExhausted(false);
            setConnectionState('connected');
            lastPongAtRef.current = Date.now();
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
                } else if (data.type === 'reaction_updated') {
                    onReactionUpdated?.(data.chatId, data.messageId, data.reactions);
                } else if (data.type === 'typing') {
                    onTypingStatus?.(data.chatId, data.userId, Boolean(data.isTyping));
                } else if (data.type === 'block_status_changed') {
                    window.dispatchEvent(new Event('novaroom:block_status_changed'));
                } else if (data.type === 'pong') {
                    lastPongAtRef.current = Date.now();
                } else if (data.type === 'error' && data.requestId) {
                    const pending = pendingRequestsRef.current.get(data.requestId);
                    if (pending) {
                        window.clearTimeout(pending.timeoutId);
                        pendingRequestsRef.current.delete(data.requestId);
                        pending.reject(new Error(data.error || 'WebSocket request failed'));
                    }
                } else if (data.requestId) {
                    const pending = pendingRequestsRef.current.get(data.requestId);
                    if (pending) {
                        window.clearTimeout(pending.timeoutId);
                        pendingRequestsRef.current.delete(data.requestId);
                        pending.resolve(data);
                    }
                }
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        };

        ws.onclose = () => {
            isConnectedRef.current = false;
            setConnectionState('connecting');
            onConnectionChange?.(false);

            // Important: release ref so connect() can create a new socket.
            socketRef.current = null;
            rejectAllPendingRequests('WebSocket disconnected');

            // Reconnect (single timer) to restore realtime status/seen updates.
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        socketRef.current = ws;
    }, [token, onNewMessage, onMessageEdited, onMessageDeleted, onUserStatusChange, onMessagesSeen, onReactionUpdated, onTypingStatus, onConnectionChange, scheduleReconnect, rejectAllPendingRequests]);

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
        (chatId: string, text: string, replyToId?: string, file?: FileMetadata) => {
            if (typeof text !== 'string') return false;
            if (text.length > MAX_CHAT_MESSAGE_LENGTH) return false;
            if (!chatId || (!text.trim() && !file)) return false;
            return send({ type: 'message', chatId, text, replyToId, file });
        },
        [send]
    );

    const editMessage = useCallback(
        (chatId: string, messageId: string, text: string) => {
            if (typeof text !== 'string') return false;
            if (text.length > MAX_CHAT_MESSAGE_LENGTH) return false;
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

    const sendTyping = useCallback(
        (chatId: string, isTyping: boolean) => {
            if (!chatId) return;
            send({ type: 'typing', chatId, isTyping: Boolean(isTyping) });
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
            rejectAllPendingRequests('WebSocket disconnected');
            isConnectedRef.current = false;
            setConnectionState('disconnected');
            onConnectionChange?.(false);
        }
    }, [onConnectionChange, rejectAllPendingRequests]);

    const sendRequest = useCallback((event: OutgoingEvent & { requestId: string }, timeoutMs = 10000) => {
        return new Promise<any>((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                pendingRequestsRef.current.delete(event.requestId);
                reject(new Error('WebSocket request timeout'));
            }, timeoutMs);

            pendingRequestsRef.current.set(event.requestId, { resolve, reject, timeoutId });
            const ok = send(event);
            if (!ok) {
                // keep pending; it may flush after reconnect.
                connect();
            }
        });
    }, [send, connect]);

    const makeRequestId = useCallback(() => {
        requestCounterRef.current += 1;
        return `${Date.now()}_${requestCounterRef.current}`;
    }, []);

    const fetchChats = useCallback(async () => {
        const requestId = makeRequestId();
        const response = await sendRequest({ type: 'get_chats', requestId });
        return response.chats || [];
    }, [makeRequestId, sendRequest]);

    const fetchMessages = useCallback(async (chatId: string, limit = 100) => {
        const requestId = makeRequestId();
        const response = await sendRequest({ type: 'get_messages', requestId, chatId, limit });
        return response.messages || [];
    }, [makeRequestId, sendRequest]);

    const reactMessage = useCallback(async (chatId: string, messageId: string, emoji: string) => {
        const requestId = makeRequestId();
        await sendRequest({ type: 'react_message', requestId, chatId, messageId, emoji });
    }, [makeRequestId, sendRequest]);

    const unreactMessage = useCallback(async (chatId: string, messageId: string) => {
        const requestId = makeRequestId();
        await sendRequest({ type: 'unreact_message', requestId, chatId, messageId });
    }, [makeRequestId, sendRequest]);

    const forwardMessage = useCallback(async (messageId: string, targetChatId: string) => {
        const requestId = makeRequestId();
        return await sendRequest({ type: 'forward_message', requestId, messageId, targetChatId });
    }, [makeRequestId, sendRequest]);

    const reconnectNow = useCallback(() => {
        shouldReconnectRef.current = true;
        reconnectAttemptsRef.current = 0;
        setReconnectExhausted(false);
        clearReconnectTimer();
        try {
            socketRef.current?.close();
        } finally {
            socketRef.current = null;
            connect();
        }
    }, [connect]);

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
                if (Date.now() - lastPongAtRef.current > WS_PONG_TIMEOUT_MS) {
                    try {
                        socketRef.current.close();
                    } catch {
                        // noop
                    }
                }
            }
        }, 25000);

        return () => window.clearInterval(interval);
    }, [token, send]);

    return {
        sendMessage,
        editMessage,
        deleteMessage,
        sendSeen,
        sendTyping,
        fetchChats,
        fetchMessages,
        reactMessage,
        unreactMessage,
        forwardMessage,
        isConnected: isConnectedRef.current,
        connectionState,
        reconnectExhausted,
        reconnectNow,
        ws: socketRef.current,
    };
}
