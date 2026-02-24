import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Copy, MoreVertical, Pencil, Reply, SendHorizontal, Smile, Trash2, X, Forward, Users, Search, LogOut } from 'lucide-react';
import type { Message, MessageReply as MessageReplyType, User, Chat, FileMetadata } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';
import { ContactInfo } from './ContactInfo';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ReactionPicker } from './ReactionPicker';
import { ForwardModal } from './ForwardModal';
import { FileUpload } from './FileUpload';
import { FileMessage } from './FileMessage';
import './FileComponents.css';

interface ChatRoomProps {
    chatId: string;
    contact: User;
    messages: Message[];
    currentUserId: string;
    currentUser?: User | null;
    onSendMessage: (payload: { text: string; replyToId?: string; editMessageId?: string; file?: FileMetadata }) => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    onCloseChat: () => void;
    onChatDeleted?: (chatId: string) => void;
    loading?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onOpenDirectChat?: (user: User) => void;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000;

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

/** هر مقداری غیر از false / 0 / "false" / null / undefined رو verified حساب می‌کنیم */
function resolveVerified(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}

type GroupMember = {
    name: string;
    username: string;
    avatar: string;
    bio: string;
    chatId: string;
    verified?: boolean;
    online?: boolean;
};

export function ChatRoom({
    chatId,
    contact,
    messages,
    currentUserId,
    currentUser,
    onSendMessage,
    onDeleteMessage,
    onBack,
    onCloseChat,
    onChatDeleted,
    loading = false,
    chats,
    onSelectChat,
    onOpenDirectChat,
}: ChatRoomProps) {
    const currentChat = useMemo(
        () => chats.find((c) => c.id === chatId) || null,
        [chats, chatId]
    );
    const isGroupChat = currentChat?.chatType === 'group';
    const isVerifiedUser = resolveVerified(currentUser?.verified);

    const [text, setText] = useState('');
    const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
    const [chatMenuOpen, setChatMenuOpen] = useState(false);
    const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
    const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false);
    const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<string | null>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);

    const [replyTo, setReplyTo] = useState<MessageReplyType | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [reactionMenu, setReactionMenu] = useState<null | { id: string; top: number; left: number }>(null);

    const menuRef = useRef<HTMLDivElement | null>(null);
    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteChatRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteMsgRef = useRef<HTMLDivElement | null>(null);
    const confirmLeaveGroupRef = useRef<HTMLDivElement | null>(null);

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
    const [chatStats, setChatStats] = useState<{ totalMembers: number; onlineMembers: number } | null>(null);
    const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember>>({});
    const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
    const [showMembersList, setShowMembersList] = useState(false);
    const [memberSearch, setMemberSearch] = useState('');
    const isAtBottomRef = useRef(true);

    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const lastChatIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isGroupChat) {
            setChatStats(null);
            return;
        }
        let cancelled = false;
        const loadStats = async () => {
            try {
                const stats = await apiFetch(`/chats/${encodeURIComponent(chatId)}/stats`);
                if (!cancelled) {
                    setChatStats({
                        totalMembers: Number(stats?.totalMembers || 0),
                        onlineMembers: Number(stats?.onlineMembers || 0),
                    });
                }
            } catch {
                if (!cancelled) setChatStats(null);
            }
        };
        loadStats();
        const timer = window.setInterval(loadStats, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);

    useEffect(() => {
        if (!isGroupChat) { setGroupMembers({}); return; }
        let cancelled = false;
        const loadMembers = async () => {
            try {
                const members = await apiFetch(`/chats/${encodeURIComponent(chatId)}/members`);
                if (!cancelled && Array.isArray(members)) {
                    const map: Record<string, GroupMember> = {};
                    members.forEach((m: any) => {
                        const id = m.chatId || m.userId || m.username || '';
                        if (id) map[id] = {
                            name: m.name || '',
                            username: m.username || '',
                            avatar: m.avatar || '',
                            bio: m.bio || '',
                            chatId: id,
                            verified: m.verified,
                            online: Boolean(m.online),
                        };
                    });
                    setGroupMembers(map);
                }
            } catch { /* ignore */ }
        };
        loadMembers();
        // به روز کردن وضعیت آنلاین هر 15 ثانیه یکبار
        const timer = window.setInterval(loadMembers, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);

    const swipeRef = useRef<{
        id: string | null; startX: number; startY: number;
        active: boolean; captured: boolean; pointerId: number | null; blockClickUntil: number;
    }>({ id: null, startX: 0, startY: 0, active: false, captured: false, pointerId: null, blockClickUntil: 0 });

    const isSavedMessages = contact.chatId === 'saved';
    const canDeleteChat = chatId !== 'pending' && !isSavedMessages;
    const token = localStorage.getItem('token') || '';

    const scrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTo({ top: Math.max(0, container.scrollHeight - container.clientHeight), behavior: smooth ? 'smooth' : 'auto' });
            return;
        }
        messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    };

    const computeNearBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;
        return container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    };

    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    };

    useEffect(() => { resizeTextarea(); }, [text]);

    useEffect(() => {
        const room = roomRef.current;
        if (!room) return;
        const vv = (window as any).visualViewport as VisualViewport | undefined;
        if (!vv) { room.style.setProperty('--keyboard-offset', '0px'); return; }
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    const resetDrag = (messageId: string) => {
        setDragState({ id: messageId, x: 0, active: false });
        window.setTimeout(() => setDragState((s) => (s.id === messageId ? { id: null, x: 0, active: false } : s)), 140);
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
        if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        const startedAt = performance.now();
        const check = () => {
            const target = messageElsRef.current.get(messageId);
            const cont = messagesContainerRef.current;
            if (!target || !cont) return;
            const cr = cont.getBoundingClientRect();
            const tr = target.getBoundingClientRect();
            const isVisible = tr.bottom > cr.top + 24 && tr.top < cr.bottom - 24;
            const nearCenter = Math.abs((tr.top + tr.bottom) / 2 - (cr.top + cr.bottom) / 2) < 120;
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
                ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch { /* ignore */ }
        setMsgMenu(null);
    };

    const handleReact = async (messageId: string, emoji: string) => {
        setReactionMenu(null); setMsgMenu(null);
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
        } catch (e) { console.error('Failed to react:', e); }
    };

    const handleDeleteReaction = async (messageId: string) => {
        setReactionMenu(null); setMsgMenu(null);
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE' });
        } catch (e) { console.error('Failed to delete reaction:', e); }
    };

    const handleForwardMessage = async (targetChatId: string) => {
        if (!forwardingMessageId) return;
        try {
            await apiFetch('/messages/forward', { method: 'POST', body: JSON.stringify({ sourceChatId: chatId, messageId: forwardingMessageId, targetChatId }) });
            setForwardingMessageId(null);
        } catch (e) {
            console.error('Failed to forward:', e);
            alert('فوروارد پیام با خطا مواجه شد');
        }
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const handleFileUploaded = (file: FileMetadata) => setUploadedFile(file);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (msgMenuRef.current?.contains(target)) return;
            if (reactionMenuRef.current?.contains(target)) return;
            if (confirmDeleteChatRef.current) {
                const modal = confirmDeleteChatRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmDeleteChat(false); return; }
            }
            if (confirmDeleteMsgRef.current) {
                const modal = confirmDeleteMsgRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmDeleteMsg(null); return; }
            }
            if (confirmLeaveGroupRef.current) {
                const modal = confirmLeaveGroupRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmLeaveGroup(false); return; }
            }
            setChatMenuOpen(false);
            setMsgMenu(null);
            setReactionMenu(null);
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

    useEffect(() => {
        if (lastChatIdRef.current === chatId) return;
        lastChatIdRef.current = chatId;
        initialScrollDoneRef.current = false;
        prevLenRef.current = messages.length;
        setNewMsgCount(0); setShowScrollBtn(false);
        isAtBottomRef.current = true;
        setReplyTo(null); setEditingId(null);
        setMsgMenu(null); setReactionMenu(null);
        setText(''); setUploadedFile(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    useEffect(() => {
        const raf = requestAnimationFrame(() => scrollToBottom(false));
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) { prevLenRef.current = messages.length; return; }
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
        if (nearBottom) { setNewMsgCount(0); setShowScrollBtn(false); }
        else setShowScrollBtn(container.scrollHeight - container.scrollTop - container.clientHeight > 300);
    };

    const items = useMemo(() => messages.map((m, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : null;
        const next = idx < messages.length - 1 ? messages[idx + 1] : null;
        const isMine = m.senderId === currentUserId;
        const prevSameSender = prev ? prev.senderId === m.senderId : false;
        const nextSameSender = next ? next.senderId === m.senderId : false;
        const dayBreak = !prev || !sameDay(prev.timestamp, m.timestamp);
        return { m, isMine, dayBreak, shape: bubbleShape(prevSameSender, nextSameSender) };
    }), [messages, currentUserId]);

    const submit = () => {
        const t = text.trim();
        if (!t && !uploadedFile) return;
        onSendMessage({ text: t || '', replyToId: replyTo?.id, editMessageId: editingId ?? undefined, file: uploadedFile ?? undefined });
        setText(''); setUploadedFile(null); setReplyTo(null); setEditingId(null);
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const doDeleteChat = async () => {
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
            setConfirmDeleteChat(false); setChatMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId); else onBack();
        } catch { alert('حذف گفتگو با خطا مواجه شد'); }
    };

    const doLeaveGroup = async () => {
        try {
            await apiFetch(`/groups/${encodeURIComponent(chatId)}/leave`, { method: 'POST' });
            setConfirmLeaveGroup(false); setChatMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId); else onBack();
        } catch { alert('خروج از گروه با خطا مواجه شد'); }
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement) => {
        const room = roomRef.current;
        if (!room) return;
        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();
        const menuHeight = 220; const menuWidth = 180;
        const spaceBelow = roomRect.height - (r.bottom - roomRect.top);
        let top = spaceBelow < menuHeight + 16 ? Math.max(64, (r.bottom - roomRect.top) - menuHeight) : r.bottom - roomRect.top;
        const finalLeft = Math.max(12, Math.min(r.left - roomRect.left, roomRect.width - menuWidth - 16));
        setMsgMenu({ id: messageId, top, left: finalLeft });
        setReactionMenu(null);
    };

    const openReactionMenu = (messageId: string, targetEl: HTMLElement) => {
        const room = roomRef.current;
        if (!room) return;
        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();
        const pickerHeight = 200; const pickerWidth = 320;
        const spaceBelow = roomRect.height - (r.bottom - roomRect.top);
        let top = spaceBelow < pickerHeight + 16 ? Math.max(64, (r.bottom - roomRect.top) - pickerHeight) : r.bottom - roomRect.top;
        const finalLeft = Math.max(12, Math.min(r.left - roomRect.left, roomRect.width - pickerWidth - 16));
        setReactionMenu({ id: messageId, top, left: finalLeft });
        setMsgMenu(null);
    };

    const beginReply = (m: Message) => {
        setReplyTo({ id: m.id, senderId: m.senderId, text: m.text });
        setEditingId(null); setMsgMenu(null); setReactionMenu(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const beginEdit = (m: Message) => {
        setEditingId(m.id); setReplyTo(null); setText(m.text);
        setMsgMenu(null); setReactionMenu(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const doDeleteMessage = (messageId: string) => {
        setMsgMenu(null); setReactionMenu(null);
        setConfirmDeleteMsg(messageId);
    };

    const confirmDeleteMessage = () => {
        if (confirmDeleteMsg) { onDeleteMessage(confirmDeleteMsg); setConfirmDeleteMsg(null); }
    };

    if (showContactInfo) {
        return (
            <ContactInfo
                user={contact}
                onBack={() => { setShowContactInfo(false); requestAnimationFrame(() => scrollToBottom(false)); }}
                onOpenChat={(u) => {
                    onOpenDirectChat?.(u);
                    setShowContactInfo(false);
                    requestAnimationFrame(() => scrollToBottom(false));
                }}
            />
        );
    }

    if (viewingMemberId) {
        const memberData = groupMembers[viewingMemberId];
        const memberUser: any = memberData
            ? { chatId: memberData.chatId || viewingMemberId, name: memberData.name || viewingMemberId, username: memberData.username || '', avatar: memberData.avatar || '', bio: memberData.bio || '', online: memberData.online ?? false, verified: memberData.verified || false }
            : { chatId: viewingMemberId, name: viewingMemberId, username: '', avatar: '', bio: '', online: false };
        return (
            <ContactInfo
                user={memberUser}
                onBack={() => setViewingMemberId(null)}
                onOpenChat={(u) => {
                    onOpenDirectChat?.(u);
                    setViewingMemberId(null);
                }}
            />
        );
    }

    // ... (rest of file unchanged)
