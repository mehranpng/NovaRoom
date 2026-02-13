import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { Message } from '../types';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';

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
    loading = false,
}: AIChatRoomProps) {
    const [messageText, setMessageText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const text = messageText.trim();
        if (!text) return;

        onSendMessage(text);
        setMessageText('');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
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
                <div className="chat-room__header-clickable">
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '16px',
                            flexShrink: 0,
                        }}
                    >
                        AI
                    </div>
                    <div className="chat-room__header-info">
                        <h2 className="chat-room__contact-name">NovaRoom AI</h2>
                        <p className="chat-room__contact-status">دستیار هوشمند شما</p>
                    </div>
                </div>
            </div>

            <div className="chat-room__messages">
                {loading ? (
                    <ChatMessagesSkeleton />
                ) : (
                    <div className="chat-room__messages-inner">
                        {messages.map((message) => {
                            const isMine = message.senderId === currentUserId;

                            return (
                                <div
                                    key={message.id}
                                    className={`message-row ${isMine ? 'message-row--mine' : 'message-row--theirs'} message-row--first`}
                                >
                                    <div
                                        className={`message-bubble ${
                                            isMine
                                                ? 'message-bubble--mine'
                                                : 'message-bubble--theirs'
                                        } msg-shape--single`}
                                    >
                                        <div className="message-text">{message.text}</div>
                                        <div
                                            className={`message-meta ${
                                                isMine ? 'message-meta--mine' : 'message-meta--theirs'
                                            }`}
                                        >
                                            <span className="message-time">
                                                {formatTime(message.timestamp)}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        className="icon-btn"
                                        onClick={() => handleCopyMessage(message.text)}
                                        title="کپی"
                                        style={{
                                            opacity: 0,
                                            marginRight: isMine ? '0' : '4px',
                                            marginLeft: isMine ? '4px' : '0',
                                        }}
                                        onMouseEnter={(e) => {
                                            (e.currentTarget as HTMLElement).style.opacity = '1';
                                        }}
                                        onMouseLeave={(e) => {
                                            (e.currentTarget as HTMLElement).style.opacity = '0';
                                        }}
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
                    </div>
                )}
            </div>

            <div className="chat-room__input-area">
                <div className="chat-room__input-wrapper">
                    <input
                        type="text"
                        className="chat-room__text-input"
                        placeholder="پیام خود را بنویسید..."
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        className={`chat-room__send-btn ${
                            messageText.trim()
                                ? 'chat-room__send-btn--active'
                                : 'chat-room__send-btn--disabled'
                        }`}
                        onClick={handleSend}
                        disabled={!messageText.trim()}
                    >
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M22 2L11 13" />
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
