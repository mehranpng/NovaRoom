import { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Download } from 'lucide-react';
import { API_BASE_URL } from '../config/api';

interface FileMessageProps {
  file: FileMetadata;
  token: string;
}

export function FileMessage({ file, token }: FileMessageProps) {
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

  // Check if it's an image and show preview
  const isImage = isImageFile(file.mimeType);
  const imageUrl = isImage ? `${API_BASE_URL}/files/${file.fileId}` : null;

  return (
    <div className="file-message">
      {isImage && imageUrl ? (
        <div className="file-image-preview">
          <img 
            src={imageUrl} 
            alt={file.fileName}
            onClick={handleDownload}
            style={{ cursor: 'pointer' }}
          />
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
