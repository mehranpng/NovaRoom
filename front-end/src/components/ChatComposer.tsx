import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, SendHorizontal, X } from 'lucide-react';
import type { FileMetadata, MessageReply, PendingForwardDraft } from '../types';
import { apiFetch } from '../config/api';
import { pendingUploadedFileByChat } from '../utils/pendingUploads';
import { FileUpload } from './FileUpload';

const MAX_CHAT_MESSAGE_LENGTH = 6000;

type UploadComposerState = {
    isUploading: boolean;
    progress: number;
    fileName: string | null;
    phase: 'preview' | 'upload' | 'encrypt';
};

export type ChatComposerSendPayload = {
    text: string;
    replyToId?: string;
    editMessageId?: string;
    file?: FileMetadata;
};

type ChatComposerProps = {
    chatId: string;
    token: string;
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
    onUploadStatusChange?: (chatId: string, isUploading: boolean) => void;
    onRegisterUploadFile: (handler: ((file: File) => void) | null) => void;
    onInputFocus: () => void;
};

const EMPTY_UPLOAD_STATE: UploadComposerState = {
    isUploading: false,
    progress: 0,
    fileName: null,
    phase: 'upload',
};

function isMobileKeyboardInput() {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    return Boolean(coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(ua));
}

export const ChatComposer = memo(function ChatComposer({
    chatId,
    token,
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
    onUploadStatusChange,
    onRegisterUploadFile,
    onInputFocus,
}: ChatComposerProps) {
    const [text, setText] = useState(() => (editingId ? editDraft : ''));
    const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(() => pendingUploadedFileByChat[chatId] ?? null);
    const [uploadComposerState, setUploadComposerState] = useState<UploadComposerState>(EMPTY_UPLOAD_STATE);
    const [editorAttachmentState, setEditorAttachmentState] = useState<{ isEdited: boolean; reEdit: () => void } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const uploadCancelRef = useRef<(() => void) | null>(null);
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
        if (!onUploadStatusChange) return;
        onUploadStatusChange(chatId, uploadComposerState.isUploading);
        return () => {
            onUploadStatusChange(chatId, false);
        };
    }, [chatId, onUploadStatusChange, uploadComposerState.isUploading]);

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

    const displayedUploadedFile = uploadedFile ?? pendingUploadedFileByChat[chatId] ?? null;

    const handleFileUploaded = useCallback((file: FileMetadata) => {
        pendingUploadedFileByChat[chatId] = file;
        setUploadedFile(file);
    }, [chatId]);

    const handleUploadStateChange = useCallback(({ isUploading, progress, fileName, cancelUpload, phase }: { isUploading: boolean; progress: number; fileName: string | null; cancelUpload?: () => void; phase?: 'preview' | 'upload' | 'encrypt' }) => {
        setUploadComposerState((prev) => {
            const nextPhase = phase || 'upload';
            if (prev.isUploading === isUploading && prev.progress === progress && prev.fileName === fileName && prev.phase === nextPhase) {
                return prev;
            }
            return { isUploading, progress, fileName, phase: nextPhase };
        });
        uploadCancelRef.current = cancelUpload ?? null;
    }, []);

    const cleanupUploadedFile = async (file: FileMetadata | null) => {
        if (!file?.fileId) return;
        try {
            await apiFetch(`/files/${encodeURIComponent(file.fileId)}`, { method: 'DELETE' });
            if (file.previewFileId) {
                await apiFetch(`/files/${encodeURIComponent(file.previewFileId)}`, { method: 'DELETE' });
            }
        } catch {
            return;
        }
    };

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
        if (!rawText.trim() && !displayedUploadedFile && !hasForward) return;
        const accepted = onSend({
            text: rawText || '',
            replyToId: replyTo?.id,
            editMessageId: editingId ?? undefined,
            file: displayedUploadedFile ?? undefined,
        });
        if (!accepted) return;

        stopTyping();
        pendingUploadedFileByChat[chatId] = null;
        setText('');
        setUploadedFile(null);
        setEditorAttachmentState(null);
    };

    return (
        <div className="chat-room__input-area">
            {uploadComposerState.isUploading && (
                <div className="chat-room__upload-progress-box">
                    <div
                        className={`chat-room__upload-progress-track ${uploadComposerState.phase === 'preview' || uploadComposerState.phase === 'encrypt' ? 'chat-room__upload-progress-track--indeterminate' : ''}`}
                        role="progressbar"
                        aria-label={uploadComposerState.phase === 'encrypt' ? 'در حال رمزنگاری فایل' : `Uploading ${uploadComposerState.progress}%`}
                        aria-valuemin={uploadComposerState.phase === 'upload' ? 0 : undefined}
                        aria-valuemax={uploadComposerState.phase === 'upload' ? 100 : undefined}
                        aria-valuenow={uploadComposerState.phase === 'upload' ? uploadComposerState.progress : undefined}
                    >
                        <div
                            className={`chat-room__upload-progress-fill ${uploadComposerState.phase === 'preview' || uploadComposerState.phase === 'encrypt' ? 'chat-room__upload-progress-fill--indeterminate' : ''}`}
                            style={{ width: uploadComposerState.phase === 'upload' ? `${uploadComposerState.progress}%` : undefined }}
                        />
                    </div>
                    <button
                        type="button"
                        className="chat-room__upload-progress-cancel"
                        aria-label="Cancel upload"
                        onClick={() => uploadCancelRef.current?.()}
                    >
                        <X size={18} />
                    </button>
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
            {displayedUploadedFile && (
                <div className="chat-room__reply-edit-box">
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>
                        <div className="chat-room__reply-edit-box__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{editorAttachmentState?.isEdited ? 'فایل ویرایش شده' : 'فایل آپلود شده'}</span>
                            {editorAttachmentState?.reEdit && (
                                <button
                                    type="button"
                                    className="chat-room__re-edit-btn"
                                    onClick={editorAttachmentState.reEdit}
                                    title="ویرایش مجدد تصویر"
                                >
                                    <Pencil size={13} />
                                </button>
                            )}
                        </div>
                        <div className="chat-room__reply-edit-box__text">{displayedUploadedFile.fileName}</div>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => {
                        if (displayedUploadedFile) void cleanupUploadedFile(displayedUploadedFile);
                        pendingUploadedFileByChat[chatId] = null;
                        setUploadedFile(null);
                        setEditorAttachmentState(null);
                    }}><X size={18} /></button>
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
                            token={token}
                            chatId={chatId}
                            onFileUploaded={handleFileUploaded}
                            fileAttached={Boolean(displayedUploadedFile)}
                            onUploadStateChange={handleUploadStateChange}
                            onRegisterUploadFile={onRegisterUploadFile}
                            onEditorStateChange={setEditorAttachmentState}
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
                            className={text.trim() || displayedUploadedFile || (pendingForwardDraft && !editingId) ? 'chat-room__send-btn chat-room__send-btn--active' : 'chat-room__send-btn chat-room__send-btn--disabled'}
                            onClick={submit} disabled={!text.trim() && !displayedUploadedFile && (!pendingForwardDraft || Boolean(editingId))} aria-label="Send" type="button">
                            <SendHorizontal size={18} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
});
