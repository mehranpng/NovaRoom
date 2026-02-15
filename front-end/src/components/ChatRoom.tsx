import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Bookmark, Copy, MoreVertical, Pencil, Reply, SendHorizontal, Trash2, X } from 'lucide-react';
import type { Message, MessageReply as MessageReplyType, User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';
import { ContactInfo } from './ContactInfo';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';

interface ChatRoomProps {
    chatId: string;
    contact: User;
    messages: Message[];
    currentUserId: string;
    onSendMessage: (payload: { text: string; replyToId?: string; editMessageId?: string }) => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    onCloseChat: () => void;
    onChatDeleted?: (chatId: string) => void;
    loading?: boolean;
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

    if (diffDays === 0) return 'امروز';
    if (diffDays === 1) return 'دیروز';

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
    onDeleteMessage,
    onBack,
    onCloseChat,
    onChatDeleted,
    loading = false,
}: ChatRoomProps) {
    const [text, setText] = useState('');
    const [chatMenuOpen, setChatMenuOpen] = useState(false);
    const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
    const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<string | null>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);

    const [replyTo, setReplyTo] = useState<MessageReplyType | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number }>(null);

    const menuRef = useRef<HTMLDivElement | null>(null);
    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteChatRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteMsgRef = useRef<HTMLDivElement | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const messageElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const highlightRafRef = useRef<number | null>(null);

    const [dragState, setDragState] = useState<{ id: string | null; x: number; active: boolean }>({
        id: null,
        x: 0,
        active: false,
    });

    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const isAtBottomRef = useRef(true);

    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const lastChatIdRef = useRef<string | null>(null);

    const swipeRef = useRef<{
        id: string | null;
        startX: number;
        startY: number;
        active: boolean;
        captured: boolean;
        pointerId: number | null;
        blockClickUntil: number;
    }>({
        id: null,
        startX: 0,
        startY: 0,
        active: false,
        captured: false,
        pointerId: null,
        blockClickUntil: 0,
    });

    // Check if this is saved messages
    const isSavedMessages = contact.chatId === 'saved';
    const canDeleteChat = chatId !== 'pending' && !isSavedMessages;

    const scrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (container) {
            const top = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
            return;
        }

        // Fallback (should be rare): if container is not available, scroll the end marker.
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

    // Auto-resize textarea based on content
    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        
        // Set height based on scrollHeight, with min and max constraints
        const newHeight = Math.min(Math.max(textarea.scrollHeight, 44), 200);
        textarea.style.height = `${newHeight}px`;
    };

    // Resize on text change
    useEffect(() => {
        resizeTextarea();
    }, [text]);

    // Keep input just above mobile keyboard (iOS/Android browsers) by using VisualViewport.
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

            // If the user is already at the bottom, keep it pinned when keyboard shows/hides.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    const resetDrag = (messageId: string) => {
        setDragState({ id: messageId, x: 0, active: false });
        window.setTimeout(() => {
            setDragState((s) => (s.id === messageId ? { id: null, x: 0, active: false } : s));
        }, 140);
    };

    const startHighlight = (messageId: string) => {
        setHighlightId(messageId);
        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = window.setTimeout(() => setHighlightId(null), 1000);
    };

    const scrollToMessage = (messageId: string) => {
        const el = messageElsRef.current.get(messageId);
        const container = messagesContainerRef.current;
        if (!el || !container) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Start highlight timer only when the target has actually reached the viewport.
        if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        const startedAt = performance.now();

        const check = () => {
            const target = messageElsRef.current.get(messageId);
            const cont = messagesContainerRef.current;
            if (!target || !cont) return;

            const cr = cont.getBoundingClientRect();
            const tr = target.getBoundingClientRect();

            const targetCenter = (tr.top + tr.bottom) / 2;
            const containerCenter = (cr.top + cr.bottom) / 2;

            const isVisible = tr.bottom > cr.top + 24 && tr.top < cr.bottom - 24;
            const nearCenter = Math.abs(targetCenter - containerCenter) < 120;

            if ((isVisible && nearCenter) || performance.now() - startedAt > 3000) {
                startHighlight(messageId);
                highlightRafRef.current = null;
                return;
            }

            highlightRafRef.current = requestAnimationFrame(check);
        };

        highlightRafRef.current = requestAnimationFrame(check);
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

    // Close menus when clicking outside
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current && menuRef.current.contains(target)) return;
            if (msgMenuRef.current && msgMenuRef.current.contains(target)) return;
            
            // Close modals if clicking on backdrop (overlay)
            if (confirmDeleteChatRef.current) {
                const modal = confirmDeleteChatRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) {
                    setConfirmDeleteChat(false);
                    return;
                }
            }
            if (confirmDeleteMsgRef.current) {
                const modal = confirmDeleteMsgRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) {
                    setConfirmDeleteMsg(null);
                    return;
                }
            }
            
            setChatMenuOpen(false);
            setMsgMenu(null);
        };

        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
            if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        };
    }, []);

    // Reset per-chat scroll state
    useEffect(() => {
        if (lastChatIdRef.current === chatId) return;
        lastChatIdRef.current = chatId;
        initialScrollDoneRef.current = false;
        prevLenRef.current = messages.length;
        setNewMsgCount(0);
        setShowScrollBtn(false);
        isAtBottomRef.current = true;
        setReplyTo(null);
        setEditingId(null);
        setMsgMenu(null);
        setText('');
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
        const container = messagesContainerRef.current;
        if (!container) return;

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        if (nearBottom) {
            setNewMsgCount(0);
            setShowScrollBtn(false);
        } else {
            // Show scroll button when user scrolls up
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            setShowScrollBtn(distanceFromBottom > 300);
        }
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
                isMine,
                dayBreak,
                shape: bubbleShape(prevSameSender, nextSameSender),
            };
        });
    }, [messages, currentUserId]);

    const submit = () => {
        const t = text.trim();
        if (!t) return;

        onSendMessage({
            text: t,
            replyToId: replyTo?.id,
            editMessageId: editingId ?? undefined,
        });

        setText('');
        setReplyTo(null);
        setEditingId(null);
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const doDeleteChat = async () => {
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
            setConfirmDeleteChat(false);
            setChatMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId);
            else onBack();
        } catch (e) {
            alert('حذف گفتگو با خطا مواجه شد');
        }
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement) => {
        const room = roomRef.current;
        if (!room) return;

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();

        // Calculate position relative to room, ensuring menu stays visible
        let top = r.top - roomRect.top;
        let left = r.left - roomRect.left;

        // Menu dimensions (approximate)
        const menuHeight = 180; // approximate height for 4 items
        const menuWidth = 180;

        // Adjust top to keep menu within viewport
        const maxTop = roomRect.height - menuHeight - 16;
        top = Math.max(56, Math.min(top, maxTop));

        // Adjust left to keep menu within viewport
        const maxLeft = roomRect.width - menuWidth - 16;
        left = Math.max(12, Math.min(left, maxLeft));

        setMsgMenu({ id: messageId, top, left });
    };

    const beginReply = (m: Message) => {
        const rt: MessageReplyType = { id: m.id, senderId: m.senderId, text: m.text };
        setReplyTo({ id: rt.id, senderId: rt.senderId, text: rt.text });
        setEditingId(null);
        setMsgMenu(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const beginEdit = (m: Message) => {
        setEditingId(m.id);
        setReplyTo(null);
        setText(m.text);
        setMsgMenu(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const doDeleteMessage = (messageId: string) => {
        setMsgMenu(null);
        setConfirmDeleteMsg(messageId);
    };

    const confirmDeleteMessage = () => {
        if (confirmDeleteMsg) {
            onDeleteMessage(confirmDeleteMsg);
            setConfirmDeleteMsg(null);
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

    const activeMsg = msgMenu ? messages.find((mm) => mm.id === msgMenu.id) : null;
    const activeMsgIsMine = activeMsg ? activeMsg.senderId === currentUserId : false;

    return (
        <div className="chat-room" style={{ position: 'relative' }} ref={roomRef}>
            <div className="chat-room__header">
                <button className="chat-room__back-btn" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>

                <button className="icon-btn chat-room__close-btn" onClick={onCloseChat} aria-label="Back to empty" type="button">
                    <ArrowLeft size={20} />
                </button>

                <button
                    className="chat-room__header-clickable chat-room__header-clickable--full"
                    onClick={() => !isSavedMessages && setShowContactInfo(true)}
                    aria-label={isSavedMessages ? "" : "Open contact info"}
                    type="button"
                    style={isSavedMessages ? { cursor: 'default' } : undefined}
                >
                    {isSavedMessages ? (
                        <div
                            style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <Bookmark size={20} color="white" />
                        </div>
                    ) : (
                        <Avatar name={contact.name} size="sm" online={contact.online} />
                    )}
                    <div className="chat-room__header-info">
                        <div
                            className="chat-room__contact-name"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                            {contact.name}
                            {!isSavedMessages && contact.verified ? <VerifiedBadge size={14} /> : null}
                        </div>
                        {!isSavedMessages && (
                            <div
                                className={
                                    contact.online
                                        ? 'chat-room__contact-status chat-room__contact-status--online'
                                        : 'chat-room__contact-status'
                                }
                            >
                                {contact.online ? 'آنلاین' : 'آفلاین'}
                            </div>
                        )}
                    </div>
                </button>

                <div className="chat-room__header-actions" ref={menuRef}>
                    <button
                        className="icon-btn"
                        onClick={() => setChatMenuOpen((v) => !v)}
                        aria-label="More"
                        disabled={!canDeleteChat}
                        style={!canDeleteChat ? { opacity: 0.4, cursor: 'default' } : undefined}
                        type="button"
                    >
                        <MoreVertical size={20} />
                    </button>

                    {chatMenuOpen && canDeleteChat && (
                        <div className="popover popover--mini popover--right">
                            <button
                                className="popover__item popover__item--danger"
                                onClick={() => {
                                    setConfirmDeleteChat(true);
                                    setChatMenuOpen(false);
                                }}
                                type="button"
                            >
                                <Trash2 size={16} />
                                حذف گفتگو
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div
                className="chat-room__messages"
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
                style={{
                    overflowX: dragState.active ? 'hidden' : 'auto'
                }}
            >
                <div className="chat-room__messages-inner">
                    {loading ? (
                        <ChatMessagesSkeleton />
                    ) : (
                        items.map(({ m, isMine, dayBreak, shape }) => {
                            const isHighlighted = highlightId === m.id;
                            const dragX = dragState.id === m.id ? dragState.x : 0;
                            const dragActive = dragState.id === m.id ? dragState.active : false;

                            return (
                                <div key={m.id}>
                                    {dayBreak && (
                                        <div className="chat-room__date-separator">
                                            <div className="chat-room__date-label">{formatDayLabel(m.timestamp)}</div>
                                        </div>
                                    )}

                                    <div
                                        className={isMine ? 'message-row message-row--mine' : 'message-row message-row--theirs'}
                                        onPointerDown={(e) => {
                                            // Mouse-only here; mobile uses touch handlers below for compatibility.
                                            if (e.pointerType !== 'mouse') return;
                                            if (e.button !== 0) return;
                                            swipeRef.current = {
                                                id: m.id,
                                                startX: e.clientX,
                                                startY: e.clientY,
                                                active: true,
                                                captured: false,
                                                pointerId: e.pointerId,
                                                blockClickUntil: swipeRef.current.blockClickUntil,
                                            };
                                        }}
                                        onPointerMove={(e) => {
                                            if (e.pointerType !== 'mouse') return;
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;

                                            const dx = e.clientX - swipeRef.current.startX;
                                            const dy = e.clientY - swipeRef.current.startY;

                                            if (!swipeRef.current.captured) {
                                                if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return;
                                                if (dx <= 0) return; // left-to-right only

                                                swipeRef.current.captured = true;
                                                try {
                                                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                                                } catch {
                                                    // ignore
                                                }
                                            }

                                            if (!swipeRef.current.captured) return;

                                            e.preventDefault();
                                            const x = Math.max(0, Math.min(72, dx));
                                            setDragState({ id: m.id, x, active: true });
                                        }}
                                        onPointerUp={(e) => {
                                            if (e.pointerType !== 'mouse') return;
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;

                                            const dx = e.clientX - swipeRef.current.startX;
                                            const dy = e.clientY - swipeRef.current.startY;

                                            if (swipeRef.current.captured) {
                                                swipeRef.current.blockClickUntil = Date.now() + 280;
                                            }

                                            if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
                                                beginReply(m);
                                            }

                                            resetDrag(m.id);

                                            swipeRef.current.active = false;
                                            swipeRef.current.captured = false;
                                            swipeRef.current.pointerId = null;
                                        }}
                                        onPointerCancel={(e) => {
                                            if (e.pointerType !== 'mouse') return;
                                            if (swipeRef.current.id !== m.id) return;
                                            resetDrag(m.id);
                                            swipeRef.current.active = false;
                                            swipeRef.current.captured = false;
                                            swipeRef.current.pointerId = null;
                                        }}
                                        onTouchStart={(e) => {
                                            const t = e.touches[0];
                                            swipeRef.current = {
                                                id: m.id,
                                                startX: t.clientX,
                                                startY: t.clientY,
                                                active: true,
                                                captured: false,
                                                pointerId: null,
                                                blockClickUntil: swipeRef.current.blockClickUntil,
                                            };
                                        }}
                                        onTouchMove={(e) => {
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const t = e.touches[0];
                                            const dx = t.clientX - swipeRef.current.startX;
                                            const dy = t.clientY - swipeRef.current.startY;

                                            if (!swipeRef.current.captured) {
                                                if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return;
                                                if (dx <= 0) return; // left-to-right only
                                                swipeRef.current.captured = true;
                                            }

                                            if (!swipeRef.current.captured) return;
                                            // Try to prevent vertical scrolling while swiping.
                                            e.preventDefault();
                                            const x = Math.max(0, Math.min(72, dx));
                                            setDragState({ id: m.id, x, active: true });
                                        }}
                                        onTouchEnd={(e) => {
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const t = e.changedTouches[0];
                                            const dx = t.clientX - swipeRef.current.startX;
                                            const dy = t.clientY - swipeRef.current.startY;

                                            if (swipeRef.current.captured) {
                                                swipeRef.current.blockClickUntil = Date.now() + 280;
                                            }

                                            if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
                                                beginReply(m);
                                            }

                                            resetDrag(m.id);

                                            swipeRef.current.active = false;
                                            swipeRef.current.captured = false;
                                            swipeRef.current.pointerId = null;
                                        }}
                                        onTouchCancel={() => {
                                            if (swipeRef.current.id !== m.id) return;
                                            resetDrag(m.id);
                                            swipeRef.current.active = false;
                                            swipeRef.current.captured = false;
                                            swipeRef.current.pointerId = null;
                                        }}
                                    >
                                        <div
                                            ref={(el) => {
                                                if (!el) {
                                                    messageElsRef.current.delete(m.id);
                                                    return;
                                                }
                                                messageElsRef.current.set(m.id, el);
                                            }}
                                            className={
                                                isMine
                                                    ? `message-bubble message-bubble--mine ${shape}`
                                                    : `message-bubble message-bubble--theirs ${shape}`
                                            }
                                            onClick={(e) => {
                                                if (Date.now() < swipeRef.current.blockClickUntil) return;
                                                openMessageMenu(m.id, e.currentTarget);
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') openMessageMenu(m.id, e.currentTarget as any);
                                            }}
                                            style={{
                                                cursor: 'pointer',
                                                transform: `translateX(${dragX}px)`,
                                                transition: dragActive ? 'none' : 'transform 140ms ease-out, box-shadow 180ms ease-out',
                                                boxShadow: isHighlighted ? '0 0 0 3px rgba(245, 158, 11, 0.4)' : undefined,
                                            }}
                                        >
                                            {m.replyTo && (
                                                <div
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        scrollToMessage(m.replyTo!.id);
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') scrollToMessage(m.replyTo!.id);
                                                    }}
                                                    className="message-reply-box"
                                                    style={{
                                                        marginBottom: 6,
                                                        padding: '6px 10px',
                                                        borderRadius: 12,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <div className="message-reply-box__label">پاسخ</div>
                                                    <div className="message-reply-box__text">
                                                        {m.replyTo.text}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="message-text">{m.text}</div>

                                            <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                                                <span className="message-time">{formatMessageTime(m.timestamp)}</span>
                                                {m.edited && (
                                                    <span style={{ fontSize: 10, opacity: isMine ? 0.9 : 0.7, marginLeft: 6 }}>
                                                        ویرایش شده
                                                    </span>
                                                )}
                                                {isMine && (
                                                    <span className={m.seen ? 'message-seen message-seen--double' : 'message-seen message-seen--single'}>
                                                        {m.seen ? '✓✓' : '✓'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
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
                    <button className="popover__item" onClick={() => beginReply(activeMsg)} type="button">
                        <Reply size={16} />
                        پاسخ
                    </button>
                    {activeMsgIsMine && (
                        <button className="popover__item" onClick={() => beginEdit(activeMsg)} type="button">
                            <Pencil size={16} />
                            ویرایش
                        </button>
                    )}
                    <button className="popover__item" onClick={() => doCopyMessage(activeMsg)} type="button">
                        <Copy size={16} />
                        کپی
                    </button>
                    {activeMsgIsMine && (
                        <button
                            className="popover__item popover__item--danger"
                            onClick={() => doDeleteMessage(activeMsg.id)}
                            type="button"
                        >
                            <Trash2 size={16} />
                            حذف
                        </button>
                    )}
                </div>
            )}

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
                {(replyTo || editingId) && (
                    <div className="chat-room__reply-edit-box">
                        <div style={{ minWidth: 0 }}>
                            <div className="chat-room__reply-edit-box__title">
                                {editingId ? 'در حال ویرایش' : 'در حال پاسخ'}
                            </div>
                            {!editingId && replyTo && (
                                <div className="chat-room__reply-edit-box__text">
                                    {replyTo.text}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label="Cancel"
                            onClick={() => {
                                setReplyTo(null);
                                setEditingId(null);
                                setText('');
                            }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                <div className="chat-room__input-wrapper">
                    <textarea
                        ref={textareaRef}
                        className="chat-room__text-input"
                        placeholder="پیام..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={() => {
                            // On mobile, do NOT force-scroll the whole view; just keep the bottom pinned if needed.
                            setTimeout(() => {
                                if (computeNearBottom()) scrollToBottom(false);
                            }, 80);
                        }}
                        onKeyDown={(e) => {
                            // Ctrl+Enter or Cmd+Enter to send message
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                submit();
                            }
                            // Just Enter alone allows new line (default textarea behavior)
                        }}
                        rows={1}
                    />
                    <button
                        className={
                            text.trim()
                                ? 'chat-room__send-btn chat-room__send-btn--active'
                                : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={submit}
                        disabled={!text.trim()}
                        aria-label="Send"
                        type="button"
                    >
                        <SendHorizontal size={18} />
                    </button>
                </div>
            </div>

            {confirmDeleteChat && (
                <div className="chat-room-modal-overlay" ref={confirmDeleteChatRef}>
                    <div className="chat-room-confirm-modal">
                        <h3 className="chat-room-confirm-modal__title">گفتگو حذف شود؟</h3>
                        <p className="chat-room-confirm-modal__text">این عمل گفتگو و تمام پیام‌ها را برای هر دو کاربر حذف خواهد کرد.</p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmDeleteChat(false)} type="button">
                                لغو
                            </button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={doDeleteChat} type="button">
                                حذف
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteMsg && (
                <div className="chat-room-modal-overlay" ref={confirmDeleteMsgRef}>
                    <div className="chat-room-confirm-modal">
                        <h3 className="chat-room-confirm-modal__title">این پیام حذف شود؟</h3>
                        <p className="chat-room-confirm-modal__text">این عمل پیام را برای هر دو کاربر حذف خواهد کرد.</p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmDeleteMsg(null)} type="button">
                                لغو
                            </button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={confirmDeleteMessage} type="button">
                                حذف
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
