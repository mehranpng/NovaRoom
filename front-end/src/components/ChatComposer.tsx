import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { SendIcon } from './SendIcon';
import type { MessageReply, PendingAttachment, PendingForwardDraft } from '../types';
import { pendingUploadedFileByChat } from '../utils/pendingUploads';
import { FileUpload } from './FileUpload';

const MAX_CHAT_MESSAGE_LENGTH = 6000;

export type ChatComposerSendPayload = {
    text: string;
    replyToId?: string;
    editMessageId?: string;
    attachment?: PendingAttachment;
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
    onSend,
    onCancelReplyEdit,
    onCancelForward,
    onTypingChange,
    onRegisterUploadFile,
    onInputFocus,
}: ChatComposerProps) {
    const [text, setText] = useState(() => (editingId ? editDraft : ''));
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
        setAttachment(null);
    };

    return (
        <div className="chat-room__input-area">
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
                                refreshTyping(nextValue);
                            }}
                            onFocus={onInputFocus}
                            onKeyDown={(e) => {
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
