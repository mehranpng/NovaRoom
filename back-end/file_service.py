import os
import uuid
import aiofiles
from pathlib import Path
from typing import Dict, Optional, Tuple
from datetime import datetime, timezone
import mimetypes
import hashlib
import hmac
import secrets
import asyncio
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv, find_dotenv

_root_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
else:
    load_dotenv(find_dotenv(usecwd=True))

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 20 * 1024 * 1024

USE_S3 = os.getenv("USE_S3", "false").lower().strip() in ("true", "1", "yes")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "").strip()
if S3_ENDPOINT_URL and not S3_ENDPOINT_URL.startswith("http://") and not S3_ENDPOINT_URL.startswith("https://"):
    S3_ENDPOINT_URL = f"https://{S3_ENDPOINT_URL}"
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "").strip()
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "").strip()

S3_UPLOAD_PREFIX = "upload"
S3_AI_TEMP_PREFIX = "upload/ai_temp"
S3_FONTS_PREFIX = "static/fonts"
S3_STOCKFISH_PREFIX = "static/stockfish"

_s3_client = None


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            config=Config(s3={"addressing_style": "path"}),
        )
    return _s3_client


def is_s3_enabled() -> bool:
    return (
        USE_S3
        and bool(S3_ENDPOINT_URL)
        and bool(S3_ACCESS_KEY)
        and bool(S3_SECRET_KEY)
        and bool(S3_BUCKET_NAME)
    )


def get_s3_upload_key(file_id: str) -> str:
    return f"{S3_UPLOAD_PREFIX}/{Path(file_id).name}"


def get_s3_ai_temp_key(filename: str) -> str:
    return f"{S3_AI_TEMP_PREFIX}/{Path(filename).name}"


def get_s3_font_key(filename: str) -> str:
    return f"{S3_FONTS_PREFIX}/{Path(filename).name}"


def get_s3_stockfish_key(filename: str) -> str:
    return f"{S3_STOCKFISH_PREFIX}/{Path(filename).name}"


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
    safe_name = Path(filename).name
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in "._- ")
    return safe_name[:255]


def generate_unique_filename(original_filename: str) -> Tuple[str, str]:
    sanitized = sanitize_filename(original_filename)
    ext = Path(sanitized).suffix
    unique_id = f"{uuid.uuid4().hex}{ext}"
    return unique_id, sanitized


def get_file_path(file_id: str) -> Path:
    safe_id = Path(file_id).name
    return UPLOAD_DIR / safe_id


async def save_uploaded_file(file_content: bytes, original_filename: str) -> dict:
    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(
            f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB"
        )

    if not is_allowed_file(original_filename):
        raise ValueError("File type not allowed")

    file_id, sanitized_name = generate_unique_filename(original_filename)
    mime_type, _ = mimetypes.guess_type(sanitized_name)
    if not mime_type:
        mime_type = "application/octet-stream"

    if is_s3_enabled():
        key = get_s3_upload_key(file_id)
        client = get_s3_client()
        await asyncio.to_thread(
            client.put_object,
            Bucket=S3_BUCKET_NAME,
            Key=key,
            Body=file_content,
            ContentType=mime_type,
        )
    else:
        file_path = get_file_path(file_id)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(file_content)

    return {
        "fileId": file_id,
        "fileName": sanitized_name,
        "fileSize": len(file_content),
        "mimeType": mime_type,
        "uploadedAt": datetime.now(timezone.utc),
    }


async def delete_file(file_id: str) -> bool:
    safe_id = Path(file_id).name
    if not safe_id or safe_id != file_id:
        return False
    ok = True
    for file_path in (UPLOAD_DIR / safe_id, UPLOAD_DIR / S3_UPLOAD_PREFIX / safe_id):
        if not file_path.exists():
            continue
        try:
            await asyncio.to_thread(file_path.unlink)
        except FileNotFoundError:
            continue
        except Exception as e:
            print(f"Error deleting local file {file_id}: {e}")
            ok = False

    if is_s3_enabled():
        key = get_s3_upload_key(safe_id)
        client = get_s3_client()
        try:
            await asyncio.to_thread(
                client.delete_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
        except ClientError as e:
            code = str(e.response.get("Error", {}).get("Code") or "")
            if code not in ("404", "NoSuchKey"):
                print(f"Error deleting S3 file {file_id}: {e}")
                ok = False
        except Exception as e:
            print(f"Error deleting S3 file {file_id}: {e}")
            ok = False

    return ok


async def list_stored_files() -> Dict[str, float]:
    found: Dict[str, float] = {}

    def _scan_local() -> Dict[str, float]:
        result: Dict[str, float] = {}
        try:
            for entry in UPLOAD_DIR.iterdir():
                if entry.is_file():
                    result[entry.name] = entry.stat().st_mtime
        except Exception as e:
            print(f"Error listing local uploads: {e}")
        return result

    for file_id, mtime in (await asyncio.to_thread(_scan_local)).items():
        found[file_id] = max(found.get(file_id, 0.0), mtime)

    if is_s3_enabled():
        def _scan_s3() -> Dict[str, float]:
            result: Dict[str, float] = {}
            client = get_s3_client()
            prefix = f"{S3_UPLOAD_PREFIX}/"
            ai_prefix = f"{S3_AI_TEMP_PREFIX}/"
            try:
                paginator = client.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=S3_BUCKET_NAME, Prefix=prefix):
                    for obj in page.get("Contents", []) or []:
                        key = str(obj.get("Key") or "")
                        if not key.startswith(prefix) or key.startswith(ai_prefix):
                            continue
                        name = key[len(prefix):]
                        if not name or "/" in name:
                            continue
                        modified = obj.get("LastModified")
                        result[name] = (
                            modified.timestamp()
                            if modified is not None
                            else 0.0
                        )
            except Exception as e:
                print(f"Error listing S3 uploads: {e}")
                raise
            return result

        for file_id, mtime in (await asyncio.to_thread(_scan_s3)).items():
            found[file_id] = max(found.get(file_id, 0.0), mtime)

    return found


def validate_file_access(file_id: str) -> bool:
    safe_id = Path(file_id).name
    if not safe_id or safe_id != file_id:
        return False
    if is_s3_enabled():
        return True
    file_path = get_file_path(file_id)
    return file_path.exists() and file_path.is_file()


async def read_file_content(file_id: str) -> Optional[bytes]:
    raw = None
    if is_s3_enabled():
        client = get_s3_client()
        key = get_s3_upload_key(file_id)
        try:
            resp = await asyncio.to_thread(
                client.get_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
            raw = await asyncio.to_thread(resp["Body"].read)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
                print(f"S3 get_object error for {file_id}: {e}")
        except Exception as e:
            print(f"S3 read error for {file_id}: {e}")

    if raw is None:
        file_path = get_file_path(file_id)
        if file_path.exists() and file_path.is_file():
            async with aiofiles.open(file_path, "rb") as f:
                raw = await f.read()

    if raw is None:
        alt_path = UPLOAD_DIR / S3_UPLOAD_PREFIX / Path(file_id).name
        if alt_path.exists() and alt_path.is_file():
            async with aiofiles.open(alt_path, "rb") as f:
                raw = await f.read()

    if raw is None:
        return None

    if raw.startswith(FILE_MAGIC):
        return decrypt_file_bytes(raw)
    return raw


async def save_ai_temp_file(data: bytes, filename: str) -> Path:
    ai_temp_dir = UPLOAD_DIR / "ai_temp"
    ai_temp_dir.mkdir(parents=True, exist_ok=True)
    local_path = ai_temp_dir / filename
    await asyncio.to_thread(local_path.write_bytes, data)
    if is_s3_enabled():
        key = get_s3_ai_temp_key(filename)
        client = get_s3_client()
        mime_type, _ = mimetypes.guess_type(filename)
        try:
            await asyncio.to_thread(
                client.put_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
                Body=data,
                ContentType=mime_type or "application/octet-stream",
            )
        except Exception as e:
            print(f"Error uploading AI temp file to S3 {filename}: {e}")
    return local_path


async def read_ai_temp_file(filename: str) -> Optional[bytes]:
    ai_temp_dir = UPLOAD_DIR / "ai_temp"
    local_path = ai_temp_dir / filename
    if local_path.exists() and local_path.is_file():
        return await asyncio.to_thread(local_path.read_bytes)
    if is_s3_enabled():
        key = get_s3_ai_temp_key(filename)
        client = get_s3_client()
        try:
            resp = await asyncio.to_thread(
                client.get_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
            data = await asyncio.to_thread(resp["Body"].read)
            ai_temp_dir.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(local_path.write_bytes, data)
            return data
        except Exception:
            return None
    return None


async def delete_ai_temp_file(filename: str) -> bool:
    deleted = False
    if is_s3_enabled():
        key = get_s3_ai_temp_key(filename)
        client = get_s3_client()
        try:
            await asyncio.to_thread(
                client.delete_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
            deleted = True
        except Exception as e:
            print(f"Error deleting AI temp file from S3 {filename}: {e}")
    ai_temp_dir = UPLOAD_DIR / "ai_temp"
    local_path = ai_temp_dir / filename
    if local_path.exists():
        try:
            local_path.unlink()
            deleted = True
        except Exception as e:
            print(f"Error deleting local AI temp file {filename}: {e}")
    return deleted


async def read_static_font(filename: str) -> Optional[bytes]:
    safe_name = Path(filename).name
    if is_s3_enabled():
        key = get_s3_font_key(safe_name)
        client = get_s3_client()
        try:
            resp = await asyncio.to_thread(
                client.get_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
            return await asyncio.to_thread(resp["Body"].read)
        except Exception:
            pass
    return None


async def read_static_stockfish(filename: str) -> Optional[bytes]:
    safe_name = Path(filename).name
    if is_s3_enabled():
        key = get_s3_stockfish_key(safe_name)
        client = get_s3_client()
        try:
            resp = await asyncio.to_thread(
                client.get_object,
                Bucket=S3_BUCKET_NAME,
                Key=key,
            )
            return await asyncio.to_thread(resp["Body"].read)
        except Exception:
            pass
    return None


async def encrypt_existing_uploads() -> int:
    return 0
