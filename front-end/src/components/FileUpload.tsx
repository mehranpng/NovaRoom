import { useEffect, useRef, useState } from 'react';
import { File as FileIcon, Image, Music2, Paperclip, Video } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FileMetadata } from '../types';
import { API_BASE_URL } from '../config/api';
import { validateFileSize } from '../utils/fileUtils';
import { encryptFileBytesClientSide } from '../utils/e2ee';
import { saveBlobToCache } from '../utils/mediaCache';
import { ImageEditorModal } from './ImageEditorModal';

interface FileUploadProps {
    token: string;
    chatId: string;
    onFileUploaded: (file: FileMetadata) => void;
    fileAttached?: boolean;
    onRegisterUploadFile?: (handler: ((file: File) => void) | null) => void;
    onUploadStateChange?: (payload: { isUploading: boolean; progress: number; fileName: string | null; cancelUpload?: () => void; phase?: 'preview' | 'upload' | 'encrypt' }) => void;
    onEditorStateChange?: (payload: { isEdited: boolean; reEdit: () => void } | null) => void;
}

type UploadTask = {
    status: 'uploading' | 'done' | 'error';
    fileName: string;
    uploadProgress: number;
    encryptionProgress: number;
    result?: FileMetadata;
    delivered?: boolean;
    listeners: Set<(task: UploadTask) => void>;
    phase?: 'preview' | 'upload' | 'encrypt';
};

const uploadTasksByChat = new Map<string, UploadTask>();

export function FileUpload({ token, chatId, onFileUploaded, fileAttached = false, onRegisterUploadFile, onUploadStateChange, onEditorStateChange }: FileUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [pickerMenuOpen, setPickerMenuOpen] = useState(false);
    const [pendingImageForEditor, setPendingImageForEditor] = useState<File | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pickerSessionRef = useRef(false);
    const pickerCloseTimerRef = useRef<number | null>(null);
    const xhrRef = useRef<XMLHttpRequest | null>(null);
    const encryptCancelRef = useRef(false);

    const editorSessionRef = useRef<{
        originalFile: File;
        strokes: any[];
        redoStack: any[];
        cropRect: any;
        isEdited: boolean;
    } | null>(null);

    const onFileUploadedRef = useRef(onFileUploaded);
    const onUploadStateChangeRef = useRef(onUploadStateChange);
    const onRegisterUploadFileRef = useRef(onRegisterUploadFile);
    const onEditorStateChangeRef = useRef(onEditorStateChange);
    const taskHandlerRef = useRef<((task: UploadTask) => void) | null>(null);

    useEffect(() => {
        onFileUploadedRef.current = onFileUploaded;
        onUploadStateChangeRef.current = onUploadStateChange;
        onRegisterUploadFileRef.current = onRegisterUploadFile;
        onEditorStateChangeRef.current = onEditorStateChange;
    });

    useEffect(() => {
        if (!fileAttached) {
            editorSessionRef.current = null;
            onEditorStateChangeRef.current?.(null);
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

    const pushTaskUpdate = (task: UploadTask) => {
        task.listeners.forEach((listener) => listener(task));
        onUploadStateChangeRef.current?.({
            isUploading: task.status === 'uploading',
            progress: getCombinedProgress(task),
            fileName: task.fileName,
            cancelUpload: cancelUpload,
            phase: task.phase || 'upload',
        });
    };

    const getCombinedProgress = (task: Pick<UploadTask, 'status' | 'uploadProgress' | 'encryptionProgress'>) => {
        if (task.status === 'done') return 100;
        const safeUpload = Math.max(0, Math.min(100, task.uploadProgress || 0));
        return safeUpload;
    };

    useEffect(() => {
        const existingTask = uploadTasksByChat.get(chatId);

        const handleTask = (task: UploadTask) => {
            setUploading(task.status === 'uploading');
            onUploadStateChangeRef.current?.({
                isUploading: task.status === 'uploading',
                progress: getCombinedProgress(task),
                fileName: task.fileName,
                cancelUpload,
                phase: task.phase || 'upload',
            });
            if (task.status === 'done' && task.result && !task.delivered) {
                task.delivered = true;
                onFileUploadedRef.current(task.result);
            }
        };

        taskHandlerRef.current = handleTask;

        if (existingTask) {
            existingTask.listeners.add(handleTask);
            handleTask(existingTask);
        } else {
            setUploading(false);
        }

        return () => {
            existingTask?.listeners.delete(handleTask);
            if (taskHandlerRef.current === handleTask) taskHandlerRef.current = null;
        };
    }, [chatId]);

    useEffect(() => {
        if (!fileAttached) return;
        const task = uploadTasksByChat.get(chatId);
        if (task?.status === 'done') {
            uploadTasksByChat.delete(chatId);
            resetUpload();
        }
    }, [chatId, fileAttached]);

    const startUploadFromFile = (file: File | null | undefined) => {
        if (!file) return;

        
        if (!validateFileSize(file.size)) {
            alert('حجم فایل نباید بیشتر از ۲۰ مگابایت باشد');
            onUploadStateChangeRef.current?.({ isUploading: false, progress: 0, fileName: null });
            return;
        }

        setPickerMenuOpen(false);

        // Intercept image files and open ImageEditorModal (for drag&drop, file picker, or paste)
        if (file.type.startsWith('image/')) {
            if (editorSessionRef.current?.originalFile !== file) {
                editorSessionRef.current = {
                    originalFile: file,
                    strokes: [],
                    redoStack: [],
                    cropRect: { x: 0, y: 0, width: 0, height: 0 },
                    isEdited: false,
                };
            }
            setPendingImageForEditor(file);
            return;
        }

        uploadFile(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPickerSession(false);
        const file = e.target.files?.[0];
        startUploadFromFile(file);
        e.currentTarget.value = '';
    };

    useEffect(() => {
        onRegisterUploadFileRef.current?.((file: File) => {
            startUploadFromFile(file);
        });
        return () => {
            onRegisterUploadFileRef.current?.(null);
        };
    }, [chatId]);

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

    const uploadFile = async (file: File) => {
        encryptCancelRef.current = false;
        setUploading(true);
        const task: UploadTask = {
            status: 'uploading',
            fileName: file.name,
            uploadProgress: 0,
            encryptionProgress: 0,
            listeners: new Set(),
            phase: (file.type || '').startsWith('image/') ? 'preview' : 'upload',
        };
        uploadTasksByChat.set(chatId, task);
        if (taskHandlerRef.current) task.listeners.add(taskHandlerRef.current);

        let uploadWarmupTimer: number | null = null;
        try {
            const mediaDuration = await readMediaDuration(file);
            let imagePreviewBlob: Blob | null = null;
            if ((file.type || '').startsWith('image/')) {
                imagePreviewBlob = await createBlurredPreview(file);
            }
            task.phase = 'upload';
            task.uploadProgress = Math.max(task.uploadProgress, 0);
            pushTaskUpdate(task);
            uploadWarmupTimer = window.setInterval(() => {
                task.uploadProgress = Math.min(8, task.uploadProgress + 1);
                pushTaskUpdate(task);
            }, 210);
            const isAudio = (file.type || '').startsWith('audio/');
            const plainBytes = new Uint8Array(await file.arrayBuffer());
            const fileBytes = isAudio ? plainBytes : await encryptFileBytesClientSide(plainBytes, token, chatId);
            if (encryptCancelRef.current) {
                uploadTasksByChat.delete(chatId);
                resetUpload();
                return;
            }
            if (uploadWarmupTimer != null) {
                window.clearInterval(uploadWarmupTimer);
                uploadWarmupTimer = null;
            }
            const uploadBlob = new Blob([fileBytes as BlobPart], { type: isAudio ? (file.type || 'audio/mpeg') : 'application/octet-stream' });
            const uploadFile = new window.File([uploadBlob], file.name, {
                type: isAudio ? (file.type || 'audio/mpeg') : 'application/octet-stream',
                lastModified: file.lastModified,
            });

            const formData = new FormData();
            formData.append('file', uploadFile);
            if (mediaDuration > 0) formData.append('duration', String(mediaDuration));
            if (imagePreviewBlob) {
                formData.append('preview', new window.File([imagePreviewBlob], `preview-${file.name}.jpg`, { type: 'image/jpeg' }));
            }

            const xhr = new XMLHttpRequest();
            xhrRef.current = xhr;
            task.phase = 'upload';

            let lastReportTime = 0;
            let lastProgress = -1;
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    const now = performance.now();
                    if (progress === 100 || progress >= lastProgress + 2 || now - lastReportTime > 120) {
                        lastProgress = progress;
                        lastReportTime = now;
                        task.uploadProgress = Math.max(task.uploadProgress, progress);
                        pushTaskUpdate(task);
                    }
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success && response.file) {
                        const result: FileMetadata = {
                            ...response.file,
                            fileName: file.name,
                            fileSize: file.size,
                            mimeType: file.type || response.file.mimeType,
                        };
                        window.setTimeout(() => {
                            void saveBlobToCache(`chat:${chatId}:file:${result.fileId}`, file);
                        }, 100);
                        task.uploadProgress = 100;
                        task.phase = 'encrypt';
                        pushTaskUpdate(task);
                        window.setTimeout(() => {
                            task.status = 'done';
                            task.encryptionProgress = 100;
                            task.result = result;
                            pushTaskUpdate(task);
                        }, 1200);
                    } else {
                        console.error('Invalid upload response:', response);
                        alert('خطا در آپلود فایل');
                        task.status = 'error';
                        pushTaskUpdate(task);
                        uploadTasksByChat.delete(chatId);
                        resetUpload();
                    }
                } else {
                    console.error(`Upload failed: ${xhr.status}`, xhr.responseText);
                    alert('خطا در آپلود فایل');
                    task.status = 'error';
                    pushTaskUpdate(task);
                    uploadTasksByChat.delete(chatId);
                    resetUpload();
                }
            });

            
            xhr.addEventListener('error', () => {
                console.error('Upload error');
                alert('خطا در آپلود فایل');
                task.status = 'error';
                pushTaskUpdate(task);
                uploadTasksByChat.delete(chatId);
                resetUpload();
            });

            
            xhr.addEventListener('abort', () => {
                console.log('Upload cancelled');
                task.status = 'error';
                pushTaskUpdate(task);
                uploadTasksByChat.delete(chatId);
                resetUpload();
            });

            
            xhr.open('POST', `${API_BASE_URL}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);

        } catch (error) {
            if (uploadWarmupTimer != null) {
                window.clearInterval(uploadWarmupTimer);
            }
            console.error('Upload error:', error);
            alert('خطا در آپلود فایل');
            uploadTasksByChat.delete(chatId);
            resetUpload();
        }
    };

    const resetUpload = () => {
        xhrRef.current = null;
        encryptCancelRef.current = false;
        setUploading(false);
        onUploadStateChangeRef.current?.({ isUploading: false, progress: 0, fileName: null });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        if (imageInputRef.current) {
            imageInputRef.current.value = '';
        }
        if (videoInputRef.current) {
            videoInputRef.current.value = '';
        }
        if (audioInputRef.current) {
            audioInputRef.current.value = '';
        }
    };

    const cancelUpload = () => {
        encryptCancelRef.current = true;
        const xhr = xhrRef.current;
        if (xhr && xhr.readyState !== XMLHttpRequest.DONE) {
            xhr.abort();
            return;
        }
        uploadTasksByChat.delete(chatId);
        resetUpload();
    };

    useEffect(() => {
        return () => {
            onUploadStateChangeRef.current?.({ isUploading: false, progress: 0, fileName: null });
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
                disabled={uploading}
            />

            <input
                id="file-upload-video"
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />
            <input
                id="file-upload-audio"
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />

            <input
                id="file-upload-generic"
                ref={fileInputRef}
                type="file"
                accept="*/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />

            <button
                onClick={() => {
                    if (uploading) return;
                    setPickerMenuOpen((v) => !v);
                }}
                className="file-upload-button"
                title={uploading ? 'در حال آپلود...' : 'ارسال فایل'}
                disabled={uploading}
                type="button"
            >
                <Paperclip size={20} />
            </button>

            <AnimatePresence>
                {pickerMenuOpen && !uploading && (
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
                    imageFile={editorSessionRef.current?.originalFile || pendingImageForEditor}
                    initialStrokes={editorSessionRef.current?.strokes}
                    initialRedoStack={editorSessionRef.current?.redoStack}
                    initialCropRect={editorSessionRef.current?.cropRect}
                    onSend={(fileToSend, isEdited, editorState) => {
                        setPendingImageForEditor(null);
                        if (editorSessionRef.current) {
                            editorSessionRef.current.strokes = editorState.strokes;
                            editorSessionRef.current.redoStack = editorState.redoStack;
                            editorSessionRef.current.cropRect = editorState.cropRect;
                            editorSessionRef.current.isEdited = isEdited;
                        }
                        onEditorStateChangeRef.current?.({
                            isEdited,
                            reEdit: () => {
                                if (editorSessionRef.current) {
                                    setPendingImageForEditor(editorSessionRef.current.originalFile);
                                }
                            },
                        });
                        uploadFile(fileToSend);
                    }}
                    onCancel={() => {
                        setPendingImageForEditor(null);
                        if (!fileAttached) {
                            resetUpload();
                        }
                    }}
                />
            )}
        </>
    );
}

async function readMediaDuration(file: File): Promise<number> {
    if (!(file.type.startsWith('audio/') || file.type.startsWith('video/'))) return 0;
    try {
        const objectUrl = URL.createObjectURL(file);
        const duration = await new Promise<number>((resolve) => {
            const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
            media.preload = 'metadata';
            const cleanup = () => {
                URL.revokeObjectURL(objectUrl);
            };
            const timer = window.setTimeout(() => {
                cleanup();
                resolve(0);
            }, 1500);
            media.onloadedmetadata = () => {
                window.clearTimeout(timer);
                cleanup();
                resolve(Number.isFinite(media.duration) ? media.duration : 0);
            };
            media.onerror = () => {
                window.clearTimeout(timer);
                cleanup();
                resolve(0);
            };
            media.src = objectUrl;
        });
        return duration;
    } catch {
        return 0;
    }
}

async function createBlurredPreview(file: File): Promise<Blob | null> {
    try {
        const bitmap = await createImageBitmap(file);
        const maxWidth = 480;
        const minAspect = 0.62; 
        const maxAspect = 1.8;
        const srcAspect = bitmap.width / bitmap.height;
        const targetAspect = Math.min(maxAspect, Math.max(minAspect, srcAspect));
        let cropW = bitmap.width;
        let cropH = bitmap.height;
        if (srcAspect > targetAspect) cropW = Math.round(bitmap.height * targetAspect);
        else if (srcAspect < targetAspect) cropH = Math.round(bitmap.width / targetAspect);
        const cropX = Math.max(0, Math.floor((bitmap.width - cropW) / 2));
        const cropY = Math.max(0, Math.floor((bitmap.height - cropH) / 2));
        const ratio = Math.min(1, maxWidth / cropW);
        const width = Math.max(1, Math.round(cropW * ratio));
        const height = Math.max(1, Math.round(cropH * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.filter = 'blur(8px)';
        ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, width, height);
        return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
    } catch {
        return null;
    }
}
