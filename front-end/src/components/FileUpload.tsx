import { useEffect, useRef, useState } from 'react';
import { File as FileIcon, Image, Music2, Paperclip, Video } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FileMetadata } from '../types';
import { API_BASE_URL } from '../config/api';
import { validateFileSize } from '../utils/fileUtils';
import { encryptFileBytesClientSide } from '../utils/e2ee';
import { saveBlobToCache } from '../utils/mediaCache';

interface FileUploadProps {
    token: string;
    chatId: string;
    onFileUploaded: (file: FileMetadata) => void;
    fileAttached?: boolean;
    onRegisterUploadFile?: (handler: ((file: File) => void) | null) => void;
    onUploadStateChange?: (payload: { isUploading: boolean; progress: number; fileName: string | null; cancelUpload?: () => void }) => void;
}

type UploadTask = {
    status: 'uploading' | 'done' | 'error';
    fileName: string;
    uploadProgress: number;
    encryptionProgress: number;
    result?: FileMetadata;
    delivered?: boolean;
    listeners: Set<(task: UploadTask) => void>;
};

const uploadTasksByChat = new Map<string, UploadTask>();

export function FileUpload({ token, chatId, onFileUploaded, fileAttached = false, onRegisterUploadFile, onUploadStateChange }: FileUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [pickerMenuOpen, setPickerMenuOpen] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pickerSessionRef = useRef(false);
    const pickerCloseTimerRef = useRef<number | null>(null);
    const xhrRef = useRef<XMLHttpRequest | null>(null);
    const encryptCancelRef = useRef(false);

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

    const triggerNativeFilePicker = (input: HTMLInputElement) => {
        const picker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
        if (typeof picker === 'function') {
            picker.call(input);
            return;
        }
        input.click();
    };

    const openPicker = (inputRef: React.RefObject<HTMLInputElement | null>) => (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (uploading) return;

        const input = inputRef.current;
        if (!input) return;

        setPickerSession(true);
        triggerNativeFilePicker(input);
        window.setTimeout(() => setPickerMenuOpen(false), 0);
    };

    const pushTaskUpdate = (task: UploadTask) => {
        task.listeners.forEach((listener) => listener(task));
        onUploadStateChange?.({
            isUploading: task.status === 'uploading',
            progress: getCombinedProgress(task),
            fileName: task.fileName,
            cancelUpload: cancelUpload,
        });
    };

    const getCombinedProgress = (task: Pick<UploadTask, 'status' | 'uploadProgress' | 'encryptionProgress'>) => {
        if (task.status === 'done') return 100;
        const safeUpload = Math.max(0, Math.min(100, task.uploadProgress || 0));
        const safeEncryption = Math.max(0, Math.min(100, task.encryptionProgress || 0));
        return Math.round((safeEncryption * 0.5) + (safeUpload * 0.5));
    };

    useEffect(() => {
        const existingTask = uploadTasksByChat.get(chatId);
        if (!existingTask) {
            setUploading(false);
            return;
        }

        const handleTask = (task: UploadTask) => {
            setUploading(task.status === 'uploading');
            onUploadStateChange?.({
                isUploading: task.status === 'uploading',
                progress: getCombinedProgress(task),
                fileName: task.fileName,
                cancelUpload,
            });
            if (task.status === 'done' && task.result && !task.delivered) {
                task.delivered = true;
                onFileUploaded(task.result);
            }
            if (task.status === 'done' && fileAttached) {
                uploadTasksByChat.delete(chatId);
                resetUpload();
            }
        };

        existingTask.listeners.add(handleTask);
        handleTask(existingTask);

        return () => {
            existingTask.listeners.delete(handleTask);
        };
    }, [chatId, onFileUploaded, fileAttached, onUploadStateChange]);

    const startUploadFromFile = (file: File | null | undefined) => {
        if (!file) return;

        // Validate file size
        if (!validateFileSize(file.size)) {
            alert('حجم فایل نباید بیشتر از ۲۰ مگابایت باشد');
            onUploadStateChange?.({ isUploading: false, progress: 0, fileName: null });
            return;
        }

        setPickerMenuOpen(false);
        uploadFile(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPickerSession(false);
        const file = e.target.files?.[0];
        startUploadFromFile(file);
        e.currentTarget.value = '';
    };

    useEffect(() => {
        if (!onRegisterUploadFile) return;
        onRegisterUploadFile((file: File) => {
            startUploadFromFile(file);
        });
        return () => {
            onRegisterUploadFile(null);
        };
    }, [onRegisterUploadFile]);

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
        };
        uploadTasksByChat.set(chatId, task);

        let encryptionPulse: number | null = null;
        try {
            let imagePreviewBlob: Blob | null = null;
            if ((file.type || '').startsWith('image/')) {
                imagePreviewBlob = await createBlurredPreview(file);
            }
            task.encryptionProgress = 10;
            pushTaskUpdate(task);
            encryptionPulse = window.setInterval(() => {
                task.encryptionProgress = Math.min(95, task.encryptionProgress + 5);
                pushTaskUpdate(task);
            }, 140);
            const plainBytes = new Uint8Array(await file.arrayBuffer());
            const encryptedBytes = await encryptFileBytesClientSide(plainBytes, token, chatId);
            if (encryptCancelRef.current) {
                uploadTasksByChat.delete(chatId);
                resetUpload();
                return;
            }
            window.clearInterval(encryptionPulse);
            encryptionPulse = null;
            task.encryptionProgress = 100;
            pushTaskUpdate(task);
            const encryptedBlob = new Blob([new Uint8Array(encryptedBytes)], { type: 'application/octet-stream' });
            const encryptedFile = new window.File([encryptedBlob], file.name, {
                type: 'application/octet-stream',
                lastModified: file.lastModified,
            });

            const formData = new FormData();
            formData.append('file', encryptedFile);
            if (imagePreviewBlob) {
                formData.append('preview', new window.File([imagePreviewBlob], `preview-${file.name}.jpg`, { type: 'image/jpeg' }));
            }

            const xhr = new XMLHttpRequest();
            xhrRef.current = xhr;

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    task.uploadProgress = progress;
                    pushTaskUpdate(task);
                }
            });

            // Handle completion
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
                        void saveBlobToCache(`chat:${chatId}:file:${result.fileId}`, file);
                        task.status = 'done';
                        task.uploadProgress = 100;
                        task.encryptionProgress = 100;
                        task.result = result;
                        pushTaskUpdate(task);
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

            // Handle errors
            xhr.addEventListener('error', () => {
                console.error('Upload error');
                alert('خطا در آپلود فایل');
                task.status = 'error';
                pushTaskUpdate(task);
                uploadTasksByChat.delete(chatId);
                resetUpload();
            });

            // Handle abort
            xhr.addEventListener('abort', () => {
                console.log('Upload cancelled');
                task.status = 'error';
                pushTaskUpdate(task);
                uploadTasksByChat.delete(chatId);
                resetUpload();
            });

            // Start upload
            xhr.open('POST', `${API_BASE_URL}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);

        } catch (error) {
            if (encryptionPulse != null) {
                window.clearInterval(encryptionPulse);
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
        onUploadStateChange?.({ isUploading: false, progress: 0, fileName: null });
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
            onUploadStateChange?.({ isUploading: false, progress: 0, fileName: null });
        };
    }, [onUploadStateChange]);

    return (
        <>
            <div className="file-upload-container">
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />

            <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />
            <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
            />

            <input
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
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <motion.button type="button" className="file-upload-picker-item" onClick={openPicker(imageInputRef)}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Image size={16} />تصویر</span>
                        </motion.button>
                        <motion.button type="button" className="file-upload-picker-item" onClick={openPicker(videoInputRef)}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Video size={16} />ویدیو</span>
                        </motion.button>
                        <motion.button type="button" className="file-upload-picker-item" onClick={openPicker(audioInputRef)}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><Music2 size={16} />آهنگ</span>
                        </motion.button>
                        <motion.button type="button" className="file-upload-picker-item" onClick={openPicker(fileInputRef)}
                            whileHover={{ x: -2 }} whileTap={{ scale: 0.98 }}>
                            <span className="file-upload-picker-item__label"><FileIcon size={16} />فایل</span>
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
        </>
    );
}

async function createBlurredPreview(file: File): Promise<Blob | null> {
    try {
        const bitmap = await createImageBitmap(file);
        const maxWidth = 480;
        const ratio = Math.min(1, maxWidth / bitmap.width);
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.filter = 'blur(8px)';
        ctx.drawImage(bitmap, 0, 0, width, height);
        return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
    } catch {
        return null;
    }
}
