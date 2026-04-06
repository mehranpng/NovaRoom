import { useEffect, useRef, useCallback } from 'react';
import type { Message } from '../types';
import { API_WS_URL } from '../config/api';

interface UseAIWebSocketProps {
    token: string | null;
    onNewMessage: (message: Message) => void;
    onUserMessageSaved?: (message: Message, clientId?: string) => void;
    onAIStreamStart?: (message: Message) => void;
    onAIStreamChunk?: (messageId: string, text: string) => void;
    onAIStreamDone?: (message: Message) => void;
}

export function useAIWebSocket({
    token,
    onNewMessage,
    onUserMessageSaved,
    onAIStreamStart,
    onAIStreamChunk,
    onAIStreamDone,
}: UseAIWebSocketProps) {
    const MAX_AI_MESSAGE_LENGTH = 3000;
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | undefined>(undefined);
    const reconnectAttemptsRef = useRef(0);
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 2000;

    const connect = useCallback(() => {
        if (!token) return;

        const wsUrl = `${API_WS_URL}/ws/ai?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('AI WebSocket connected');
            reconnectAttemptsRef.current = 0;

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
                    onNewMessage(data.message);
                } else if (data.type === 'ai_response_start') {
                    onAIStreamStart?.(data.message);
                } else if (data.type === 'ai_response_chunk') {
                    onAIStreamChunk?.(data.messageId, data.text ?? '');
                } else if (data.type === 'ai_response_done') {
                    onAIStreamDone?.(data.message);
                } else if (data.type === 'ai_user_message_saved') {
                    onUserMessageSaved?.(data.message, data.clientId);
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
    }, [token, onNewMessage, onUserMessageSaved, onAIStreamStart, onAIStreamChunk, onAIStreamDone]);

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

    const sendMessage = useCallback((text: string, clientId?: string, useReasoner = false) => {
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_AI_MESSAGE_LENGTH) {
            return false;
        }
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn('AI WebSocket not connected');
            return false;
        }

        wsRef.current.send(
            JSON.stringify({
                type: 'ai_message',
                text,
                clientId,
                useReasoner,
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
