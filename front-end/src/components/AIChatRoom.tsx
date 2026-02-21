import { useState, useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, Copy, Forward } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, Chat } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ForwardModal } from './ForwardModal';
import { apiFetch } from '../config/api';

interface AIChatRoomProps {
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string) => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    loading?: boolean;
    isTyping?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000; // +03:30

function normalizeTs(ts: any): number {
    if (ts == null) return Date.now();
    if (typeof ts === 'string') {
        const n = Date.parse(ts);
        return Number.isFinite(n) ? n : Date.now();
    }
    if (typeof ts === 'number') {
        return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
}

function iranShiftedDate(ts: any): Date {
    return new Date(normalizeTs(ts) + IRAN_OFFSET_MS);
}

function formatMessageTime(ts: any) {
    const d = iranShiftedDate(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    onBack,
    loading = false,
    isTyping = false,
    chats,
    onSelectChat,
}: AIChatRoomProps) {
    const [text, setText] = useState('');
    const [msgMenu, setMsgMenu] = useState<{ id: string; top: number; left: number } | null>(null);
    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);

    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isAtBottomRef = useRef(true);
    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);

    const scrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (container) {
            const top = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
            return;
        }
        const el = messagesEndRef.current;
        if (!el) return;
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    };

    const computeNearBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom < 120;
    };

    // Keyboard offset handling
    useEffect(() => {
        const room = roomRef.current;
        if (!room) return;

        const vv = (window as any).visualViewport as VisualViewport | undefined;
        if (!vv) {
            room.style.setProperty('--keyboard-offset', '0px');
            return;
        }

        let raf: number | null = null;

        const update = () => {
            const el = roomRef.current;
            if (!el) return;

            const offsetTop = typeof vv.offsetTop === 'number' ? vv.offsetTop : 0;
            const keyboard = Math.max(0, window.innerHeight - vv.height - offsetTop);
            el.style.setProperty('--keyboard-offset', `${Math.round(keyboard)}px`);

            if (isAtBottomRef.current) {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => scrollToBottom(false));
            }
        };

        update();
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        window.addEventListener('orientationchange', update);

        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
            window.removeEventListener('orientationchange', update);
            if (raf) cancelAnimationFrame(raf);
            room.style.removeProperty('--keyboard-offset');
        };
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (msgMenuRef.current && msgMenuRef.current.contains(e.target as Node)) return;
            setMsgMenu(null);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    // Initial scroll to bottom
    useEffect(() => {
        const raf = requestAnimationFrame(() => scrollToBottom(false));
        return () => cancelAnimationFrame(raf);
    }, []);

    // Handle new messages
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            prevLenRef.current = messages.length;
            return;
        }

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;

        if (!initialScrollDoneRef.current) {
            if (messages.length > 0) {
                const raf = requestAnimationFrame(() => scrollToBottom(false));
                initialScrollDoneRef.current = true;
                prevLenRef.current = messages.length;
                return () => cancelAnimationFrame(raf);
            }
            prevLenRef.current = messages.length;
            return;
        }

        const added = messages.length - prevLenRef.current;
        if (added > 0) {
            if (nearBottom) {
                const raf = requestAnimationFrame(() => scrollToBottom(true));
                prevLenRef.current = messages.length;
                return () => cancelAnimationFrame(raf);
            }
            setNewMsgCount((c) => c + added);
        }

        prevLenRef.current = messages.length;
    }, [messages.length]);

    // Handle typing indicator
    useEffect(() => {
        if (isTyping && isAtBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom(true));
        }
    }, [isTyping]);

    const onMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        if (nearBottom) {
            setNewMsgCount(0);
            setShowScrollBtn(false);
        } else {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            setShowScrollBtn(distanceFromBottom > 300);
        }
    };

    const submit = () => {
        const t = text.trim();
        if (!t || isTyping) return;

        onSendMessage(t);
        setText('');
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement) => {
        const room = roomRef.current;
        if (!room) return;

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();

        let top = r.top - roomRect.top;
        let left = r.left - roomRect.left;

        const menuHeight = 80;
        const menuWidth = 180;

        const maxTop = roomRect.height - menuHeight - 16;
        top = Math.max(56, Math.min(top, maxTop));

        const maxLeft = roomRect.width - menuWidth - 16;
        left = Math.max(12, Math.min(left, maxLeft));

        setMsgMenu({ id: messageId, top, left });
    };

    const doCopyMessage = async (m: Message) => {
        const value = m.text ?? '';
        try {
            if (navigator.clipboard && (window as any).isSecureContext) {
                await navigator.clipboard.writeText(value);
            } else {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch {
            // ignore
        }
        setMsgMenu(null);
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const handleForwardMessage = async (targetChatId: string) => {
        if (!forwardingMessageId) return;
        
        try {
            const aiChatId = `ai_chat_${currentUserId}`;
            
            await apiFetch('/messages/forward', {
                method: 'POST',
                body: JSON.stringify({
                    messageId: forwardingMessageId,
                    targetChatId,
                }),
            });
            
            setForwardingMessageId(null);
            setForwardModalOpen(false);
            
            if (onSelectChat && targetChatId !== aiChatId) {
                onSelectChat(targetChatId);
            }
        } catch (error) {
            console.error('Failed to forward message:', error);
            alert('فوروارد پیام با خطا مواجه شد');
        }
    };

    const activeMsg = msgMenu ? messages.find((m) => m.id === msgMenu.id) : null;

    return (
        <div className="chat-room" style={{ position: 'relative' }} ref={roomRef}>
            <div className="chat-room__header">
                <button 
                    className="chat-room__back-btn" 
                    onClick={onBack} 
                    aria-label="Back" 
                    type="button"
                    style={{ display: 'flex' }}
                >
                    <ArrowLeft size={20} />
                </button>

                <div className="chat-room__header-clickable chat-room__header-clickable--full">
                    <img
                        src="/avatars/ai.png"
                        alt="NovaRoom AI"
                        style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            flexShrink: 0,
                        }}
                    />
                    <div className="chat-room__header-info">
                        <div
                            className="chat-room__contact-name"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                            NovaRoom AI
                            <VerifiedBadge size={14} />
                        </div>
                        <div className="chat-room__contact-status">
                            {isTyping ? 'در حال تایپ...' : 'دستیار هوشمند شما'}
                        </div>
                    </div>
                </div>
            </div>

            <div
                className="chat-room__messages"
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
            >
                <div className="chat-room__messages-inner">
                    {loading ? (
                        <ChatMessagesSkeleton />
                    ) : (
                        messages.map((message) => {
                            const isMine = message.senderId === currentUserId;

                            return (
                                <div
                                    key={message.id}
                                    className={isMine ? 'message-row message-row--mine' : 'message-row message-row--theirs'}
                                >
                                    <div
                                        className={
                                            isMine
                                                ? 'message-bubble message-bubble--mine msg-shape--single'
                                                : 'message-bubble message-bubble--theirs msg-shape--single'
                                        }
                                        onClick={(e) => openMessageMenu(message.id, e.currentTarget)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') openMessageMenu(message.id, e.currentTarget as any);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {isMine ? (
                                            <div className="message-text">{message.text}</div>
                                        ) : (
                                            <div className="message-text message-text--markdown">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        code({ node, className, children, ...props }: any) {
                                                            const match = /language-(\w+)/.exec(className || '');
                                                            const isBlock = !props.inline;
                                                            if (isBlock) {
                                                                return (
                                                                    <pre className="md-code-block">
                                                                        <code className={className}>
                                                                            {children}
                                                                        </code>
                                                                    </pre>
                                                                );
                                                            }
                                                            return (
                                                                <code className="md-code-inline" {...props}>
                                                                    {children}
                                                                </code>
                                                            );
                                                        },
                                                        h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
                                                        h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
                                                        h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
                                                        h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
                                                        h5: ({ children }) => <h5 className="md-h5">{children}</h5>,
                                                        h6: ({ children }) => <h6 className="md-h6">{children}</h6>,
                                                        p: ({ children }) => <p className="md-p">{children}</p>,
                                                        ul: ({ children }) => <ul className="md-ul">{children}</ul>,
                                                        ol: ({ children }) => <ol className="md-ol">{children}</ol>,
                                                        li: ({ children }) => <li className="md-li">{children}</li>,
                                                        strong: ({ children }) => <strong className="md-strong">{children}</strong>,
                                                        em: ({ children }) => <em className="md-em">{children}</em>,
                                                        del: ({ children }) => <del className="md-del">{children}</del>,
                                                        blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
                                                        a: ({ children, href }) => (
                                                            <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
                                                                {children}
                                                            </a>
                                                        ),
                                                    }}
                                                >
                                                    {message.text ?? ''}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                        <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                                            <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Typing indicator */}
                    {isTyping && (
                        <div className="message-row message-row--theirs">
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
            </div>

            {msgMenu && activeMsg && (
                <div
                    ref={msgMenuRef}
                    className="popover popover--mini"
                    style={{ top: msgMenu.top, left: msgMenu.left, right: 'auto', position: 'absolute', zIndex: 50 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="popover__item" onClick={() => doCopyMessage(activeMsg)} type="button">
                        <Copy size={16} />
                        کپی
                    </button>
                    {activeMsg.senderId !== currentUserId && (
                        <button className="popover__item" onClick={() => openForwardModal(activeMsg.id)} type="button">
                            <Forward size={16} />
                            فوروارد
                        </button>
                    )}
                </div>
            )}

            <ForwardModal
                isOpen={forwardModalOpen}
                chats={chats}
                currentUserId={currentUserId}
                onClose={() => setForwardModalOpen(false)}
                onForward={handleForwardMessage}
                onSelectChat={onSelectChat}
            />

            {(newMsgCount > 0 || showScrollBtn) && (
                <button
                    type="button"
                    aria-label="Jump to latest messages"
                    onClick={() => {
                        scrollToBottom(true);
                        setNewMsgCount(0);
                        setShowScrollBtn(false);
                    }}
                    style={{
                        position: 'absolute',
                        right: 16,
                        bottom: 96,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: newMsgCount > 0 ? '8px 10px' : '10px',
                        borderRadius: 999,
                        border: '1px solid rgba(0,0,0,0.12)',
                        background: '#fff',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
                        cursor: 'pointer',
                        fontSize: 12,
                        lineHeight: '12px',
                    }}
                >
                    <ArrowDown size={16} />
                    {newMsgCount > 0 && (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{newMsgCount}</span>
                            <span
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 999,
                                    background: '#2F80ED',
                                    marginTop: 4,
                                }}
                            />
                        </span>
                    )}
                </button>
            )}

            <div className="chat-room__input-area">
                <div className="chat-room__input-wrapper">
                    <input
                        ref={inputRef}
                        className="chat-room__text-input"
                        placeholder="پیام خود را بنویسید..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={() => {
                            setTimeout(() => {
                                if (computeNearBottom()) scrollToBottom(false);
                            }, 80);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submit();
                        }}
                        disabled={isTyping}
                    />
                    <button
                        className={
                            text.trim() && !isTyping
                                ? 'chat-room__send-btn chat-room__send-btn--active'
                                : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={submit}
                        disabled={!text.trim() || isTyping}
                        aria-label="Send"
                        type="button"
                    >
                        <svg
                            width="18"
                            height="18"
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

                .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
                .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

                @keyframes typing-bounce {
                    0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
                    40% { transform: scale(1.2); opacity: 1; }
                }

                /* Markdown styles */
                .message-text--markdown { line-height: 1.6; }
                .message-text--markdown .md-h1 { font-size: 1.4em; font-weight: 700; margin: 0.5em 0 0.3em; line-height: 1.3; }
                .message-text--markdown .md-h2 { font-size: 1.25em; font-weight: 700; margin: 0.5em 0 0.3em; line-height: 1.3; }
                .message-text--markdown .md-h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.25em; line-height: 1.3; }
                .message-text--markdown .md-h4 { font-size: 1em; font-weight: 600; margin: 0.4em 0 0.2em; }
                .message-text--markdown .md-h5 { font-size: 0.9em; font-weight: 600; margin: 0.3em 0 0.2em; }
                .message-text--markdown .md-h6 { font-size: 0.85em; font-weight: 600; margin: 0.3em 0 0.2em; color: #6b7280; }
                .message-text--markdown .md-p { margin: 0.3em 0; }
                .message-text--markdown .md-p:first-child { margin-top: 0; }
                .message-text--markdown .md-p:last-child { margin-bottom: 0; }
                .message-text--markdown .md-strong { font-weight: 700; }
                .message-text--markdown .md-em { font-style: italic; }
                .message-text--markdown .md-del { text-decoration: line-through; opacity: 0.75; }
                .message-text--markdown .md-ul { list-style: disc; padding-right: 1.4em; margin: 0.3em 0; }
                .message-text--markdown .md-ol { list-style: decimal; padding-right: 1.4em; margin: 0.3em 0; }
                .message-text--markdown .md-li { margin: 0.1em 0; }
                .message-text--markdown .md-blockquote {
                    border-right: 3px solid #d1d5db;
                    padding: 4px 10px;
                    margin: 0.4em 0;
                    color: #6b7280;
                    background: rgba(0,0,0,0.04);
                    border-radius: 0 4px 4px 0;
                }
                .message-text--markdown .md-code-inline {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.88em;
                    background: rgba(0,0,0,0.08);
                    border-radius: 3px;
                    padding: 1px 5px;
                }
                .message-text--markdown .md-code-block {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 0.85em;
                    background: rgba(0,0,0,0.10);
                    border-radius: 6px;
                    padding: 10px 12px;
                    margin: 0.5em 0;
                    overflow-x: auto;
                    white-space: pre;
                }
                .message-text--markdown .md-link {
                    color: #2563eb;
                    text-decoration: underline;
                    word-break: break-all;
                }
            `}</style>
        </div>
    );
}
