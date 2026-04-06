import { useState, useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, Copy, Forward, Check, SendHorizontal, Brain } from 'lucide-react';
import { motion, type Variants } from "framer-motion";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { Message, Chat, FileMetadata } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ForwardModal } from './ForwardModal';

interface AIChatRoomProps {
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string, useReasoner?: boolean) => void;
    onStopGenerating?: () => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    loading?: boolean;
    isTyping?: boolean;
    isResponding?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onSetPendingForwardDraft?: (targetChatId: string, draft: { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null }) => void;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000; // +03:30

function normalizeTs(ts: unknown): number {
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

function iranShiftedDate(ts: unknown): Date {
    return new Date(normalizeTs(ts) + IRAN_OFFSET_MS);
}

function formatMessageTime(ts: unknown) {
    const d = iranShiftedDate(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

// ─── CodeBlock with copy button ───────────────────────────────────────────────
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const code = typeof children === 'string' ? children : String(children ?? '');
        try {
            if (navigator.clipboard && (window as unknown as { isSecureContext?: boolean }).isSecureContext) {
                await navigator.clipboard.writeText(code);
            } else {
                const ta = document.createElement('textarea');
                ta.value = code;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    // extract language label e.g. "language-python" → "python"
    const lang = className?.replace('language-', '') ?? '';

    return (
        <div className="md-code-block-wrapper">
            <div className="md-code-block-header">
                {lang && <span className="md-code-lang">{lang}</span>}
                <button
                    type="button"
                    className={copied ? 'md-code-copy-btn md-code-copy-btn--copied' : 'md-code-copy-btn'}
                    onClick={handleCopy}
                    aria-label="Copy code"
                >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
            </div>
            <pre className="md-code-block">
                <code className={className}>{children}</code>
            </pre>
        </div>
    );
}
// ──────────────────────────────────────────────────────────────────────────────

const markdownComponents: Components = {
    code({ className, children, ...props }) {
        const isInline = !('data-language' in props) && !className?.includes('language-');
        if (!isInline) {
            return <CodeBlock className={className}>{children}</CodeBlock>;
        }
        return <code className="md-code-inline">{children}</code>;
    },
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="md-h1">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="md-h2">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="md-h3">{children}</h3>,
    h4: ({ children }: { children?: React.ReactNode }) => <h4 className="md-h4">{children}</h4>,
    h5: ({ children }: { children?: React.ReactNode }) => <h5 className="md-h5">{children}</h5>,
    h6: ({ children }: { children?: React.ReactNode }) => <h6 className="md-h6">{children}</h6>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="md-p">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="md-ul">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="md-ol">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="md-li">{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="md-strong">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em className="md-em">{children}</em>,
    del: ({ children }: { children?: React.ReactNode }) => <del className="md-del">{children}</del>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="md-blockquote">{children}</blockquote>,
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
        <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
};

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    onStopGenerating,
    onBack,
    loading = false,
    isTyping = false,
    isResponding = false,
    chats,
    onSelectChat,
    onSetPendingForwardDraft,
}: AIChatRoomProps) {
    const MAX_AI_MESSAGE_LENGTH = 3000;
    const [text, setText] = useState('');
    const [msgMenu, setMsgMenu] = useState<{ id: string; top: number; left: number } | null>(null);
    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);

    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const sendSoundRef = useRef<HTMLAudioElement | null>(null);
    const receiveSoundRef = useRef<HTMLAudioElement | null>(null);
    const isAtBottomRef = useRef(true);
    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const prevLastMessageRef = useRef<Message | null>(null);

    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    };

    useEffect(() => { resizeTextarea(); }, [text]);

    useEffect(() => {
        sendSoundRef.current = new Audio('/sounds/send.mp3');
        receiveSoundRef.current = new Audio('/sounds/receive.mp3');
        return () => {
            sendSoundRef.current = null;
            receiveSoundRef.current = null;
        };
    }, []);

    useEffect(() => {
        setReasoningEnabled(false);
    }, []);

    const playChatSound = (kind: 'send' | 'receive') => {
        const audio = kind === 'send' ? sendSoundRef.current : receiveSoundRef.current;
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {
            // Ignore blocked autoplay errors.
        });
    };

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

        const vv = (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
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
            const prevLast = prevLastMessageRef.current;
            const newLast = messages[messages.length - 1];
            if (newLast && (!prevLast || prevLast.id !== newLast.id) && newLast.senderId !== currentUserId) {
                playChatSound('receive');
            }

            if (nearBottom) {
                const raf = requestAnimationFrame(() => scrollToBottom(true));
                prevLenRef.current = messages.length;
                prevLastMessageRef.current = messages[messages.length - 1] ?? null;
                return () => cancelAnimationFrame(raf);
            }
            setNewMsgCount((c) => c + added);
        }

        prevLenRef.current = messages.length;
        prevLastMessageRef.current = messages[messages.length - 1] ?? null;
    }, [messages, currentUserId]);

    // Handle typing indicator
    useEffect(() => {
        if (isTyping && isAtBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom(true));
        }
    }, [isTyping]);

    const onMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;
        if (msgMenu) setMsgMenu(null);

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
        if (t.length > MAX_AI_MESSAGE_LENGTH) {
            alert(`حداکثر طول پیام ${MAX_AI_MESSAGE_LENGTH} کاراکتر است`);
            return;
        }
        if (!t || isResponding) return;

        onSendMessage(t, reasoningEnabled);
        playChatSound('send');
        setText('');
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const toggleReasoning = () => {
        setReasoningEnabled((prev) => {
            const next = !prev;
            if (next && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([12, 20, 12]);
            }
            return next;
        });
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => {
        const room = roomRef.current;
        if (!room) return;
        if (msgMenu?.id === messageId) {
            setMsgMenu(null);
            return;
        }

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();
        const clickX = typeof clientX === 'number' ? clientX : r.left + 12;
        const clickY = typeof clientY === 'number' ? clientY : r.bottom;
        let top = clickY - roomRect.top + 8;
        let left = clickX - roomRect.left - 12;

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
            if (navigator.clipboard && (window as unknown as { isSecureContext?: boolean }).isSecureContext) {
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

    const handleForwardFromModal = (targetChatId: string) => {
        if (!forwardingMessageId) return;
        const sourceMessage = messages.find((m) => m.id === forwardingMessageId);
        onSetPendingForwardDraft?.(targetChatId, {
            sourceChatId: `ai_chat_${currentUserId}`,
            messageId: forwardingMessageId,
            previewText: sourceMessage?.text || '',
            previewFile: sourceMessage?.file || null,
        });
        setForwardingMessageId(null);
        setForwardModalOpen(false);
        onSelectChat?.(targetChatId);
    };

    const activeMsg = msgMenu ? messages.find((m) => m.id === msgMenu.id) : null;

    const toastVariants: Variants = {
        hidden: { opacity: 0, },
        visible: { opacity: 1, transition: { duration: 0.2 } },
        exit: { opacity: 0, transition: { duration: 0.2 } },
    };

    return (
        <motion.div
            className="chat-room" style={{ position: 'relative' }} ref={roomRef}
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
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
                                        onClick={(e) => {
                                            const ne = e.nativeEvent as MouseEvent;
                                            openMessageMenu(message.id, e.currentTarget, ne.clientX, ne.clientY);
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') openMessageMenu(message.id, e.currentTarget as HTMLElement);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {isMine ? (
                                            <div className="message-text">{message.text}</div>
                                        ) : (
                                            <div className="message-text message-text--markdown">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={markdownComponents}
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
                    <button className="popover__item" onClick={() => openForwardModal(activeMsg.id)} type="button">
                        <Forward size={16} />
                        فوروارد
                    </button>
                </div>
            )}

            <ForwardModal
                isOpen={forwardModalOpen}
                chats={chats}
                currentUserId={currentUserId}
                onClose={() => setForwardModalOpen(false)}
                onSelectTargetChat={handleForwardFromModal}
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
                        border: '1px solid var(--border-secondary)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        boxShadow: 'var(--shadow-md)',
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
                    <button
                        type="button"
                        onClick={toggleReasoning}
                        aria-label="Reasoning mode"
                        title="حالت استدلال"
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            border: `1px solid ${reasoningEnabled ? 'rgba(47,128,237,0.45)' : 'var(--border-secondary)'}`,
                            background: reasoningEnabled ? 'rgba(47,128,237,0.16)' : 'var(--bg-secondary)',
                            color: reasoningEnabled ? '#2F80ED' : 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        <Brain size={18} />
                    </button>
                    <textarea
                        ref={textareaRef}
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
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        rows={1}
                        disabled={false}
                    />
                    <button
                        className={
                            isResponding || (text.trim() && !isResponding)
                                ? 'chat-room__send-btn chat-room__send-btn--active'
                                : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={isResponding ? onStopGenerating : submit}
                        disabled={isResponding ? false : !text.trim()}
                        aria-label={isResponding ? 'Stop response' : 'Send'}
                        type="button"
                    >
                        {isResponding ? (
                            <span
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 4,
                                    background: 'currentColor',
                                    display: 'inline-block',
                                }}
                            />
                        ) : (
                            <SendHorizontal size={18} />
                        )}
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
            `}</style>
        </motion.div>
    );
}
