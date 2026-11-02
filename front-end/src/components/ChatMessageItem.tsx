import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { FileMetadata, Message } from '../types';
import { Avatar } from './Avatar';
import { FileMessage } from './FileMessage';
import { ChessInviteCard } from './chess/ChessInviteCard';
import { toPersianDigits } from '../utils/format';
import { triggerHaptic } from '../utils/haptics';
import { copyText } from '../utils/clipboard';
import { cancelUpload } from '../utils/chatFileUploader';

export type ReactionEntry = { emoji: string; count: number; userIds: string[] };

type ChatMessageActions = {
    openMenu: (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => void;
    openReactionMenu: (messageId: string, targetEl: HTMLElement) => void;
    react: (messageId: string, emoji: string) => void;
    deleteReaction: (messageId: string) => void;
    reply: (message: Message) => void;
    toggleSelect: (messageId: string) => void;
    scrollToMessage: (messageId: string) => void;
    openForwardSource: (message: Message) => void;
    openMember: (memberId: string) => void;
    toggleReasoning: (messageId: string) => void;
    mediaReady: (messageId: string) => void;
    openImage: (url: string, file: FileMetadata | null) => void;
    openVideo: (url: string, file: FileMetadata | null) => void;
    swipeLock: (locked: boolean) => void;
    registerEl: (messageId: string, el: HTMLDivElement | null) => void;
};

export type ChatMessageItemProps = {
    message: Message;
    displayText: string;
    isMine: boolean;
    isGroupChat: boolean;
    isOfficialChannel: boolean;
    isSelectionModeActive: boolean;
    canSwipeToReply: boolean;
    currentUserId: string;
    token: string;
    chatId: string;
    dayBreak: boolean;
    dayLabel: string;
    formattedTime: string;
    shape: string;
    isBigEmojiOnly: boolean;
    emojiOnlyClass: string;
    senderName: string;
    senderAvatar: string;
    senderPending: boolean;
    replySenderName: string;
    replySenderPending: boolean;
    replyPreviewText: string;
    reactions: ReactionEntry[];
    isHighlighted: boolean;
    isSelected: boolean;
    showUnreadSeparator: boolean;
    unreadCountForUi: number;
    isMenuActive: boolean;
    isSeenForUi: boolean;
    messageSeenCount: number;
    reasoningOpen: boolean;
    unreadSeparatorRef: RefObject<HTMLDivElement | null>;
    actions: ChatMessageActions;
};

const SENDER_COLORS = ['#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#00BCD4', '#009688', '#4CAF50', '#FF5722', '#FF9800'];

function normalizeMessageTextForRender(text: string): string {
    let t = String(text || '').replace(/\\n/g, '\n');
    t = t.replace(/\\\[/g, '$$$$');
    t = t.replace(/\\\]/g, '$$$$');
    t = t.replace(/\\\(/g, '$$');
    t = t.replace(/\\\)/g, '$$');
    return t;
}

const MemoMarkdown = memo(function MemoMarkdown({ text, components }: { text: string; components: Components }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {normalizeMessageTextForRender(text)}
        </ReactMarkdown>
    );
});

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const code = typeof children === 'string' ? children : String(children ?? '');
        try {
            await copyText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            return;
        }
    };

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

const MARKDOWN_TRIGGER_RE = /[#*`\[$>\\_\-\d+]/;
const MARKDOWN_SYNTAX_RE = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|(```|`[^`]+`|\[[^\]]+]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\$\$?[\s\S]+?\$\$?|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/m;

function hasMarkdownSyntax(text: string): boolean {
    if (!MARKDOWN_TRIGGER_RE.test(text)) return false;
    return MARKDOWN_SYNTAX_RE.test(text);
}

function renderTextWithLinks(text: string): React.ReactNode {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const isUrl = (value: string) => /^(https?:\/\/[^\s]+|www\.[^\s]+)$/i.test(value);
    const parts = text.split(urlRegex);
    return parts.map((part, idx) => {
        if (!part) return null;
        if (isUrl(part)) {
            const href = part.startsWith('http') ? part : `https://${part}`;
            return <a key={`${part}-${idx}`} className="md-link" href={href} target="_blank" rel="noopener noreferrer">{part}</a>;
        }
        return <span key={`${idx}-${part.slice(0, 8)}`}>{part}</span>;
    });
}

const MemoMessageTextContent = memo(function MemoMessageTextContent({
    rawText,
    isBigEmojiOnly,
    emojiOnlyClass,
}: {
    rawText: string;
    isBigEmojiOnly: boolean;
    emojiOnlyClass: string;
}) {
    const normalized = useMemo(() => normalizeMessageTextForRender(rawText), [rawText]);
    const isMarkdown = useMemo(() => hasMarkdownSyntax(normalized), [normalized]);
    const linkedNodes = useMemo(() => (isMarkdown ? null : renderTextWithLinks(normalized)), [isMarkdown, normalized]);

    if (isMarkdown) {
        return (
            <div className="message-text message-text--markdown">
                <MemoMarkdown text={normalized} components={markdownComponents} />
            </div>
        );
    }
    return (
        <div className={isBigEmojiOnly ? `message-text message-text--emoji-only ${emojiOnlyClass}` : 'message-text'}>
            {linkedNodes}
        </div>
    );
});

function shallowRecordEqual(a: object, b: object) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
    ));
}

function chatMessageItemPropsEqual(prev: ChatMessageItemProps, next: ChatMessageItemProps) {
    if (prev.message !== next.message && !shallowRecordEqual(prev.message, next.message)) return false;
    if (prev.message.upload?.phase !== next.message.upload?.phase) return false;
    if (prev.message.upload?.progress !== next.message.upload?.progress) return false;
    if (prev.message.file?.fileId !== next.message.file?.fileId) return false;
    if (prev.message.file?.localUrl !== next.message.file?.localUrl) return false;
    const keys = Object.keys(prev) as (keyof ChatMessageItemProps)[];
    if (keys.length !== Object.keys(next).length) return false;
    return keys.every((key) => key === 'message' || Object.is(prev[key], next[key]));
}

export const ChatMessageItem = memo(function ChatMessageItem({
    message,
    displayText,
    isMine,
    isGroupChat,
    isOfficialChannel,
    isSelectionModeActive,
    canSwipeToReply,
    currentUserId,
    token,
    chatId,
    dayBreak,
    dayLabel,
    formattedTime,
    shape,
    isBigEmojiOnly,
    emojiOnlyClass,
    senderName,
    senderAvatar,
    senderPending,
    replySenderName,
    replySenderPending,
    replyPreviewText,
    reactions,
    isHighlighted,
    isSelected,
    showUnreadSeparator,
    unreadCountForUi,
    isMenuActive,
    isSeenForUi,
    messageSeenCount,
    reasoningOpen,
    unreadSeparatorRef,
    actions,
}: ChatMessageItemProps) {
    const bubbleRef = useRef<HTMLDivElement | null>(null);
    const [isSwiping, setIsSwiping] = useState(false);
    const swipeRef = useRef({ startX: 0, startY: 0, active: false, captured: false, pointerId: null as number | null, blockClickUntil: 0 });
    const longPressTimerRef = useRef<number | null>(null);
    const longPressOriginRef = useRef({ x: 0, y: 0 });
    const suppressClickRef = useRef(false);
    const swipeEnabled = canSwipeToReply && !isSelectionModeActive;

    const setBubbleRef = useCallback((el: HTMLDivElement | null) => {
        bubbleRef.current = el;
        actions.registerEl(message.id, el);
    }, [actions, message.id]);

    const cancelLongPress = () => {
        if (longPressTimerRef.current === null) return;
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const startLongPress = (x: number, y: number) => {
        cancelLongPress();
        suppressClickRef.current = false;
        if (isSelectionModeActive) return;
        longPressOriginRef.current = { x, y };
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            suppressClickRef.current = true;
            actions.toggleSelect(message.id);
            triggerHaptic();
        }, 450);
    };

    const consumeSuppressedClick = () => {
        if (!suppressClickRef.current) return false;
        suppressClickRef.current = false;
        return true;
    };

    const trackLongPressMove = (x: number, y: number) => {
        if (longPressTimerRef.current === null) return;
        const dx = x - longPressOriginRef.current.x;
        const dy = y - longPressOriginRef.current.y;
        if (Math.hypot(dx, dy) > 8) cancelLongPress();
    };

    useEffect(() => cancelLongPress, []);

    const resetDrag = () => {
        const el = bubbleRef.current;
        if (el) {
            el.style.transition = 'transform 140ms ease-out, box-shadow 220ms ease';
            el.style.transform = '';
            el.style.touchAction = '';
        }
        setIsSwiping(false);
        actions.swipeLock(false);
    };

    const applyDragOffset = (dx: number) => {
        const el = bubbleRef.current;
        if (!el) return;
        el.style.transition = 'none';
        el.style.touchAction = 'none';
        el.style.transform = `translateX(${Math.max(0, Math.min(72, dx))}px)`;
    };

    const sortedReactions = useMemo(
        () => reactions.slice().sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)),
        [reactions],
    );

    const senderColor = useMemo(() => {
        if (!message.senderId) return SENDER_COLORS[0];
        const idx = Math.abs(String(message.senderId).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % SENDER_COLORS.length;
        return SENDER_COLORS[idx];
    }, [message.senderId]);

    return (
        <div className="message-item">
            {dayBreak && (
                <div className="chat-room__date-separator">
                    <div className="chat-room__date-label">{dayLabel}</div>
                </div>
            )}

            {showUnreadSeparator && (
                <div ref={unreadSeparatorRef} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', justifyContent: 'center' }}>
                    <div style={{ height: 1, background: 'var(--border-primary)', flex: 1, opacity: 0.8 }} />
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 999, padding: '6px 10px', fontFamily: 'Vazir, sans-serif' }}>
                        پیام‌های خوانده نشده{unreadCountForUi > 0 ? ` (${toPersianDigits(unreadCountForUi)})` : ''}
                    </div>
                    <div style={{ height: 1, background: 'var(--border-primary)', flex: 1, opacity: 0.8 }} />
                </div>
            )}

            <div
                className={`${isMine ? 'message-row message-row--mine' : `message-row message-row--theirs${isGroupChat ? ' message-row--group' : ''}`} ${isHighlighted ? 'message-row--flash' : ''} ${isSelected ? 'message-row--selected' : ''} ${isSelectionModeActive ? 'message-row--selecting' : ''} ${isSwiping ? 'message-row--swiping' : ''}`}
                onClickCapture={(e) => {
                    if (consumeSuppressedClick()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    if (!isSelectionModeActive) return;
                    const target = e.target as HTMLElement;
                    if (!target.closest('.message-select-indicator')) {
                        e.preventDefault();
                        e.stopPropagation();
                        actions.toggleSelect(message.id);
                    }
                }}
                onClick={(e) => {
                    if (!isSelectionModeActive) return;
                    if (consumeSuppressedClick()) return;
                    if (Date.now() < swipeRef.current.blockClickUntil) return;
                    e.stopPropagation();
                    actions.toggleSelect(message.id);
                }}
                onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button === 0) startLongPress(e.clientX, e.clientY);
                    if (!swipeEnabled) return;
                    if (e.pointerType !== 'mouse' || e.button !== 0) return;
                    swipeRef.current = { ...swipeRef.current, startX: e.clientX, startY: e.clientY, active: true, captured: false, pointerId: e.pointerId };
                }}
                onPointerMove={(e) => {
                    if (e.pointerType === 'mouse') trackLongPressMove(e.clientX, e.clientY);
                    if (!swipeEnabled) return;
                    if (e.pointerType !== 'mouse' || !swipeRef.current.active) return;
                    const dx = e.clientX - swipeRef.current.startX;
                    const dy = e.clientY - swipeRef.current.startY;
                    if (!swipeRef.current.captured) {
                        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) || dx <= 0) return;
                        swipeRef.current.captured = true;
                        actions.swipeLock(true);
                        setIsSwiping(true);
                        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { void 0; }
                    }
                    e.preventDefault();
                    applyDragOffset(dx);
                }}
                onPointerUp={(e) => {
                    cancelLongPress();
                    if (!swipeEnabled) return;
                    if (e.pointerType !== 'mouse' || !swipeRef.current.active) return;
                    const dx = e.clientX - swipeRef.current.startX;
                    const dy = e.clientY - swipeRef.current.startY;
                    if (swipeRef.current.captured) swipeRef.current.blockClickUntil = Date.now() + 280;
                    if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
                        actions.reply(message);
                        triggerHaptic();
                    }
                    resetDrag();
                    swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                }}
                onPointerCancel={(e) => {
                    cancelLongPress();
                    if (!swipeEnabled) return;
                    if (e.pointerType !== 'mouse') return;
                    resetDrag();
                    swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                }}
                onTouchStart={(e) => {
                    const t = e.touches[0];
                    startLongPress(t.clientX, t.clientY);
                    if (!swipeEnabled) return;
                    swipeRef.current = { ...swipeRef.current, startX: t.clientX, startY: t.clientY, active: true, captured: false };
                }}
                onTouchMove={(e) => {
                    const moveTouch = e.touches[0];
                    trackLongPressMove(moveTouch.clientX, moveTouch.clientY);
                    if (!swipeEnabled) return;
                    if (!swipeRef.current.active) return;
                    const t = moveTouch;
                    const dx = t.clientX - swipeRef.current.startX;
                    const dy = t.clientY - swipeRef.current.startY;
                    if (!swipeRef.current.captured) {
                        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) || dx <= 0) return;
                        swipeRef.current.captured = true;
                        actions.swipeLock(true);
                        setIsSwiping(true);
                    }
                    applyDragOffset(dx);
                }}
                onTouchEnd={(e) => {
                    cancelLongPress();
                    if (!swipeEnabled) return;
                    if (!swipeRef.current.active) return;
                    const t = e.changedTouches[0];
                    const dx = t.clientX - swipeRef.current.startX;
                    const dy = t.clientY - swipeRef.current.startY;
                    if (swipeRef.current.captured) swipeRef.current.blockClickUntil = Date.now() + 280;
                    if (dx > 60 && Math.abs(dx) > Math.abs(dy)) {
                        actions.reply(message);
                        triggerHaptic();
                    }
                    resetDrag();
                    swipeRef.current = { ...swipeRef.current, active: false, captured: false };
                }}
                onTouchCancel={() => {
                    cancelLongPress();
                    if (!swipeEnabled) return;
                    resetDrag();
                    swipeRef.current = { ...swipeRef.current, active: false, captured: false };
                }}
            >
                {isSelectionModeActive && (
                    <div
                        className={`message-select-indicator ${isSelected ? 'message-select-indicator--selected' : ''}`}
                        onClick={(e: ReactMouseEvent) => {
                            e.stopPropagation();
                            actions.toggleSelect(message.id);
                        }}
                        role="checkbox"
                        aria-checked={isSelected}
                        title={isSelected ? 'لغو انتخاب' : 'انتخاب پیام'}
                    >
                        {isSelected && <Check size={13} strokeWidth={3} />}
                    </div>
                )}

                {isGroupChat && !isMine && (shape === 'msg-shape--single' || shape === 'msg-shape--last') && (
                    <div style={{ position: 'absolute', left: 0, bottom: 0, cursor: 'pointer', zIndex: 1 }}
                        onClick={(e) => {
                            if (isSelectionModeActive) return;
                            e.stopPropagation();
                            actions.openMember(message.senderId);
                        }}>
                        {senderPending
                            ? <span className="skeleton-glass skeleton-glass--avatar" aria-hidden />
                            : <Avatar name={senderName} size="sm" src={senderAvatar} />}
                    </div>
                )}

                <div
                    ref={setBubbleRef}
                    className={isMine
                        ? `message-bubble message-bubble--mine ${shape} ${isBigEmojiOnly ? 'message-bubble--emoji-only' : ''} ${isSelected ? 'message-bubble--selected' : ''}`
                        : `message-bubble message-bubble--theirs ${shape} ${isBigEmojiOnly ? 'message-bubble--emoji-only' : ''} ${isSelected ? 'message-bubble--selected' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (consumeSuppressedClick()) return;
                        if (Date.now() < swipeRef.current.blockClickUntil) return;
                        if (isSelectionModeActive) {
                            actions.toggleSelect(message.id);
                            return;
                        }
                        const ne = e.nativeEvent as MouseEvent;
                        const hasPointer = typeof ne.clientX === 'number' && typeof ne.clientY === 'number' && (ne.clientX > 0 || ne.clientY > 0);
                        actions.openMenu(message.id, e.currentTarget, hasPointer ? ne.clientX : undefined, hasPointer ? ne.clientY : undefined);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        if (isSelectionModeActive) return;
                        actions.openMenu(message.id, e.currentTarget, e.clientX, e.clientY);
                    }}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') actions.openMenu(message.id, e.currentTarget); }}
                    style={{
                        cursor: 'pointer',
                        transform: 'translateX(0px)',
                        transition: 'transform 140ms ease-out, box-shadow 220ms ease',
                        touchAction: 'auto',
                        boxShadow: isMenuActive
                            ? 'inset 0 0 0 2px color-mix(in srgb, var(--accent-primary) 36%, transparent)'
                            : 'inset 0 0 0 2px rgba(0,0,0,0)',
                    }}
                >
                    {isGroupChat && !isMine && !isBigEmojiOnly && (shape === 'msg-shape--single' || shape === 'msg-shape--first') && (
                        <div className="message-sender-name" onClick={(e) => {
                            if (isSelectionModeActive) return;
                            e.stopPropagation();
                            actions.openMember(message.senderId);
                        }}
                            style={{ color: senderColor }}>
                            {senderPending
                                ? <span className="skeleton-glass skeleton-glass--name" aria-hidden />
                                : senderName}
                        </div>
                    )}

                    {message.forwardedFrom && (
                        <button
                            type="button"
                            className="message-forwarded-label"
                            onClick={(e) => {
                                if (isSelectionModeActive) return;
                                e.stopPropagation();
                                actions.openForwardSource(message);
                            }}
                        >
                            فوروارد شده از: {message.forwardedFrom.name || message.forwardedFrom.username || 'ناشناس'}
                        </button>
                    )}

                    {message.replyTo && (
                        <div onClick={(e) => {
                            if (isSelectionModeActive) return;
                            e.stopPropagation();
                            actions.scrollToMessage(message.replyTo!.id);
                        }}
                            role="button" tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !isSelectionModeActive) actions.scrollToMessage(message.replyTo!.id); }}
                            className="message-reply-box"
                            style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 12, cursor: 'pointer' }}>
                            <div className="message-reply-box__label">
                                {replySenderPending
                                    ? <span className="skeleton-glass skeleton-glass--reply-name" aria-hidden />
                                    : (isGroupChat ? replySenderName : 'پاسخ')}
                            </div>
                            <div className="message-reply-box__text">{replyPreviewText}</div>
                        </div>
                    )}

                    {message.file && (
                        <FileMessage
                            file={message.file}
                            token={token}
                            chatId={chatId}
                            upload={message.deliveryStatus === 'sending' && message.file.localUrl ? message.upload : undefined}
                            onCancelUpload={() => cancelUpload(message.id)}
                            onMediaLoad={() => actions.mediaReady(message.id)}
                            onMediaError={() => actions.mediaReady(message.id)}
                            onImageClick={(imageUrl, file) => {
                                if (isSelectionModeActive) {
                                    actions.toggleSelect(message.id);
                                    return;
                                }
                                actions.openImage(imageUrl, file);
                            }}
                            onVideoClick={(videoUrl, file) => {
                                if (isSelectionModeActive) {
                                    actions.toggleSelect(message.id);
                                    return;
                                }
                                actions.openVideo(videoUrl, file);
                            }}
                        />
                    )}
                    {message.reasoningEnabled && message.reasoningContent && (
                        <div className="ai-reasoning-message-stack" style={{ width: '100%' }}>
                            <button
                                type="button"
                                className="ai-reasoning-header"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.toggleReasoning(message.id);
                                }}
                            >
                                <span className="ai-reasoning-header-main">
                                    <span className="ai-reasoning-static-title">روند استدلال</span>
                                    <span className='ai-reasoning-timer'>
                                        {`${toPersianDigits(Math.floor(Number(message.reasoningDurationSec || 0) / 60))}:${toPersianDigits(String(Number(message.reasoningDurationSec || 0) % 60).padStart(2, '0'))}`}
                                    </span>
                                </span>
                                <ChevronDown size={15} className={reasoningOpen ? 'ai-reasoning-chevron ai-reasoning-chevron--open' : 'ai-reasoning-chevron'} />
                            </button>
                            {reasoningOpen && (
                                <div className="ai-reasoning-body">
                                    <div className="ai-reasoning-content">{message.reasoningContent}</div>
                                </div>
                            )}
                        </div>
                    )}
                    {message.chessInvite && (
                        <ChessInviteCard invite={message.chessInvite} isMine={isMine} />
                    )}
                    {message.text && !message.chessInvite && !(message.reasoningEnabled && message.reasoningContent) && (
                        <MemoMessageTextContent
                            rawText={displayText}
                            isBigEmojiOnly={isBigEmojiOnly}
                            emojiOnlyClass={emojiOnlyClass}
                        />
                    )}
                    {message.text && !message.chessInvite && message.reasoningEnabled && message.reasoningContent && (
                        <div className="ai-reasoning-answer" style={{ marginTop: 0 }}>
                            <MemoMessageTextContent
                                rawText={displayText}
                                isBigEmojiOnly={isBigEmojiOnly}
                                emojiOnlyClass={emojiOnlyClass}
                            />
                        </div>
                    )}

                    {sortedReactions.length > 0 && (
                        <div className="message-reactions">
                            {sortedReactions.map((reaction, idx) => {
                                const userIds = reaction.userIds || [];
                                const isMyReaction = userIds.includes(currentUserId);
                                return (
                                    <button key={idx}
                                        className={isMyReaction ? 'message-reaction message-reaction--active' : 'message-reaction'}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isSelectionModeActive) {
                                                actions.toggleSelect(message.id);
                                                return;
                                            }
                                            if (isMyReaction) actions.deleteReaction(message.id);
                                            else actions.react(message.id, reaction.emoji);
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!window.matchMedia?.('(pointer:fine)').matches) return;
                                            e.stopPropagation();
                                            actions.openReactionMenu(message.id, e.currentTarget);
                                        }}
                                        type="button"
                                    >
                                        <span className="message-reaction__emoji">{reaction.emoji}</span>
                                        {reaction.count > 1 && (
                                            <span className="message-reaction__count" style={{ fontFamily: 'Vazir, sans-serif' }}>
                                                {toPersianDigits(reaction.count)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                        <span className="message-time">{formattedTime}</span>
                        {message.edited && <span className="message-edited-label">ویرایش شده</span>}
                        {message.aiModelName && <span className="message-ai-model-label">{message.aiModelName}</span>}
                        {isOfficialChannel && (
                            <span className="message-edited-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                <span>{toPersianDigits(messageSeenCount)}</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
                                    <path
                                        fillRule="evenodd"
                                        clipRule="evenodd"
                                        d="M12 5.5C5.3 5.5 1.5 12 1.5 12s3.8 6.5 10.5 6.5S22.5 12 22.5 12 18.7 5.5 12 5.5Zm0 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                                        fill="currentColor"
                                    />
                                </svg>
                            </span>
                        )}
                        {isMine && (
                            message.deliveryStatus === 'sending'
                                ? <span className="message-pending-indicator" aria-label="در حال ارسال">◷</span>
                                : (
                                    <span className={isSeenForUi ? 'message-seen message-seen--double' : 'message-seen message-seen--single'} aria-label={isSeenForUi ? 'seen' : 'sent'}>
                                        <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--first" />
                                        {isSeenForUi && <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--second" />}
                                    </span>
                                )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}, chatMessageItemPropsEqual);
