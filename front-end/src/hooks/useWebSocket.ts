// useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { API_BASE_URL, API_WS_URL } from '../config/api';
import type { FileMetadata } from '../types';
import { decryptMessageClientSide, encryptChatTextClientSide } from '../utils/e2ee';

interface UseWebSocketProps {
    token: string | null;
    onNewMessage: (chatId: string, message: any) => void;
    onMessageEdited?: (chatId: string, message: any) => void;
    onMessageDeleted?: (chatId: string, messageId: string, lastMessage?: any) => void;
    onUserStatusChange?: (userId: string, online: boolean) => void;
    onMessagesSeen?: (chatId: string, byUserId?: string) => void;
    onReactionUpdated?: (chatId: string, messageId: string, reactions: any[]) => void;
    onTypingStatus?: (chatId: string, userId: string, isTyping: boolean) => void;
    onUploadStatus?: (chatId: string, userId: string, isUploading: boolean) => void;
    onConnectionChange?: (isConnected: boolean) => void;
    onReconnectExhausted?: () => void;
    onAINewMessage?: (message: any) => void;
    onAIError?: (payload: { message: string; code?: string; [key: string]: any }) => void;
    onAIUserMessageSaved?: (message: any, clientId?: string, title?: string) => void;
    onAIStreamStart?: (message: any) => void;
    onAIStreamChunk?: (payload: { messageId: string; text: string; chunk?: string; reasoningContent?: string; reasoningChunk?: string; hasMainContent?: boolean }) => void;
    onAIStreamDone?: (payload: any) => void;
}

type OutgoingEvent =
    | { type: 'message'; chatId: string; text: string; replyToId?: string; file?: FileMetadata; clientId?: string }
    | { type: 'edit_message'; chatId: string; messageId: string; text: string }
    | { type: 'delete_message'; chatId: string; messageId: string }
    | { type: 'seen'; chatId: string }
    | { type: 'get_chats'; requestId: string }
    | { type: 'get_messages'; requestId: string; chatId: string; limit?: number }
    | { type: 'react_message'; requestId: string; chatId: string; messageId: string; emoji: string }
    | { type: 'unreact_message'; requestId: string; chatId: string; messageId: string }
    | { type: 'forward_message'; requestId: string; messageId: string; targetChatId: string }
    | { type: 'typing'; chatId: string; isTyping: boolean }
    | { type: 'upload_status'; chatId: string; isUploading: boolean }
    | { type: 'ai_message'; text: string; aiChatId: string; clientId?: string; useReasoner?: boolean; modelKey?: 'nova-flash' | 'nova-pro' }
    | { type: 'ai_stop' }
    | { type: 'ping' };

const WS_RECONNECT_DELAY_MS = 1500;
const WS_PONG_TIMEOUT_MS = 45000;
const WS_MAX_RECONNECT_ATTEMPTS = 8;
const MAX_CHAT_MESSAGE_LENGTH = 6000;
const eventTypeAliases: Record<string, string> = {
    newMessage: 'new_message',
    messageEdited: 'message_edited',
    messageDeleted: 'message_deleted',
    messagesSeen: 'messages_seen',
    reactionUpdate: 'reaction_updated',
    reactionChanged: 'reaction_updated',
};

export function useWebSocket({
    token,
    onNewMessage,
    onMessageEdited,
    onMessageDeleted,
    onUserStatusChange,
    onMessagesSeen,
    onReactionUpdated,
    onTypingStatus,
    onUploadStatus,
    onConnectionChange,
    onReconnectExhausted,
    onAINewMessage,
    onAIError,
    onAIUserMessageSaved,
    onAIStreamStart,
    onAIStreamChunk,
    onAIStreamDone,
}: UseWebSocketProps) {
    const socketRef = useRef<WebSocket | null>(null);
    const isConnectedRef = useRef(false);
    const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
    const [reconnectExhausted, setReconnectExhausted] = useState(false);

    const outboxRef = useRef<string[]>([]);
    const reconnectTimerRef = useRef<number | null>(null);
    const shouldReconnectRef = useRef(true);
    const reconnectAttemptsRef = useRef(0);
    const lastPongAtRef = useRef<number>(Date.now());
    const pendingRequestsRef = useRef<Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timeoutId: number }>>(new Map());
    const requestCounterRef = useRef(0);
    const hiddenDisconnectRef = useRef(false);
    const offlineTimerRef = useRef<number | null>(null);

    const onNewMessageRef = useRef(onNewMessage);
    const onMessageEditedRef = useRef(onMessageEdited);
    const onMessageDeletedRef = useRef(onMessageDeleted);
    const onUserStatusChangeRef = useRef(onUserStatusChange);
    const onMessagesSeenRef = useRef(onMessagesSeen);
    const onReactionUpdatedRef = useRef(onReactionUpdated);
    const onTypingStatusRef = useRef(onTypingStatus);
    const onUploadStatusRef = useRef(onUploadStatus);
    const onConnectionChangeRef = useRef(onConnectionChange);
    const onReconnectExhaustedRef = useRef(onReconnectExhausted);
    const onAINewMessageRef = useRef(onAINewMessage);
    const onAIErrorRef = useRef(onAIError);
    const onAIUserMessageSavedRef = useRef(onAIUserMessageSaved);
    const onAIStreamStartRef = useRef(onAIStreamStart);
    const onAIStreamChunkRef = useRef(onAIStreamChunk);
    const onAIStreamDoneRef = useRef(onAIStreamDone);

    useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
    useEffect(() => { onMessageEditedRef.current = onMessageEdited; }, [onMessageEdited]);
    useEffect(() => { onMessageDeletedRef.current = onMessageDeleted; }, [onMessageDeleted]);
    useEffect(() => { onUserStatusChangeRef.current = onUserStatusChange; }, [onUserStatusChange]);
    useEffect(() => { onMessagesSeenRef.current = onMessagesSeen; }, [onMessagesSeen]);
    useEffect(() => { onReactionUpdatedRef.current = onReactionUpdated; }, [onReactionUpdated]);
    useEffect(() => { onTypingStatusRef.current = onTypingStatus; }, [onTypingStatus]);
    useEffect(() => { onUploadStatusRef.current = onUploadStatus; }, [onUploadStatus]);
    useEffect(() => { onConnectionChangeRef.current = onConnectionChange; }, [onConnectionChange]);
    useEffect(() => { onReconnectExhaustedRef.current = onReconnectExhausted; }, [onReconnectExhausted]);
    useEffect(() => { onAINewMessageRef.current = onAINewMessage; }, [onAINewMessage]);
    useEffect(() => { onAIErrorRef.current = onAIError; }, [onAIError]);
    useEffect(() => { onAIUserMessageSavedRef.current = onAIUserMessageSaved; }, [onAIUserMessageSaved]);
    useEffect(() => { onAIStreamStartRef.current = onAIStreamStart; }, [onAIStreamStart]);
    useEffect(() => { onAIStreamChunkRef.current = onAIStreamChunk; }, [onAIStreamChunk]);
    useEffect(() => { onAIStreamDoneRef.current = onAIStreamDone; }, [onAIStreamDone]);

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

    const clearOfflineTimer = () => {
        if (offlineTimerRef.current != null) {
            window.clearTimeout(offlineTimerRef.current);
            offlineTimerRef.current = null;
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
            onReconnectExhaustedRef.current?.();
            return;
        }

        reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            reconnectAttemptsRef.current += 1;
            connect();
        }, WS_RECONNECT_DELAY_MS);
    }, [token]);

    const connect = useCallback(() => {
        if (!token) return;

        if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
        if (socketRef.current?.readyState === WebSocket.CLOSING || socketRef.current?.readyState === WebSocket.CLOSED) {
            socketRef.current = null;
        }

        clearReconnectTimer();
        setConnectionState('connecting');

        const wsUrl = `${API_WS_URL}/ws?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnectedRef.current = true;
            reconnectAttemptsRef.current = 0;
            setReconnectExhausted(false);
            setConnectionState('connected');
            lastPongAtRef.current = Date.now();
            onConnectionChangeRef.current?.(true);
            flushOutbox();
        };

        ws.onmessage = (event) => {
            const processMessage = async () => {
                const data = JSON.parse(event.data);
                const dataTypeRaw = String(data?.type || '').trim();
                const dataType = eventTypeAliases[dataTypeRaw] || dataTypeRaw;
                const resolvedChatIdFromPayload = String(
                    data?.chatId
                    || data?.chat_id
                    || data?.payload?.chatId
                    || data?.payload?.chat_id
                    || data?.message?.chatId
                    || data?.message?.chat_id
                    || ''
                ).trim();
                if (dataType === 'new_message') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    if (!resolvedChatId) return;
                    const message = await decryptMessageClientSide(data.message, token, resolvedChatId);
                    onNewMessageRef.current(resolvedChatId, message);
                } else if (dataType === 'message_edited') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    if (!resolvedChatId) return;
                    const message = await decryptMessageClientSide(data.message, token, resolvedChatId);
                    onMessageEditedRef.current?.(resolvedChatId, message);
                } else if (dataType === 'message_deleted') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    if (!resolvedChatId) return;
                    const lastMessage = data.lastMessage
                        ? await decryptMessageClientSide(data.lastMessage, token, resolvedChatId)
                        : data.lastMessage;
                    onMessageDeletedRef.current?.(resolvedChatId, String(data.messageId || data.message_id || data?.message?.id || ''), lastMessage);
                } else if (dataType === 'user_status' || dataType === 'presence' || dataType === 'status_update') {
                    const resolvedUserId = String(
                        data.userId
                        || data.user_id
                        || data.chatUserId
                        || data.memberId
                        || data.username
                        || data.chatId
                        || data.chat_id
                        || data.payload?.userId
                        || data.payload?.user_id
                        || data.payload?.chatUserId
                        || data.payload?.memberId
                        || ''
                    ).trim();
                    const rawStatus = String(data.status ?? data.state ?? data.payload?.status ?? '').trim().toLowerCase();
                    const resolvedOnline = Boolean(
                        data.online
                        ?? data.isOnline
                        ?? data.is_online
                        ?? data.payload?.online
                        ?? data.payload?.isOnline
                        ?? data.payload?.is_online
                        ?? (rawStatus ? rawStatus === 'online' : undefined)
                    );
                    if (resolvedUserId) {
                        onUserStatusChangeRef.current?.(resolvedUserId, resolvedOnline);
                    }
                } else if (dataType === 'messages_seen') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    const byUserId = String(data?.byUserId || data?.by_user_id || data?.payload?.byUserId || '').trim();
                    if (resolvedChatId) onMessagesSeenRef.current?.(resolvedChatId, byUserId || undefined);
                } else if (dataType === 'reaction_updated') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    const resolvedMessageId = String(data?.messageId || data?.message_id || data?.payload?.messageId || data?.payload?.message_id || data?.message?.id || '').trim();
                    if (resolvedChatId && resolvedMessageId) {
                        onReactionUpdatedRef.current?.(resolvedChatId, resolvedMessageId, Array.isArray(data.reactions) ? data.reactions : []);
                    }
                } else if (dataType === 'typing' || dataType === 'typing_status' || dataType === 'user_typing') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    const resolvedUserId = String(data?.userId || data?.chatUserId || data?.username || '').trim();
                    const typingFlag = Boolean(data?.isTyping ?? data?.is_typing ?? data?.typing);
                    if (resolvedChatId && resolvedUserId) {
                        onTypingStatusRef.current?.(resolvedChatId, resolvedUserId, typingFlag);
                    }
                } else if (dataType === 'upload_status' || dataType === 'uploading_status' || dataType === 'user_uploading') {
                    const resolvedChatId = String(resolvedChatIdFromPayload || '').trim();
                    const resolvedUserId = String(data?.userId || data?.chatUserId || data?.username || '').trim();
                    const uploadFlag = Boolean(data?.isUploading ?? data?.is_uploading ?? data?.uploading);
                    if (resolvedChatId && resolvedUserId) {
                        onUploadStatusRef.current?.(resolvedChatId, resolvedUserId, uploadFlag);
                    }
                } else if (data.type === 'ai_response') {
                    onAINewMessageRef.current?.(data.message);
                } else if (data.type === 'ai_response_start') {
                    onAIStreamStartRef.current?.(data.message);
                } else if (data.type === 'ai_response_chunk') {
                    onAIStreamChunkRef.current?.({
                        messageId: data.messageId,
                        text: data.text ?? '',
                        chunk: data.chunk ?? '',
                        reasoningContent: data.reasoningContent ?? '',
                        reasoningChunk: data.reasoningChunk ?? '',
                        hasMainContent: Boolean(data.hasMainContent),
                    });
                } else if (data.type === 'ai_response_done') {
                    onAIStreamDoneRef.current?.(data);
                } else if (data.type === 'ai_user_message_saved') {
                    onAIUserMessageSavedRef.current?.(data.message, data.clientId, data.title);
                } else if (data.type === 'ai_error') {
                    onAIErrorRef.current?.({
                        ...data,
                        message: String(data.message || 'خطا در سرویس هوش مصنوعی'),
                    });
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
            };

            processMessage().catch((err) => {
                console.error('WebSocket message parse error:', err);
            });
        };

        ws.onclose = () => {
            isConnectedRef.current = false;
            setConnectionState('connecting');
            onConnectionChangeRef.current?.(false);
            socketRef.current = null;
            rejectAllPendingRequests('WebSocket disconnected');
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        socketRef.current = ws;
    }, [token, scheduleReconnect, rejectAllPendingRequests]);

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

            outboxRef.current.push(payload);
            connect();
            scheduleReconnect();
            return false;
        },
        [connect, scheduleReconnect]
    );

    const sendMessage = useCallback(
        async (chatId: string, text: string, replyToId?: string, file?: FileMetadata, clientId?: string) => {
            if (typeof text !== 'string') return false;
            if (text.length > MAX_CHAT_MESSAGE_LENGTH) return false;
            if (!chatId || (!text.trim() && !file)) return false;
            const encryptedText = text.trim() ? await encryptChatTextClientSide(text, token || '', chatId) : '';
            return send({ type: 'message', chatId, text: encryptedText, replyToId, file, clientId });
        },
        [send, token]
    );

    const editMessage = useCallback(
        async (chatId: string, messageId: string, text: string) => {
            if (typeof text !== 'string') return false;
            if (text.length > MAX_CHAT_MESSAGE_LENGTH) return false;
            if (!chatId || !messageId || !text.trim()) return false;
            const encryptedText = await encryptChatTextClientSide(text, token || '', chatId);
            return send({ type: 'edit_message', chatId, messageId, text: encryptedText });
        },
        [send, token]
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

    const sendUploadStatus = useCallback(
        (chatId: string, isUploading: boolean) => {
            if (!chatId) return;
            send({ type: 'upload_status', chatId, isUploading: Boolean(isUploading) });
        },
        [send]
    );

    const sendAIMessage = useCallback(
        (text: string, aiChatId: string, clientId?: string, useReasoner = false, modelKey: 'nova-flash' | 'nova-pro' = 'nova-flash') => {
            if (typeof text !== 'string' || !text.trim() || text.length > 3000) return false;
            if (!aiChatId) return false;
            return send({ type: 'ai_message', text, aiChatId, clientId, useReasoner: Boolean(useReasoner), modelKey });
        },
        [send]
    );

    const stopAIGeneration = useCallback(() => {
        return send({ type: 'ai_stop' });
    }, [send]);

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
            onConnectionChangeRef.current?.(false);
        }
    }, [rejectAllPendingRequests]);

    const sendRequest = useCallback((event: OutgoingEvent & { requestId: string }, timeoutMs = 10000) => {
        return new Promise<any>((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                pendingRequestsRef.current.delete(event.requestId);
                reject(new Error('WebSocket request timeout'));
            }, timeoutMs);

            pendingRequestsRef.current.set(event.requestId, { resolve, reject, timeoutId });
            const ok = send(event);
            if (!ok) {
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

    useEffect(() => {
        if (!token) return;

        const notifyPresenceOffline = () => {
            if (!token) return;
            try {
                void fetch(`${API_BASE_URL}/presence/offline`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    keepalive: true,
                });
            } catch {
                // noop
            }
        };

        const forceOffline = () => {
            clearOfflineTimer();
            hiddenDisconnectRef.current = true;
            notifyPresenceOffline();
            shouldReconnectRef.current = false;
            clearReconnectTimer();
            try {
                socketRef.current?.close(1000, 'client_inactive');
            } catch {
                socketRef.current = null;
            }
        };

        const restoreOnline = () => {
            clearOfflineTimer();
            if (document.visibilityState !== 'visible') return;
            if (!hiddenDisconnectRef.current && socketRef.current?.readyState === WebSocket.OPEN) return;
            hiddenDisconnectRef.current = false;
            shouldReconnectRef.current = true;
            reconnectAttemptsRef.current = 0;
            setReconnectExhausted(false);
            connect();
            window.setTimeout(() => {
                if (document.visibilityState !== 'visible') return;
                if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
                connect();
            }, 800);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                restoreOnline();
                return;
            }
            clearOfflineTimer();
            offlineTimerRef.current = window.setTimeout(() => {
                forceOffline();
            }, 350);
        };

        const handleWindowBlur = () => {
            clearOfflineTimer();
            offlineTimerRef.current = window.setTimeout(() => {
                if (document.visibilityState === 'visible') return;
                forceOffline();
            }, 350);
        };

        const handleWindowFocus = () => {
            restoreOnline();
        };

        const handlePageHide = () => {
            forceOffline();
        };

        const handleBeforeUnload = () => {
            forceOffline();
        };

        const handlePageShow = () => {
            restoreOnline();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('pageshow', handlePageShow);
        window.addEventListener('online', handleWindowFocus);

        return () => {
            clearOfflineTimer();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('pageshow', handlePageShow);
            window.removeEventListener('online', handleWindowFocus);
        };
    }, [token, connect]);

    return {
        sendMessage,
        editMessage,
        deleteMessage,
        sendSeen,
        sendTyping,
        sendUploadStatus,
        fetchChats,
        fetchMessages,
        reactMessage,
        unreactMessage,
        forwardMessage,
        sendAIMessage,
        stopAIGeneration,
        isConnected: isConnectedRef.current,
        connectionState,
        reconnectExhausted,
        reconnectNow,
        ws: socketRef.current,
    };
}
