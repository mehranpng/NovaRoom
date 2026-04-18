import os
import uuid
import aiofiles
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime, timezone
import mimetypes
import hashlib
import hmac
import secrets

# Base directory for file uploads
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Maximum file size 20MB
MAX_FILE_SIZE = 20 * 1024 * 1024

# Allowed MIME types (blacklist dangerous executables)
DANGEROUS_EXTENSIONS = {
    ".exe",
    ".bat",
    ".cmd",
    ".com",
    ".pif",
    ".scr",
    ".vbs",
    ".js",
    ".jar",
    ".app",
    ".deb",
    ".rpm",
    ".dmg",
    ".pkg",
    ".msi",
}
FILE_MAGIC = b"NRF1"
FILE_NONCE_SIZE = 16
FILE_TAG_SIZE = 16


def _file_key() -> bytes:
    raw_secret = os.getenv("SECRET_KEY", "") or "dev-secret-change-me"
    return hashlib.sha256(f"{raw_secret}|file-storage".encode("utf-8")).digest()


def _xor_stream(data: bytes, key: bytes, nonce: bytes) -> bytes:
    out = bytearray(len(data))
    counter = 0
    idx = 0
    while idx < len(data):
        block = hashlib.sha256(key + nonce + counter.to_bytes(8, "big")).digest()
        for b in block:
            if idx >= len(data):
                break
            out[idx] = data[idx] ^ b
            idx += 1
        counter += 1
    return bytes(out)


def encrypt_file_bytes(plain: bytes) -> bytes:
    if plain.startswith(FILE_MAGIC):
        return plain
    key = _file_key()
    nonce = secrets.token_bytes(FILE_NONCE_SIZE)
    cipher = _xor_stream(plain, key, nonce)
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:FILE_TAG_SIZE]
    return FILE_MAGIC + nonce + cipher + tag


def decrypt_file_bytes(raw: bytes) -> bytes:
    if not raw.startswith(FILE_MAGIC):
        return raw
    if len(raw) < len(FILE_MAGIC) + FILE_NONCE_SIZE + FILE_TAG_SIZE:
        return b""
    body = raw[len(FILE_MAGIC) :]
    nonce = body[:FILE_NONCE_SIZE]
    cipher = body[FILE_NONCE_SIZE:-FILE_TAG_SIZE]
    tag = body[-FILE_TAG_SIZE:]
    key = _file_key()
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:FILE_TAG_SIZE]
    if not hmac.compare_digest(tag, expected):
        return b""
    return _xor_stream(cipher, key, nonce)


def is_allowed_file(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext not in DANGEROUS_EXTENSIONS


def sanitize_filename(filename: str) -> str:
    # Get only the filename, remove any directory components
    safe_name = Path(filename).name
    # Remove any potentially dangerous characters
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in "._- ")
    return safe_name[:255]  # Limit length


def generate_unique_filename(original_filename: str) -> Tuple[str, str]:
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
    # Validate file size
    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(
            f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB"
        )

    # Validate file type
    if not is_allowed_file(original_filename):
        raise ValueError("File type not allowed")

    # Generate unique filename
    file_id, sanitized_name = generate_unique_filename(original_filename)
    file_path = get_file_path(file_id)

    # Save file
    async with aiofiles.open(file_path, "wb") as f:
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
        "uploadedAt": datetime.now(timezone.utc),
    }


async def delete_file(file_id: str) -> bool:
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
    file_path = get_file_path(file_id)
    return file_path.exists() and file_path.is_file()


async def read_file_content(file_id: str) -> Optional[bytes]:
    file_path = get_file_path(file_id)
    if not file_path.exists() or not file_path.is_file():
        return None
    async with aiofiles.open(file_path, "rb") as f:
        raw = await f.read()
    # Legacy compatibility: old files were encrypted server-side with NRF1.
    if raw.startswith(FILE_MAGIC):
        return decrypt_file_bytes(raw)
    return raw


async def read_file_raw_content(file_id: str) -> Optional[bytes]:
    file_path = get_file_path(file_id)
    if not file_path.exists() or not file_path.is_file():
        return None
    async with aiofiles.open(file_path, "rb") as f:
        return await f.read()


async def encrypt_existing_uploads() -> int:
    # Deprecated: new uploads are encrypted client-side.
    # Keep as a no-op to avoid mutating existing client-encrypted files.
    return 0


async def cleanup_orphaned_files(db_file_ids: set) -> int:
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
