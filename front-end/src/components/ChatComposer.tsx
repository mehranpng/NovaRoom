import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { SendIcon } from './SendIcon';
import type { MessageReply, PendingAttachment, PendingForwardDraft } from '../types';
import { pendingUploadedFileByChat } from '../utils/pendingUploads';
import { FileUpload } from './FileUpload';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { resolveVerified } from '../utils/format';

const MAX_CHAT_MESSAGE_LENGTH = 6000;

export type ChatComposerSendPayload = {
    text: string;
    replyToId?: string;
    editMessageId?: string;
    attachment?: PendingAttachment;
};

export type MentionCandidate = {
    chatId: string;
    name: string;
    username: string;
    avatar: string;
    verified?: boolean;
};

type ChatComposerProps = {
    chatId: string;
    isContactBlocked: boolean;
    canSend: boolean;
    blockedMessage: string;
    replyTo: MessageReply | null;
    editingId: string | null;
    editDraft: string;
    replyPreviewText: string;
    pendingForwardDraft: PendingForwardDraft | null;
    forwardPreviewText: string;
    forwardPreviewTitle: string;
    uploadFile: ((file: File) => void) | null;
    mentionCandidates?: MentionCandidate[];
    onSend: (payload: ChatComposerSendPayload) => boolean;
    onCancelReplyEdit: () => void;
    onCancelForward: () => void;
    onTypingChange?: (chatId: string, isTyping: boolean) => void;
    onRegisterUploadFile: (handler: ((file: File) => void) | null) => void;
    onInputFocus: () => void;
};

function isMobileKeyboardInput() {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    return Boolean(coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(ua));
}

function findActiveMentionQuery(text: string, caretIndex: number): { start: number; end: number; query: string } | null {
    const safeCaret = Math.max(0, Math.min(caretIndex, text.length));
    const beforeCaret = text.slice(0, safeCaret);
    const atIndex = beforeCaret.lastIndexOf('@');
    if (atIndex === -1) return null;
    if (atIndex > 0 && /[A-Za-z0-9_]/.test(beforeCaret[atIndex - 1])) return null;
    const query = beforeCaret.slice(atIndex + 1);
    if (/\s/.test(query)) return null;
    return { start: atIndex, end: safeCaret, query };
}

export const ChatComposer = memo(function ChatComposer({
    chatId,
    isContactBlocked,
    canSend,
    blockedMessage,
    replyTo,
    editingId,
    editDraft,
    replyPreviewText,
    pendingForwardDraft,
    forwardPreviewText,
    forwardPreviewTitle,
    uploadFile,
    mentionCandidates = [],
    onSend,
    onCancelReplyEdit,
    onCancelForward,
    onTypingChange,
    onRegisterUploadFile,
    onInputFocus,
}: ChatComposerProps) {
    const [text, setText] = useState(() => (editingId ? editDraft : ''));
    const [caretPos, setCaretPos] = useState(0);
    const [activeMentionIndex, setActiveMentionIndex] = useState(-1);
    const [attachment, setAttachment] = useState<PendingAttachment | null>(() => pendingUploadedFileByChat[chatId] ?? null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const typingTimeoutRef = useRef<number | null>(null);
    const typingActiveRef = useRef(false);
    const lastSubmitTimeRef = useRef(0);

    const clearTypingTimeout = () => {
        if (typingTimeoutRef.current) {
            window.clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
        }
    };

    const emitTyping = (isTyping: boolean) => {
        if (isContactBlocked && isTyping) return;
        if (!onTypingChange) return;
        onTypingChange(chatId, isTyping);
    };

    const stopTyping = () => {
        clearTypingTimeout();
        if (!typingActiveRef.current) return;
        typingActiveRef.current = false;
        emitTyping(false);
    };

    const refreshTyping = (nextValue: string) => {
        if (!onTypingChange) return;
        if (!nextValue.length) {
            stopTyping();
            return;
        }
        if (!typingActiveRef.current) {
            typingActiveRef.current = true;
            emitTyping(true);
        }
        clearTypingTimeout();
        typingTimeoutRef.current = window.setTimeout(() => {
            typingActiveRef.current = false;
            emitTyping(false);
            typingTimeoutRef.current = null;
        }, 1000);
    };

    useEffect(() => {
        return () => {
            if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
            if (onTypingChange && typingActiveRef.current) onTypingChange(chatId, false);
        };
    }, [chatId, onTypingChange]);

    useEffect(() => {
        if (!editingId) return;
        const raf = requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const end = textarea.value.length;
            textarea.focus();
            textarea.setSelectionRange(end, end);
        });
        return () => cancelAnimationFrame(raf);
    }, [editingId]);

    useEffect(() => {
        if (!replyTo) return;
        const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [replyTo]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        if (!text) {
            if (textarea.style.height !== '44px') textarea.style.height = '44px';
            return;
        }
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    }, [text]);

    const mentionMatch = useMemo(() => {
        if (!mentionCandidates.length || isContactBlocked || !canSend) return null;
        return findActiveMentionQuery(text, caretPos);
    }, [mentionCandidates.length, isContactBlocked, canSend, text, caretPos]);

    const filteredMentions = useMemo(() => {
        if (!mentionMatch || !mentionCandidates.length) return [];
        const q = mentionMatch.query.trim().toLowerCase();
        if (!q) return mentionCandidates;
        return mentionCandidates
            .filter((member) => {
                const uname = member.username.toLowerCase();
                const name = member.name.toLowerCase();
                if (uname.startsWith(q)) return true;
                if (name.startsWith(q)) return true;
                return name.split(/\s+/).some((part) => part.startsWith(q));
            })
            .sort((a, b) => {
                const aStartsUname = a.username.toLowerCase().startsWith(q) ? 0 : 1;
                const bStartsUname = b.username.toLowerCase().startsWith(q) ? 0 : 1;
                if (aStartsUname !== bStartsUname) return aStartsUname - bStartsUname;
                return a.username.localeCompare(b.username);
            });
    }, [mentionMatch, mentionCandidates]);

    useEffect(() => {
        setActiveMentionIndex(-1);
    }, [mentionMatch?.query, mentionMatch?.start]);

    const selectMentionCandidate = (member: MentionCandidate) => {
        if (!mentionMatch) return;
        const insertion = `@${member.username} `;
        const before = text.slice(0, mentionMatch.start);
        const after = text.slice(mentionMatch.end);
        const nextText = `${before}${insertion}${after.startsWith(' ') ? after.slice(1) : after}`;
        const nextCaret = before.length + insertion.length;
        setText(nextText);
        setCaretPos(nextCaret);
        refreshTyping(nextText);
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(nextCaret, nextCaret);
        });
    };

    const displayedAttachment = attachment ?? pendingUploadedFileByChat[chatId] ?? null;

    const handleFileSelected = useCallback((next: PendingAttachment) => {
        pendingUploadedFileByChat[chatId] = next;
        setAttachment(next);
    }, [chatId]);

    const clearAttachment = useCallback(() => {
        pendingUploadedFileByChat[chatId] = null;
        setAttachment(null);
    }, [chatId]);

    const submit = () => {
        const now = Date.now();
        if (now - lastSubmitTimeRef.current < 300) return;
        lastSubmitTimeRef.current = now;

        if (isContactBlocked || !canSend) return;
        const rawText = text;
        if (rawText.length > MAX_CHAT_MESSAGE_LENGTH) {
            alert(`حداکثر طول پیام ${MAX_CHAT_MESSAGE_LENGTH} کاراکتر است`);
            return;
        }
        const hasForward = Boolean(pendingForwardDraft && !editingId);
        if (!rawText.trim() && !displayedAttachment && !hasForward) return;
        const accepted = onSend({
            text: rawText || '',
            replyToId: replyTo?.id,
            editMessageId: editingId ?? undefined,
            attachment: displayedAttachment ?? undefined,
        });
        if (!accepted) return;

        stopTyping();
        pendingUploadedFileByChat[chatId] = null;
        setText('');
        setCaretPos(0);
        setAttachment(null);
    };

    return (
        <div className="chat-room__input-area">
            {filteredMentions.length > 0 && (
                <div
                    className="chat-room__mention-picker"
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <div className="chat-room__mention-picker-list">
                        {filteredMentions.map((member, idx) => (
                            <button
                                key={member.chatId}
                                type="button"
                                className={
                                    idx === activeMentionIndex
                                        ? 'chat-room__mention-item chat-room__mention-item--active'
                                        : 'chat-room__mention-item'
                                }
                                onClick={() => selectMentionCandidate(member)}
                            >
                                <Avatar name={member.name || member.username} src={member.avatar} size="xs" />
                                <div className="chat-room__mention-item-info">
                                    <div className="chat-room__mention-item-name-row">
                                        <span className="chat-room__mention-item-name emoji-font">
                                            {member.name || member.username}
                                        </span>
                                        {resolveVerified(member.verified) && <VerifiedBadge size={13} />}
                                    </div>
                                    <span className="chat-room__mention-item-username" dir="ltr">
                                        @{member.username}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {(replyTo || editingId) && (
                <div className="chat-room__reply-edit-box">
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>
                        <div className="chat-room__reply-edit-box__title">{editingId ? 'در حال ویرایش' : 'در حال پاسخ'}</div>
                        {!editingId && replyTo && <div className="chat-room__reply-edit-box__text">{replyPreviewText}</div>}
                    </div>
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Cancel"
                        onClick={() => {
                            if (editingId) {
                                setText('');
                                stopTyping();
                            }
                            onCancelReplyEdit();
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>
            )}
            {displayedAttachment && (
                <div className="chat-room__reply-edit-box">
                    {displayedAttachment.reEdit && (
                        <button
                            type="button"
                            className="chat-room__re-edit-btn"
                            onClick={displayedAttachment.reEdit}
                            title="ویرایش مجدد تصویر"
                        >
                            <Pencil size={17} />
                        </button>
                    )}
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>
                        <div className="chat-room__reply-edit-box__title">
                            <span>{displayedAttachment.isEdited ? 'تصویر ویرایش شده' : 'فایل انتخاب شده'}</span>
                        </div>
                        <div className="chat-room__reply-edit-box__text">{displayedAttachment.file.name}</div>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Remove file" onClick={clearAttachment}><X size={18} /></button>
                </div>
            )}
            {pendingForwardDraft && (
                <div className="chat-room__reply-edit-box">
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>
                        <div className="chat-room__reply-edit-box__title">{forwardPreviewTitle}</div>
                        <div className="chat-room__reply-edit-box__text">{forwardPreviewText}</div>
                    </div>
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Cancel forward"
                        onClick={onCancelForward}
                    >
                        <X size={18} />
                    </button>
                </div>
            )}
            <div className="chat-room__input-wrapper">
                {isContactBlocked ? (
                    <div className="chat-room__blocked-box">
                        {blockedMessage}
                    </div>
                ) : !canSend ? (
                    <div className="chat-room__blocked-box" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)', background: 'var(--bg-secondary)' }}>
                        فقط کاربران تاییدشده می‌توانند در این کانال پیام ارسال کنند.
                    </div>
                ) : (
                    <>
                        <FileUpload
                            onFileSelected={handleFileSelected}
                            fileAttached={Boolean(displayedAttachment)}
                            onRegisterUploadFile={onRegisterUploadFile}
                        />
                        <textarea ref={textareaRef} className="chat-room__text-input" placeholder="پیام..."
                            wrap="soft"
                            value={text}
                            onChange={(e) => {
                                const nextValue = e.target.value;
                                setText(nextValue);
                                setCaretPos(e.target.selectionStart ?? nextValue.length);
                                refreshTyping(nextValue);
                            }}
                            onFocus={onInputFocus}
                            onClick={(e) => {
                                setCaretPos(e.currentTarget.selectionStart ?? text.length);
                            }}
                            onKeyUp={(e) => {
                                if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab') return;
                                setCaretPos(e.currentTarget.selectionStart ?? text.length);
                            }}
                            onKeyDown={(e) => {
                                if (filteredMentions.length > 0) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setActiveMentionIndex((prev) => (prev < 0 ? 0 : (prev + 1) % filteredMentions.length));
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setActiveMentionIndex((prev) => (prev < 0 ? filteredMentions.length - 1 : (prev - 1 + filteredMentions.length) % filteredMentions.length));
                                        return;
                                    }
                                    if ((e.key === 'Enter' && !e.shiftKey && !isMobileKeyboardInput()) || e.key === 'Tab') {
                                        e.preventDefault();
                                        const target = activeMentionIndex >= 0 ? filteredMentions[activeMentionIndex] : filteredMentions[0];
                                        if (target) selectMentionCandidate(target);
                                        return;
                                    }
                                }
                                if (e.key === 'Enter' && !e.shiftKey && !isMobileKeyboardInput()) {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                            onPaste={(e) => {
                                if (isContactBlocked || !canSend) return;
                                const items = Array.from(e.clipboardData?.items || []);
                                const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
                                const pastedFile = imageItem?.getAsFile();
                                if (pastedFile && uploadFile) {
                                    e.preventDefault();
                                    uploadFile(pastedFile);
                                }
                            }}
                            rows={1}
                        />
                        <button
                            className={text.trim() || displayedAttachment || (pendingForwardDraft && !editingId) ? 'chat-room__send-btn chat-room__send-btn--active' : 'chat-room__send-btn chat-room__send-btn--disabled'}
                            onClick={submit} disabled={!text.trim() && !displayedAttachment && (!pendingForwardDraft || Boolean(editingId))} aria-label="Send" type="button">
                            <SendIcon size={19} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
});
