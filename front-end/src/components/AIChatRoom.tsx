import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import type { Message } from '../types';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { cx } from '../utils/cx';

interface AIChatRoomProps {
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string) => void;
    onBack: () => void;
    loading?: boolean;
}

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    onBack,
    loading = false,
}: AIChatRoomProps) {
    const [messageText, setMessageText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [messageText]);

    const handleSend = () => {
        const text = messageText.trim();
        if (!text) return;

        onSendMessage(text);
        setMessageText('');

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCopyMessage = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="chat-room">
            <div className="chat-room__header">
                <button className="chat-room__back" onClick={onBack}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M15 18L9 12L15 6"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>

                <div className="chat-room__header-info">
                    <div className="chat-room__avatar">
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                            <circle cx="20" cy="20" r="20" fill="#4F46E5" />
                            <text
                                x="50%"
                                y="50%"
                                textAnchor="middle"
                                dy=".3em"
                                fontSize="16"
                                fill="white"
                                fontWeight="bold"
                            >
                                AI
                            </text>
                        </svg>
                    </div>
                    <div className="chat-room__contact-details">
                        <h2 className="chat-room__contact-name">NovaRoom AI</h2>
                        <p className="chat-room__contact-status">دستیار هوشمند شما</p>
                    </div>
                </div>
            </div>

            <div className="chat-room__messages">
                {loading ? (
                    <ChatMessagesSkeleton />
                ) : (
                    <>
                        {messages.map((message) => {
                            const isMine = message.senderId === currentUserId;

                            return (
                                <div
                                    key={message.id}
                                    className={cx(
                                        'chat-room__message',
                                        isMine
                                            ? 'chat-room__message--mine'
                                            : 'chat-room__message--theirs'
                                    )}
                                >
                                    <div className="chat-room__message-content">
                                        <div className="chat-room__message-text">
                                            {message.text}
                                        </div>
                                        <div className="chat-room__message-footer">
                                            <span className="chat-room__message-time">
                                                {formatTime(message.timestamp)}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        className="chat-room__message-action"
                                        onClick={() => handleCopyMessage(message.text)}
                                        title="کپی"
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                        >
                                            <rect
                                                x="9"
                                                y="9"
                                                width="13"
                                                height="13"
                                                rx="2"
                                                ry="2"
                                                strokeWidth="2"
                                            />
                                            <path
                                                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                                strokeWidth="2"
                                            />
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            <div className="chat-room__input">
                <textarea
                    ref={textareaRef}
                    className="chat-room__input-field"
                    placeholder="پیام خود را بنویسید..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                />
                <button
                    className="chat-room__send-button"
                    onClick={handleSend}
                    disabled={!messageText.trim()}
                >
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                    >
                        <path
                            d="M22 2L11 13"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M22 2L15 22L11 13L2 9L22 2Z"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}
