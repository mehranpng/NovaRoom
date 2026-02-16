import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Download } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect } from 'react';

interface FileMessageProps {
    file: FileMetadata;
    token: string;
}

export function FileMessage({ file, token }: FileMessageProps) {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState(false);
    
    const isImage = isImageFile(file.mimeType);

    // Load image with Authorization header
    useEffect(() => {
        if (!isImage) return;

        let objectUrl: string | null = null;
        let cancelled = false;

        const loadImage = async () => {
            try {
                setImageLoading(true);
                setImageError(false);
                
                const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to load image');
                }

                const blob = await response.blob();
                
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setImageUrl(objectUrl);
                }
            } catch (error) {
                console.error('Failed to load image:', error);
                if (!cancelled) {
                    setImageError(true);
                }
            } finally {
                if (!cancelled) {
                    setImageLoading(false);
                }
            }
        };

        loadImage();

        return () => {
            cancelled = true;
            if (objectUrl) {
                window.URL.revokeObjectURL(objectUrl);
            }
        };
    }, [file.fileId, token, isImage]);

    const handleDownload = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error('Download failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading file:', error);
            alert('خطا در دانلود فایل');
        }
    };

    return (
        <div className="file-message">
            {isImage ? (
                <div className="file-image-preview">
                    {imageLoading ? (
                        <div className="file-loading" style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="spinner" />
                        </div>
                    ) : imageError || !imageUrl ? (
                        <div className="file-error" style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
                            <span>⚠️</span>
                            <span style={{ fontSize: '12px' }}>خطا در بارگذاری تصویر</span>
                        </div>
                    ) : (
                        <img
                            src={imageUrl}
                            alt={file.fileName}
                            onClick={handleDownload}
                            style={{ cursor: 'pointer' }}
                        />
                    )}
                    <div className="file-image-overlay">
                        <button onClick={handleDownload} className="file-download-btn">
                            <Download size={20} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="file-attachment" onClick={handleDownload}>
                    <div className="file-icon">{getFileIcon(file.mimeType)}</div>
                    <div className="file-info">
                        <div className="file-name">{file.fileName}</div>
                        <div className="file-size">{formatFileSize(file.fileSize)}</div>
                    </div>
                    <button className="file-download-btn">
                        <Download size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}
