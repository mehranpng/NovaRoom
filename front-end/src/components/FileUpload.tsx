import { useEffect, useRef, useState } from 'react';
import { File as FileIcon, Image, Music2, Paperclip, Video } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PendingAttachment } from '../types';
import { validateFileSize } from '../utils/fileUtils';
import { readMediaInfo } from '../utils/chatFileUploader';
import { ImageEditorModal } from './ImageEditorModal';

interface FileUploadProps {
    onFileSelected: (attachment: PendingAttachment) => void;
    fileAttached?: boolean;
    onRegisterUploadFile?: (handler: ((file: File) => void) | null) => void;
}

export function FileUpload({ onFileSelected, fileAttached = false, onRegisterUploadFile }: FileUploadProps) {
    const [pickerMenuOpen, setPickerMenuOpen] = useState(false);
    const [pendingImageForEditor, setPendingImageForEditor] = useState<File | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pickerSessionRef = useRef(false);
    const pickerCloseTimerRef = useRef<number | null>(null);

    const editorSessionRef = useRef<{
        originalFile: File;
        strokes: any[];
        cropRect: any;
        undoHistory: any[];
        redoHistory: any[];
        isEdited: boolean;
    } | null>(null);
    const editorMountKeyRef = useRef(0);

    const onFileSelectedRef = useRef(onFileSelected);
    const onRegisterUploadFileRef = useRef(onRegisterUploadFile);

    useEffect(() => {
        onFileSelectedRef.current = onFileSelected;
        onRegisterUploadFileRef.current = onRegisterUploadFile;
    });

    useEffect(() => {
        if (!fileAttached) {
            editorSessionRef.current = null;
        }
    }, [fileAttached]);

    const clearPickerCloseTimer = () => {
        if (pickerCloseTimerRef.current != null) {
            window.clearTimeout(pickerCloseTimerRef.current);
            pickerCloseTimerRef.current = null;
        }
    };

    const setPickerSession = (active: boolean) => {
        pickerSessionRef.current = active;
        if (!active) clearPickerCloseTimer();
    };

    const emitAttachment = async (file: File, isEdited: boolean, fromEditor: boolean) => {
        const { width, height, duration } = await readMediaInfo(file);
        onFileSelectedRef.current({
            file,
            width,
            height,
            duration,
            isEdited,
            reEdit: fromEditor
                ? () => {
                    if (editorSessionRef.current) setPendingImageForEditor(editorSessionRef.current.originalFile);
                }
                : undefined,
        });
    };

    const selectFile = async (file: File | null | undefined) => {
        if (!file) return;

        if (!validateFileSize(file.size)) {
            alert('حجم فایل نباید بیشتر از ۲۰ مگابایت باشد');
            return;
        }

        setPickerMenuOpen(false);

        if (file.type.startsWith('image/')) {
            if (editorSessionRef.current?.originalFile !== file) {
                editorMountKeyRef.current += 1;
                editorSessionRef.current = {
                    originalFile: file,
                    strokes: [],
                    cropRect: { x: 0, y: 0, width: 0, height: 0 },
                    undoHistory: [],
                    redoHistory: [],
                    isEdited: false,
                };
            }
            setPendingImageForEditor(file);
            return;
        }

        await emitAttachment(file, false, false);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPickerSession(false);
        const file = e.target.files?.[0];
        void selectFile(file);
        e.currentTarget.value = '';
    };

    useEffect(() => {
        onRegisterUploadFileRef.current?.((file: File) => {
            void selectFile(file);
        });
        return () => {
            onRegisterUploadFileRef.current?.(null);
        };
    }, []);

    useEffect(() => {
        if (!pickerMenuOpen) return;

        const closeMenu = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) {
                setPickerMenuOpen(false);
            }
        };

        const onEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPickerMenuOpen(false);
        };

        document.addEventListener('mousedown', closeMenu);
        document.addEventListener('keydown', onEscape);

        return () => {
            document.removeEventListener('mousedown', closeMenu);
            document.removeEventListener('keydown', onEscape);
        };
    }, [pickerMenuOpen]);

    useEffect(() => {
        const onFocus = () => {
            if (!pickerSessionRef.current) return;
            clearPickerCloseTimer();
            pickerCloseTimerRef.current = window.setTimeout(() => {
                const hasPickedFile = Boolean(
                    imageInputRef.current?.files?.length
                    || videoInputRef.current?.files?.length
                    || audioInputRef.current?.files?.length
                    || fileInputRef.current?.files?.length
                );
                if (!hasPickedFile) {
                    setPickerSession(false);
                }
            }, 220);
        };

        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!pickerSessionRef.current) return;
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            clearPickerCloseTimer();
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    }, []);

    return (
        <>
            <div className="file-upload-container">
            <input
                id="file-upload-image"
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
            />

            <input
                id="file-upload-video"
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
            />
            <input
                id="file-upload-audio"
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
            />

            <input
                id="file-upload-generic"
                ref={fileInputRef}
                type="file"
                accept="*/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
            />

            <button
                onClick={() => {
                    setPickerMenuOpen((v) => !v);
                }}
                className="file-upload-button"
                title="ارسال فایل"
                type="button"
            >
                <Paperclip size={20} />
            </button>

            <AnimatePresence>
                {pickerMenuOpen && (
                    <motion.div
                        ref={menuRef}
                        className="file-upload-picker-menu"
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.97 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                    >
                        <motion.label htmlFor="file-upload-image" className="file-upload-picker-item" 
                            onClick={() => { setPickerSession(true); setPickerMenuOpen(false); }}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Image size={16} />تصویر</span>
                        </motion.label>
                        <motion.label htmlFor="file-upload-video" className="file-upload-picker-item" 
                            onClick={() => { setPickerSession(true); setPickerMenuOpen(false); }}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Video size={16} />ویدیو</span>
                        </motion.label>
                        <motion.label htmlFor="file-upload-audio" className="file-upload-picker-item" 
                            onClick={() => { setPickerSession(true); setPickerMenuOpen(false); }}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Music2 size={16} />آهنگ</span>
                        </motion.label>
                        <motion.label htmlFor="file-upload-generic" className="file-upload-picker-item" 
                            onClick={() => { setPickerSession(true); setPickerMenuOpen(false); }}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><FileIcon size={16} />فایل</span>
                        </motion.label>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>

            {pendingImageForEditor && (
                <ImageEditorModal
                    key={editorMountKeyRef.current}
                    imageFile={editorSessionRef.current?.originalFile || pendingImageForEditor}
                    initialStrokes={editorSessionRef.current?.strokes}
                    initialCropRect={editorSessionRef.current?.cropRect}
                    initialUndoHistory={editorSessionRef.current?.undoHistory}
                    initialRedoHistory={editorSessionRef.current?.redoHistory}
                    onSend={(fileToSend, isEdited, editorState) => {
                        setPendingImageForEditor(null);
                        if (editorSessionRef.current) {
                            editorSessionRef.current.strokes = editorState.strokes;
                            editorSessionRef.current.cropRect = editorState.cropRect;
                            editorSessionRef.current.undoHistory = editorState.undoHistory;
                            editorSessionRef.current.redoHistory = editorState.redoHistory;
                            editorSessionRef.current.isEdited = isEdited;
                        }
                        void emitAttachment(fileToSend, isEdited, true);
                    }}
                    onCancel={() => {
                        setPendingImageForEditor(null);
                        if (!fileAttached) {
                            editorSessionRef.current = null;
                        }
                    }}
                />
            )}
        </>
    );
}
