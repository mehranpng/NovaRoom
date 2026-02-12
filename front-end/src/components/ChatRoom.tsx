import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, MoreVertical, Trash2 } from 'lucide-react';
import type { Message, User } from '../types';
import { Avatar } from './Avatar';
import { apiFetch } from '../config/api';
import { ContactInfo } from './ContactInfo';

interface ChatRoomProps {
    chatId: string;
    contact: User;
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string) => void;
    onBack: () => void;
    onCloseChat: () => void;
    onChatDeleted?: (chatId: string) => void;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000; // +03:30

function normalizeTs(ts: any): number {
    if (ts == null) return Date.now();
    if (typeof ts === 'string') {
        const n = Date.parse(ts);
        return Number.isFinite(n) ? n : Date.now();
    }
    if (typeof ts === 'number') {
        // Support seconds timestamps too
        return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
}

function iranShiftedDate(ts: any): Date {
    return new Date(normalizeTs(ts) + IRAN_OFFSET_MS);
}

function iranYMD(ts: any): string {
    const d = iranShiftedDate(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function iranDayNumber(ts: any): number {
    const d = iranShiftedDate(ts);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

function formatMessageTime(ts: any) {
    const d = iranShiftedDate(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function sameDay(a: any, b: any) {
    return iranYMD(a) === iranYMD(b);
}

function formatDayLabel(ts: any) {
    const today = iranDayNumber(Date.now());
    const thatDay = iranDayNumber(ts);
    const diffDays = today - thatDay;

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';

    const d = iranShiftedDate(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function bubbleShape(prevSameSender: boolean, nextSameSender: boolean) {
    if (!prevSameSender && !nextSameSender) return 'msg-shape--single';
    if (!prevSameSender && nextSameSender) return 'msg-shape--first';
    if (prevSameSender && nextSameSender) return 'msg-shape--middle';
    return 'msg-shape--last';
}

export function ChatRoom({
    chatId,
    contact,
    messages,
    currentUserId,
    onSendMessage,
    onBack,
    onCloseChat,
    onChatDeleted,
}: ChatRoomProps) {
    const [text, setText] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [showContactInfo, setShowContactInfo] = useState(false);

    const menuRef = useRef<HTMLDivElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);

    const [newMsgCount, setNewMsgCount] = useState(0);
    const isAtBottomRef = useRef(true);

    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const lastChatIdRef = useRef<string | null>(null);

    const canDelete = chatId !== 'pending';

    const scrollToBottom = (smooth = false) => {
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

    // Close the More menu when clicking outside
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!menuRef.current) return;
            if (menuRef.current.contains(e.target as Node)) return;
            setMenuOpen(false);
        };

        if (menuOpen) {
            document.addEventListener('mousedown', onDocClick);
        }

        return () => document.removeEventListener('mousedown', onDocClick);
    }, [menuOpen]);

    // Reset per-chat scroll state
    useEffect(() => {
        if (lastChatIdRef.current === chatId) return;
        lastChatIdRef.current = chatId;
        initialScrollDoneRef.current = false;
        prevLenRef.current = messages.length;
        setNewMsgCount(0);
        isAtBottomRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    // When a chat opens / changes, attempt to scroll to bottom
    useEffect(() => {
        const raf = requestAnimationFrame(() => scrollToBottom(false));
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    // When messages change, scroll to bottom on first load of this chat.
    // After that, keep pinned only if user is near bottom; otherwise show a "jump" button with count.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, chatId]);

    const onMessagesScroll = () => {
        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        if (nearBottom) setNewMsgCount(0);
    };

    const items = useMemo(() => {
        return messages.map((m, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const next = idx < messages.length - 1 ? messages[idx + 1] : null;

            const isMine = m.senderId === currentUserId;
            const prevSameSender = prev ? prev.senderId === m.senderId : false;
            const nextSameSender = next ? next.senderId === m.senderId : false;

            const dayBreak = !prev || !sameDay(prev.timestamp, m.timestamp);

            return {
                m,
                idx,
                isMine,
                dayBreak,
                shape: bubbleShape(prevSameSender, nextSameSender),
            };
        });
    }, [messages, currentUserId]);

    const submit = () => {
        const t = text.trim();
        if (!t) return;
        onSendMessage(t);
        setText('');
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const doDelete = async () => {
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
            setConfirmOpen(false);
            setMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId);
            else onBack();
        } catch (e) {
            alert('Failed to delete chat');
        }
    };

    if (showContactInfo) {
        return (
            <ContactInfo
                user={contact}
                onBack={() => {
                    setShowContactInfo(false);
                    requestAnimationFrame(() => scrollToBottom(false));
                }}
            />
        );
    }

    return (
        <div className="chat-room" style={{ position: 'relative' }}>
            <div className="chat-room__header">
                <button className="chat-room__back-btn" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>

                <button className="icon-btn chat-room__close-btn" onClick={onCloseChat} aria-label="Back to empty" type="button">
                    <ArrowLeft size={20} />
                </button>

                <button
                    className="chat-room__header-clickable chat-room__header-clickable--full"
                    onClick={() => setShowContactInfo(true)}
                    aria-label="Open contact info"
                    type="button"
                >
                    <Avatar name={contact.name} size="sm" online={contact.online} />
                    <div className="chat-room__header-info">
                        <div className="chat-room__contact-name">{contact.name}</div>
                        <div
                            className={
                                contact.online
                                    ? 'chat-room__contact-status chat-room__contact-status--online'
                                    : 'chat-room__contact-status'
                            }
                        >
                            {contact.online ? 'Online' : 'Offline'}
                        </div>
                    </div>
                </button>

                <div className="chat-room__header-actions" ref={menuRef}>
                    <button
                        className="icon-btn"
                        onClick={() => setMenuOpen(v => !v)}
                        aria-label="More"
                        disabled={!canDelete}
                        style={!canDelete ? { opacity: 0.4, cursor: 'default' } : undefined}
                        type="button"
                    >
                        <MoreVertical size={20} />
                    </button>

                    {menuOpen && canDelete && (
                        <div className="popover popover--mini popover--right">
                            <button
                                className="popover__item popover__item--danger"
                                onClick={() => {
                                    setConfirmOpen(true);
                                    setMenuOpen(false);
                                }}
                                type="button"
                            >
                                <Trash2 size={16} />
                                Delete chat
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="chat-room__messages" ref={messagesContainerRef} onScroll={onMessagesScroll}>
                <div className="chat-room__messages-inner">
                    {items.map(({ m, isMine, dayBreak, shape }) => (
                        <div key={m.id}>
                            {dayBreak && (
                                <div className="chat-room__date-separator">
                                    <div className="chat-room__date-label">{formatDayLabel(m.timestamp)}</div>
                                </div>
                            )}

                            <div className={isMine ? 'message-row message-row--mine' : 'message-row message-row--theirs'}>
                                <div
                                    className={
                                        isMine
                                            ? `message-bubble message-bubble--mine ${shape}`
                                            : `message-bubble message-bubble--theirs ${shape}`
                                    }
                                >
                                    <div className="message-text">{m.text}</div>

                                    <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                                        <span className="message-time">{formatMessageTime(m.timestamp)}</span>
                                        {isMine && (
                                            <span className={m.seen ? 'message-seen message-seen--double' : 'message-seen message-seen--single'}>
                                                {m.seen ? '✓✓' : '✓'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {newMsgCount > 0 && (
                <button
                    type="button"
                    aria-label="Jump to latest messages"
                    onClick={() => {
                        scrollToBottom(true);
                        setNewMsgCount(0);
                    }}
                    style={{
                        position: 'absolute',
                        right: 16,
                        bottom: 84,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
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
                </button>
            )}

            <div className="chat-room__input-area">
                <div className="chat-room__input-wrapper">
                    <input
                        className="chat-room__text-input"
                        placeholder="Message..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submit();
                        }}
                    />
                    <button
                        className={
                            text.trim() ? 'chat-room__send-btn chat-room__send-btn--active' : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={submit}
                        disabled={!text.trim()}
                        aria-label="Send"
                        type="button"
                    >
                        ➤
                    </button>
                </div>
            </div>

            {confirmOpen && (
                <div className="modal-overlay">
                    <div className="confirm-modal">
                        <h3 className="confirm-modal__title">Delete chat?</h3>
                        <p className="confirm-modal__text">This will delete the chat and all messages for both users.</p>
                        <div className="confirm-modal__actions">
                            <button className="confirm-modal__btn" onClick={() => setConfirmOpen(false)} type="button">
                                Cancel
                            </button>
                            <button className="confirm-modal__btn confirm-modal__btn--danger" onClick={doDelete} type="button">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
