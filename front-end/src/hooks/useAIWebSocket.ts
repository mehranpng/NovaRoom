import { useEffect, useRef, useCallback } from 'react';
import type { Message } from '../types';
import { API_WS_URL } from '../config/api';

interface UseAIWebSocketProps {
    token: string | null;
    onNewMessage: (message: Message) => void;
    onError?: (message: string) => void;
    onUserMessageSaved?: (message: Message, clientId?: string, title?: string) => void;
    onAIStreamStart?: (message: Message & { temporary?: boolean; temporarySessionId?: string }) => void;
    onAIStreamChunk?: (payload: { messageId: string; text: string; chunk?: string; reasoningContent?: string; reasoningChunk?: string; hasMainContent?: boolean; temporary?: boolean; temporarySessionId?: string }) => void;
    onAIStreamDone?: (payload: any) => void;
}

export function useAIWebSocket({
    token,
    onNewMessage,
    onError,
    onUserMessageSaved,
    onAIStreamStart,
    onAIStreamChunk,
    onAIStreamDone,
}: UseAIWebSocketProps) {
    const MAX_AI_MESSAGE_LENGTH = 3000;
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | undefined>(undefined);
    const reconnectAttemptsRef = useRef(0);
    const pendingMessagesRef = useRef<Array<{ text: string; aiChatId: string; clientId?: string; useReasoner: boolean; temporary?: boolean; temporarySessionId?: string; temporaryHistory?: Array<{ role: 'user' | 'assistant'; content: string }> }>>([]);
    const onNewMessageRef = useRef(onNewMessage);
    const onErrorRef = useRef(onError);
    const onUserMessageSavedRef = useRef(onUserMessageSaved);
    const onAIStreamStartRef = useRef(onAIStreamStart);
    const onAIStreamChunkRef = useRef(onAIStreamChunk);
    const onAIStreamDoneRef = useRef(onAIStreamDone);
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 2000;

    useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
    useEffect(() => { onUserMessageSavedRef.current = onUserMessageSaved; }, [onUserMessageSaved]);
    useEffect(() => { onAIStreamStartRef.current = onAIStreamStart; }, [onAIStreamStart]);
    useEffect(() => { onAIStreamChunkRef.current = onAIStreamChunk; }, [onAIStreamChunk]);
    useEffect(() => { onAIStreamDoneRef.current = onAIStreamDone; }, [onAIStreamDone]);

    const connect = useCallback(() => {
        if (!token) return;

        const wsUrl = `${API_WS_URL}/ws/ai?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('AI WebSocket connected');
            reconnectAttemptsRef.current = 0;

            if (pendingMessagesRef.current.length > 0) {
                const queued = [...pendingMessagesRef.current];
                pendingMessagesRef.current = [];
                queued.forEach((payload) => {
                    ws.send(JSON.stringify({
                        type: 'ai_message',
                        text: payload.text,
                        aiChatId: payload.aiChatId,
                        clientId: payload.clientId,
                        useReasoner: payload.useReasoner,
                        temporary: Boolean(payload.temporary),
                        temporarySessionId: payload.temporarySessionId,
                        history: payload.temporaryHistory,
                    }));
                });
            }

            // Send ping every 30 seconds to keep connection alive
            const pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);

            ws.addEventListener('close', () => {
                clearInterval(pingInterval);
            });
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'ai_response') {
                    onNewMessageRef.current(data.message);
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
                        temporary: Boolean(data.temporary),
                        temporarySessionId: data.temporarySessionId ? String(data.temporarySessionId) : undefined,
                    });
                } else if (data.type === 'ai_response_done') {
                    onAIStreamDoneRef.current?.(data);
                } else if (data.type === 'ai_user_message_saved') {
                    onUserMessageSavedRef.current?.(data.message, data.clientId, data.title);
                } else if (data.type === 'ai_error') {
                    onErrorRef.current?.(String(data.message || 'خطا در سرویس هوش مصنوعی'));
                } else if (data.type === 'pong') {
                    // Keep-alive response
                }
            } catch (error) {
                console.error('Failed to parse AI WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('AI WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('AI WebSocket disconnected');
            wsRef.current = null;

            // Attempt to reconnect
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttemptsRef.current++;
                reconnectTimeoutRef.current = window.setTimeout(() => {
                    console.log(`Reconnecting AI WebSocket (attempt ${reconnectAttemptsRef.current})...`);
                    connect();
                }, RECONNECT_DELAY);
            }
        };

        wsRef.current = ws;
    }, [token]);

    useEffect(() => {
        connect();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    const sendMessage = useCallback((
        text: string,
        aiChatId: string,
        clientId?: string,
        useReasoner = false,
        options?: {
            temporary?: boolean;
            temporarySessionId?: string;
            temporaryHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
        }
    ) => {
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_AI_MESSAGE_LENGTH) {
            return false;
        }
        if (!aiChatId) return false;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            pendingMessagesRef.current.push({
                text,
                aiChatId,
                clientId,
                useReasoner,
                temporary: Boolean(options?.temporary),
                temporarySessionId: options?.temporarySessionId,
                temporaryHistory: options?.temporaryHistory,
            });
            console.warn('AI WebSocket not connected yet; message queued');
            return true;
        }

        wsRef.current.send(
            JSON.stringify({
                type: 'ai_message',
                text,
                aiChatId,
                clientId,
                useReasoner,
                temporary: Boolean(options?.temporary),
                temporarySessionId: options?.temporarySessionId,
                history: options?.temporaryHistory,
            })
        );
        return true;
    }, []);

    const stopGeneration = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return false;
        }
        wsRef.current.send(JSON.stringify({ type: 'ai_stop' }));
        return true;
    }, []);

    return { sendMessage, stopGeneration };
}
