import os
import uuid
import aiofiles
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime, timezone
import mimetypes

# Base directory for file uploads
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Maximum file size: 3MB
MAX_FILE_SIZE = 3 * 1024 * 1024  # 3MB in bytes

# Allowed MIME types (blacklist dangerous executables)
DANGEROUS_EXTENSIONS = {
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js',
    '.jar', '.app', '.deb', '.rpm', '.dmg', '.pkg', '.msi'
}

def is_allowed_file(filename: str) -> bool:
    """Check if file type is allowed (not in dangerous list)"""
    ext = Path(filename).suffix.lower()
    return ext not in DANGEROUS_EXTENSIONS

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks"""
    # Get only the filename, remove any directory components
    safe_name = Path(filename).name
    # Remove any potentially dangerous characters
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._- ')
    return safe_name[:255]  # Limit length

def generate_unique_filename(original_filename: str) -> Tuple[str, str]:
    """
    Generate a unique filename while preserving extension
    Returns: (unique_file_id, sanitized_original_name)
    """
    sanitized = sanitize_filename(original_filename)
    ext = Path(sanitized).suffix
    unique_id = f"{uuid.uuid4().hex}{ext}"
    return unique_id, sanitized

def get_file_path(file_id: str) -> Path:
    """Get full path for a file ID"""
    # Prevent path traversal
    safe_id = Path(file_id).name
    return UPLOAD_DIR / safe_id

async def save_uploaded_file(file_content: bytes, original_filename: str) -> dict:
    """
    Save uploaded file to disk
    Returns file metadata dict
    """
    # Validate file size
    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB")
    
    # Validate file type
    if not is_allowed_file(original_filename):
        raise ValueError("File type not allowed")
    
    # Generate unique filename
    file_id, sanitized_name = generate_unique_filename(original_filename)
    file_path = get_file_path(file_id)
    
    # Save file
    async with aiofiles.open(file_path, 'wb') as f:
        await f.write(file_content)
    
    # Detect MIME type
    mime_type, _ = mimetypes.guess_type(sanitized_name)
    if not mime_type:
        mime_type = "application/octet-stream"
    
    # Return metadata
    return {
        "fileId": file_id,
        "fileName": sanitized_name,
        "fileSize": len(file_content),
        "mimeType": mime_type,
        "uploadedAt": datetime.now(timezone.utc)
    }

async def delete_file(file_id: str) -> bool:
    """
    Delete a file from disk
    Returns True if deleted, False if not found
    """
    file_path = get_file_path(file_id)
    
    if file_path.exists():
        try:
            file_path.unlink()
            return True
        except Exception as e:
            print(f"Error deleting file {file_id}: {e}")
            return False
    
    return False

def validate_file_access(file_id: str) -> bool:
    """Check if file exists on disk"""
    file_path = get_file_path(file_id)
    return file_path.exists() and file_path.is_file()

async def cleanup_orphaned_files(db_file_ids: set) -> int:
    """
    Clean up files on disk that are not referenced in database
    Returns count of deleted files
    """
    deleted_count = 0
    
    for file_path in UPLOAD_DIR.iterdir():
        if file_path.is_file():
            file_id = file_path.name
            if file_id not in db_file_ids:
                try:
                    file_path.unlink()
                    deleted_count += 1
                except Exception as e:
                    print(f"Error deleting orphaned file {file_id}: {e}")
    
    return deleted_count
