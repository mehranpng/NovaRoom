import { useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { FileMetadata } from '../types';
import { API_BASE_URL } from '../config/api';
import { validateFileSize } from '../utils/fileUtils';

interface FileUploadProps {
    token: string;
    onFileUploaded: (file: FileMetadata) => void;
}

export function FileUpload({ token, onFileUploaded }: FileUploadProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [pickerMenuOpen, setPickerMenuOpen] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file size
        if (!validateFileSize(file.size)) {
            alert('حجم فایل نباید بیشتر از ۱۰ مگابایت باشد');
            return;
        }

        setPickerMenuOpen(false);
        setSelectedFile(file);
        uploadFile(file);
    };

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

    const uploadFile = async (file: File) => {
        setUploading(true);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append('file', file);

        // Create AbortController for cancellation
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    setUploadProgress(progress);
                }
            });

            // Handle completion
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success && response.file) {
                        onFileUploaded(response.file);
                        resetUpload();
                    } else {
                        throw new Error('Invalid response');
                    }
                } else {
                    throw new Error(`Upload failed: ${xhr.status}`);
                }
            });

            // Handle errors
            xhr.addEventListener('error', () => {
                console.error('Upload error');
                alert('خطا در آپلود فایل');
                resetUpload();
            });

            // Handle abort
            xhr.addEventListener('abort', () => {
                console.log('Upload cancelled');
                resetUpload();
            });

            // Setup abort signal
            abortController.signal.addEventListener('abort', () => {
                xhr.abort();
            });

            // Start upload
            xhr.open('POST', `${API_BASE_URL}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);

        } catch (error) {
            console.error('Upload error:', error);
            alert('خطا در آپلود فایل');
            resetUpload();
        }
    };

    const resetUpload = () => {
        setSelectedFile(null);
        setUploading(false);
        setUploadProgress(0);
        abortControllerRef.current = null;
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        if (imageInputRef.current) {
            imageInputRef.current.value = '';
        }
        if (videoInputRef.current) {
            videoInputRef.current.value = '';
        }
    };

    return (
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

            {pickerMenuOpen && !uploading && (
                <div className="file-upload-picker-menu" ref={menuRef}>
                    <button type="button" className="file-upload-picker-item" onClick={() => imageInputRef.current?.click()}>
                        تصویر
                    </button>
                    <button type="button" className="file-upload-picker-item" onClick={() => videoInputRef.current?.click()}>
                        ویدیو
                    </button>
                    <button type="button" className="file-upload-picker-item" onClick={() => fileInputRef.current?.click()}>
                        فایل
                    </button>
                </div>
            )}

            {uploading && selectedFile && (
                <div
                    className="file-upload-progress-inline"
                    role="progressbar"
                    aria-label={`Uploading ${uploadProgress}%`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                >
                    <div
                        className="file-upload-progress-inline__fill"
                        style={{ width: `${uploadProgress}%` }}
                    />
                </div>
            )}
        </div>
    );
}
