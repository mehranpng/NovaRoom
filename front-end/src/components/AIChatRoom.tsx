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
    isTyping?: boolean;
}

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    onBack,
    loading = false,
    isTyping = false,
}: AIChatRoomProps) {
    const [messageText, setMessageText] = useState('');
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        text: string;
    } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        if (contextMenu) {
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
    }, [contextMenu]);

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

    const handleMessageClick = (e: React.MouseEvent, text: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            text,
        });
    };

    const handleCopyMessage = () => {
        if (contextMenu) {
            navigator.clipboard.writeText(contextMenu.text);
            setContextMenu(null);
        }
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
                <button className="chat-room__back-btn" onClick={onBack}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
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
                        <p className="chat-room__contact-status">
                            {isTyping ? 'در حال تایپ...' : 'دستیار هوشمند شما'}
                        </p>
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
                                    className={`message-row ${
                                        isMine ? 'message-row--mine' : 'message-row--theirs'
                                    } message-row--first`}
                                >
                                    <div
                                        className={`message-bubble ${
                                            isMine
                                                ? 'message-bubble--mine'
                                                : 'message-bubble--theirs'
                                        } msg-shape--single`}
                                        onClick={(e) => handleMessageClick(e, message.text)}
                                        style={{ cursor: 'pointer' }}
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
                                </div>
                            );
                        })}

                        {/* Typing indicator */}
                        {isTyping && (
                            <div className="message-row message-row--theirs message-row--first">
                                <div className="message-bubble message-bubble--theirs msg-shape--single">
                                    <div className="typing-indicator">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </div>
                                </div>
                            </div>
                        )}

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
                        disabled={isTyping}
                    />
                    <button
                        className={`chat-room__send-btn ${
                            messageText.trim() && !isTyping
                                ? 'chat-room__send-btn--active'
                                : 'chat-room__send-btn--disabled'
                        }`}
                        onClick={handleSend}
                        disabled={!messageText.trim() || isTyping}
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

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="popover popover--mini"
                    style={{
                        position: 'fixed',
                        left: `${contextMenu.x}px`,
                        top: `${contextMenu.y}px`,
                        right: 'auto',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="popover__item" onClick={handleCopyMessage}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
                        </svg>
                        کپی کردن
                    </button>
                </div>
            )}

            <style>{`
                .typing-indicator {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 0;
                }

                .typing-indicator span {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #9ca3af;
                    animation: typing-bounce 1.4s infinite ease-in-out;
                }

                .typing-indicator span:nth-child(1) {
                    animation-delay: -0.32s;
                }

                .typing-indicator span:nth-child(2) {
                    animation-delay: -0.16s;
                }

                @keyframes typing-bounce {
                    0%, 80%, 100% {
                        transform: scale(0.8);
                        opacity: 0.5;
                    }
                    40% {
                        transform: scale(1.2);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}
