import { useState, useEffect, useCallback } from 'react';
import type { Message } from './types';
import { apiFetch } from './config/api';
import { useAIWebSocket } from './hooks/useAIWebSocket';
import { AIChatRoom } from './components/AIChatRoom';
import './App.css';

export function AIChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [isTyping, setIsTyping] = useState(false);
    const token = localStorage.getItem('token');
    const [currentUserId, setCurrentUserId] = useState<string>('');

    // Get current user ID
    useEffect(() => {
        apiFetch('/profile/me')
            .then(user => {
                setCurrentUserId(user.chatId);
            })
            .catch(error => {
                console.error('Failed to load user profile:', error);
            });
    }, []);

    // Load AI chat history
    useEffect(() => {
        const loadMessages = async () => {
            try {
                setLoading(true);
                const data = await apiFetch('/ai/messages?limit=100');
                // Add chatId to messages from API
                const messagesWithChatId = data.map((msg: any) => ({
                    ...msg,
                    chatId: 'ai_chat',
                    seen: true,
                }));
                setMessages(messagesWithChatId);
            } catch (error) {
                console.error('Failed to load AI messages:', error);
            } finally {
                setLoading(false);
            }
        };

        loadMessages();
    }, []);

    // Handle new AI response
    const handleNewMessage = useCallback((message: any) => {
        const messageWithChatId: Message = {
            ...message,
            chatId: 'ai_chat',
            seen: true,
        };
        setMessages(prev => [...prev, messageWithChatId]);
        setIsTyping(false);
    }, []);

    // Initialize AI WebSocket
    const { sendMessage } = useAIWebSocket({
        token,
        onNewMessage: handleNewMessage,
    });

    const handleSendMessage = useCallback((text: string) => {
        if (!currentUserId) return;

        // Add user message to UI immediately
        const userMessage: Message = {
            id: `temp-${Date.now()}`,
            chatId: 'ai_chat',
            senderId: currentUserId,
            text,
            timestamp: Date.now(),
            seen: false,
        };

        setMessages(prev => [...prev, userMessage]);
        setIsTyping(true);

        // Send to AI
        const success = sendMessage(text);
        if (!success) {
            console.warn('Failed to send message to AI');
            setIsTyping(false);
        }
    }, [currentUserId, sendMessage]);

    return (
        <div className="app">
            <div className="app__main">
                <AIChatRoom
                    messages={messages}
                    currentUserId={currentUserId}
                    onSendMessage={handleSendMessage}
                    onBack={() => {}}
                    loading={loading}
                    isTyping={isTyping}
                />
            </div>
        </div>
    );
}
