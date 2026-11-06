from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Depends,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    File as FastAPIFile,
)
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response, FileResponse, StreamingResponse
from starlette.websockets import WebSocketState
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    AESGCM = None
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument, UpdateOne
from pymongo.errors import DuplicateKeyError
import os
from pathlib import Path
from dotenv import load_dotenv, find_dotenv
from typing import List, Dict, Optional, Any, Iterable, Literal, Tuple
import traceback
import asyncio
import time
import hashlib
import secrets
import base64
import hmac
import json
from bson import ObjectId
import re
import uuid
import urllib.parse
import jdatetime
from ai_service import (
    extract_urls_from_text,
    generate_ai_response_stream,
    generate_chat_title,
    perform_deepseek_url_fetch,
    perform_deepseek_web_search,
    process_post_turn_memory_and_summary,
)
from api_reaction_helper import aggregate_reactions
import chess_service
from chess_service import ChessError
from pywebpush import webpush, WebPushException
from file_service import (
    UPLOAD_DIR,
    save_uploaded_file,
    delete_file,
    validate_file_access,
    read_file_content,
    get_file_path,
    encrypt_existing_uploads,
    list_stored_files,
    MAX_FILE_SIZE,
    read_static_font,
    read_static_stockfish,
    save_ai_temp_file,
    read_ai_temp_file,
    delete_ai_temp_file,
)

_root_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
else:
    load_dotenv(find_dotenv(usecwd=True))

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
app = FastAPI(title="NovaRoom API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

class ApiPrefixMiddleware:
    """Allows endpoints to be called with or without the /api prefix"""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == "/api":
                scope["path"] = "/"
            elif path.startswith("/api/"):
                scope["path"] = path[4:]
            if "raw_path" in scope:
                raw = scope["raw_path"]
                if raw == b"/api":
                    scope["raw_path"] = b"/"
                elif raw.startswith(b"/api/"):
                    scope["raw_path"] = raw[4:]
        await self.app(scope, receive, send)

app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ApiPrefixMiddleware)

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "NovaRoom API"}

_raw_secret = os.getenv("SECRET_KEY", "")
if not _raw_secret:
    _raw_secret = "dev-secret-change-me"
if len(_raw_secret.encode("utf-8")) < 32:
    SECRET_KEY = hashlib.sha256(_raw_secret.encode("utf-8")).hexdigest()
else:
    SECRET_KEY = _raw_secret

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30
SESSION_INACTIVITY_EXPIRE_DAYS = 10
MAX_ACTIVE_SESSIONS = 20
MAX_LOGIN_EVENTS = 10

MONGO_URI = os.getenv("MONGO_DB") or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
DB_NAME = os.getenv("MONGO_DB_NAME") or os.getenv("DB_NAME", "novaroom")

client = AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME]
cl_users = db["users"]
cl_chats = db["chats"]
cl_messages = db["messages"]
cl_ai_messages = db["ai_messages"]
cl_ai_chats = db["ai_chats"]
cl_ai_usage = db["ai_usage"]
cl_ai_memories = db["ai_memories"]
cl_ai_temp_files = db["ai_temp_files"]
cl_chess_games = db["chess_games"]
cl_pending_file_deletions = db["pending_file_deletions"]
cl_register_links = db["register_links"]
cl_password_links = db["password_links"]
cl_app_settings = db["app_settings"]
cl_push_subscriptions = db["push_subscriptions"]
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@novaroom.org").strip()

active_connections: Dict[str, List[WebSocket]] = {}
active_ai_connections: Dict[str, List[WebSocket]] = {}
active_ai_stream_tasks: Dict[str, asyncio.Task] = {}
chess_rooms: Dict[str, Dict[str, List[WebSocket]]] = {}
chess_latency: Dict[str, Dict[str, int]] = {}
chess_locks: Dict[str, asyncio.Lock] = {}
chess_timers: Dict[str, asyncio.TimerHandle] = {}
chess_abandon_tasks: Dict[str, asyncio.Task] = {}
CHESS_INVITE_TEXT = "♟ دعوت به بازی شطرنج"
CHESS_SHARE_TEXT = "♟ نتیجه بازی شطرنج"


def now_ms() -> int:
    return int(time.time() * 1000)


security = HTTPBearer()

VALID_REACTIONS = [
    "👍",
    "👎",
    "🤣",
    "😢",
    "❤️",
    "💔",
    "🙏",
    "😐",
    "🫩",
    "😍",
    "🤔",
    "🤯",
    "🔥",
    "💯",
    "✅️",
    "❌️",
    "💩",
    "😡",
    "😭",
    "😨",
]

MAX_PINNED_CHATS = 20
MAX_GROUP_MEMBERS = 30
GROUP_CREATE_LIMIT_ADMIN = 30
GROUP_CREATE_LIMIT_USER = 2
MAX_CHAT_MESSAGE_LENGTH = 6000
MAX_AI_MESSAGE_LENGTH = 3000
MAX_AI_MESSAGES_PER_CHAT = 60
AI_DAILY_TOKEN_LIMIT = 20000
AI_DAILY_FILE_LIMIT = 5
AI_DAILY_SEARCH_LIMIT = 3
AI_DISABLED_DEFAULT_MESSAGE = "به دلایل فنی Nova AI موقتا غیرفعال هست"
AI_DISABLED_MESSAGE_MAX_LENGTH = 100
MAX_AI_USER_MEMORIES = 10
AI_MAX_FILE_SIZE = 10 * 1024 * 1024
AI_TEMP_FILE_TTL_SEC = 15 * 60
AI_TEMP_DIR = UPLOAD_DIR / "ai_temp"
AI_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
AI_ALLOWED_EXTENSIONS = AI_IMAGE_EXTENSIONS | {
    ".pdf",
    ".md",
    ".txt",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".py",
    ".sql",
    ".sh",
    ".log",
}
AI_MAX_FILE_CONTEXT_CHARS = 15000
AI_HISTORY_MESSAGE_LIMIT = 16
AI_HISTORY_CHAR_BUDGET = 12000
OFFICIAL_CHANNEL_CHAT_ID = "official-channel"
OFFICIAL_CHANNEL_NAME = "کانال نواروم"
OFFICIAL_CHANNEL_AVATAR = "/logo/ch.png"
ACCOUNT_DELETION_GRACE_SECONDS = int(os.getenv("ACCOUNT_DELETION_GRACE_SECONDS", "86400"))
ACCOUNT_DELETION_LEASE_SECONDS = 300
ACCOUNT_DELETION_POLL_SECONDS = 30
ACCOUNT_PURGE_BATCH = 500


def is_official_channel_chat(chat_id: str) -> bool:
    return str(chat_id or "").strip() == OFFICIAL_CHANNEL_CHAT_ID


TEHRAN_TZ = timezone(timedelta(hours=3, minutes=30))
WS_IDLE_TIMEOUT_SEC = 95
ENC_PREFIX = "enc:v1:"
ENC_NONCE_SIZE = 16
ENC_TAG_SIZE = 16
FILE_MAGIC = b"NCF1"
FILE_MAGIC_V2 = b"NCF2"
FILE_GCM_IV_SIZE = 12
FILE_TEXT_PREFIX = "ncf:v1:"
LEGACY_BOOTSTRAP_TOKEN = "__bootstrap_migration__"


def normalize_ai_model_key(value: str) -> str:
    key = str(value or "nova-flash").strip().lower()
    return "nova-pro" if key == "nova-pro" else "nova-flash"


def ai_model_name_from_key(model_key: str, use_reasoner: bool = False) -> str:
    if normalize_ai_model_key(model_key) == "nova-pro" or use_reasoner:
        return "deepseek-v4-pro"
    return "deepseek-flash"


def ai_model_label_from_key(model_key: str) -> str:
    return (
        "Nova Pro" if normalize_ai_model_key(model_key) == "nova-pro" else "Nova Flash"
    )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


DEFAULT_DEV_SECRET_KEY = hashlib.sha256(b"dev-secret-change-me").hexdigest()


def _derive_enc_key(token: str, scope: str, secret: str = SECRET_KEY) -> bytes:
    material = f"{secret}|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_shared(scope: str, secret: str = SECRET_KEY) -> bytes:
    material = f"{secret}|shared|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_scoped_tokenhash(
    token: str, scope: str, secret: str = SECRET_KEY
) -> bytes:
    token_hint = hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()[:16]
    material = f"{secret}|{scope}|{token_hint}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_token_raw(
    token: str, scope: str, secret: str = SECRET_KEY
) -> bytes:
    material = f"{secret}|{token}|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _is_server_managed_scope(scope: str) -> bool:
    value = str(scope or "")
    return (
        value.startswith("ai:")
        or value.startswith("ai-chat:")
        or value.startswith("ai-chat-meta:")
        or value.startswith("ai-memory:")
    )


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


def encrypt_scoped_text(plain: str, token: str, scope: str) -> str:
    text = str(plain or "")
    if not text:
        return ""
    if not _is_server_managed_scope(scope):
        return text
    key = _derive_enc_key(token, scope)
    nonce = secrets.token_bytes(ENC_NONCE_SIZE)
    encrypted = _xor_stream(text.encode("utf-8"), key, nonce)
    tag = hmac.new(key, nonce + encrypted, hashlib.sha256).digest()[:ENC_TAG_SIZE]
    payload = base64.urlsafe_b64encode(nonce + encrypted + tag).decode("ascii")
    return f"{ENC_PREFIX}{payload}"


def decrypt_scoped_text(cipher: Any, token: str, scope: str) -> str:
    value = str(cipher or "")
    if not value:
        return ""
    if not _is_server_managed_scope(scope):
        return value
    return _decrypt_scoped_text_raw(value, token, scope)


def _decrypt_scoped_text_raw(value: str, token: str, scope: str) -> str:
    if not value.startswith(ENC_PREFIX):
        return value
    try:
        raw = base64.urlsafe_b64decode(value[len(ENC_PREFIX) :].encode("ascii"))
        if len(raw) < ENC_NONCE_SIZE + ENC_TAG_SIZE:
            return ""
        nonce = raw[:ENC_NONCE_SIZE]
        body = raw[ENC_NONCE_SIZE:-ENC_TAG_SIZE]
        tag = raw[-ENC_TAG_SIZE:]
        candidate_keys = [
            _derive_enc_key(token, scope),
            _derive_enc_key("", scope),
            _derive_enc_key_legacy_shared(scope),
            _derive_enc_key_legacy_scoped_tokenhash(token, scope),
            _derive_enc_key_legacy_token_raw(token, scope),
            _derive_enc_key(token, scope, DEFAULT_DEV_SECRET_KEY),
            _derive_enc_key_legacy_shared(scope, DEFAULT_DEV_SECRET_KEY),
            _derive_enc_key_legacy_scoped_tokenhash(token, scope, DEFAULT_DEV_SECRET_KEY),
            _derive_enc_key_legacy_token_raw(token, scope, DEFAULT_DEV_SECRET_KEY),
        ]
        for key in candidate_keys:
            expected = hmac.new(key, nonce + body, hashlib.sha256).digest()[
                :ENC_TAG_SIZE
            ]
            if not hmac.compare_digest(tag, expected):
                continue
            return _xor_stream(body, key, nonce).decode("utf-8", errors="ignore")
        return ""
    except Exception:
        return ""


def is_ciphertext(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


def decrypt_with_fallback(cipher: Any, token: str, scope: str) -> str:
    if not _is_server_managed_scope(scope):
        value = str(cipher or "")
        if not is_ciphertext(value):
            return value
        plain = _decrypt_scoped_text_raw(value, token, scope)
        if plain:
            return plain
        legacy_plain = _decrypt_scoped_text_raw(value, LEGACY_BOOTSTRAP_TOKEN, scope)
        if legacy_plain:
            return legacy_plain
        return value
    if not is_ciphertext(cipher):
        return str(cipher or "")
    plain = decrypt_scoped_text(cipher, token, scope)
    if plain:
        return plain
    legacy_plain = decrypt_scoped_text(cipher, LEGACY_BOOTSTRAP_TOKEN, scope)
    if legacy_plain:
        return legacy_plain
    return "🔐"


def _derive_client_shared_key(scope: str) -> bytes:
    material = f"novaroom-client-shared|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _base64url_decode_bytes(value: str) -> bytes:
    normalized = value.replace("-", "+").replace("_", "/")
    padding = "=" * ((4 - (len(normalized) % 4)) % 4)
    return base64.b64decode((normalized + padding).encode("ascii"))


MENTION_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9_]*[A-Za-z][A-Za-z0-9_]*)")


def decrypt_client_chat_text(value: Any, token: str, chat_scope: str) -> str:
    raw_text = str(value or "")
    if not raw_text:
        return ""
    if not raw_text.startswith(ENC_PREFIX):
        return raw_text
    try:
        packed = _base64url_decode_bytes(raw_text[len(ENC_PREFIX) :])
        if len(packed) >= ENC_NONCE_SIZE + ENC_TAG_SIZE:
            nonce = packed[:ENC_NONCE_SIZE]
            body = packed[ENC_NONCE_SIZE:-ENC_TAG_SIZE]
            tag = packed[-ENC_TAG_SIZE:]
            client_key = _derive_client_shared_key(chat_scope)
            expected = hmac.new(client_key, nonce + body, hashlib.sha256).digest()[
                :ENC_TAG_SIZE
            ]
            if hmac.compare_digest(tag, expected):
                return _xor_stream(body, client_key, nonce).decode(
                    "utf-8", errors="ignore"
                )
    except Exception:
        pass
    return decrypt_with_fallback(raw_text, token, chat_scope)


async def resolve_group_unread_mention_user_ids(
    plain_text: str,
    sender_id: str,
    participants: List[str],
    reply_to: Optional[Dict[str, Any]] = None,
) -> List[str]:
    if not participants:
        return []
    participant_set = {str(p).strip() for p in participants if str(p or "").strip()}
    target_ids: set = set()

    if isinstance(reply_to, dict):
        replied_sender = str(reply_to.get("senderId") or "").strip()
        if (
            replied_sender
            and replied_sender != sender_id
            and replied_sender in participant_set
        ):
            target_ids.add(replied_sender)

    mentioned_usernames = {
        m.lower() for m in MENTION_TOKEN_RE.findall(str(plain_text or "")) if m
    }
    if mentioned_usernames:
        other_participants = [p for p in participant_set if p != sender_id]
        if other_participants:
            docs = await cl_users.find(
                {"chatId": {"$in": other_participants}, **NOT_PURGING},
                {"chatId": 1, "profile.username": 1},
            ).to_list(len(other_participants))
            for doc in docs:
                uname = (
                    str((doc.get("profile") or {}).get("username") or "")
                    .strip()
                    .lower()
                )
                cid = str(doc.get("chatId") or "").strip()
                if uname and uname in mentioned_usernames and cid and cid != sender_id:
                    target_ids.add(cid)

    return sorted(target_ids)


def _try_unpack_client_file_packet(raw: bytes) -> Optional[bytes]:
    if not raw:
        return None
    if raw.startswith(FILE_MAGIC):
        return raw[len(FILE_MAGIC) :]
    try:
        text = raw.decode("utf-8")
    except Exception:
        return None
    if not text.startswith(FILE_TEXT_PREFIX):
        return None
    try:
        return _base64url_decode_bytes(text[len(FILE_TEXT_PREFIX) :])
    except Exception:
        return None


def decrypt_client_file_bytes(raw: bytes, chat_scope: str) -> Optional[bytes]:
    if not raw:
        return None
    if raw.startswith(FILE_MAGIC_V2):
        if len(raw) < len(FILE_MAGIC_V2) + FILE_GCM_IV_SIZE + ENC_TAG_SIZE:
            return None
        try:
            iv = raw[len(FILE_MAGIC_V2) : len(FILE_MAGIC_V2) + FILE_GCM_IV_SIZE]
            body = raw[len(FILE_MAGIC_V2) + FILE_GCM_IV_SIZE :]
            key = _derive_client_shared_key(chat_scope)
            if AESGCM is not None:
                return AESGCM(key).decrypt(iv, body, None)
        except Exception:
            return None
    packed = _try_unpack_client_file_packet(raw)
    if not packed:
        return None
    if len(packed) < ENC_NONCE_SIZE + ENC_TAG_SIZE:
        return None
    nonce = packed[:ENC_NONCE_SIZE]
    body = packed[ENC_NONCE_SIZE:-ENC_TAG_SIZE]
    tag = packed[-ENC_TAG_SIZE:]
    key = _derive_client_shared_key(chat_scope)
    expected = hmac.new(key, nonce + body, hashlib.sha256).digest()[:ENC_TAG_SIZE]
    if not hmac.compare_digest(tag, expected):
        return None
    return _xor_stream(body, key, nonce)


def encrypt_client_file_bytes(plain: bytes, chat_scope: str) -> bytes:
    if not plain:
        return plain
    key = _derive_client_shared_key(chat_scope)
    if AESGCM is not None:
        iv = secrets.token_bytes(FILE_GCM_IV_SIZE)
        encrypted = AESGCM(key).encrypt(iv, plain, None)
        return FILE_MAGIC_V2 + iv + encrypted
    nonce = secrets.token_bytes(ENC_NONCE_SIZE)
    encrypted = _xor_stream(plain, key, nonce)
    tag = hmac.new(key, nonce + encrypted, hashlib.sha256).digest()[:ENC_TAG_SIZE]
    return FILE_MAGIC + nonce + encrypted + tag


async def _remap_forward_file_to_target_chat(
    file_meta: Dict[str, Any],
    source_chat_id: str,
    target_chat_id: str,
    uploaded_by: str,
) -> Dict[str, Any]:
    file_id = str((file_meta or {}).get("fileId") or "").strip()
    if not file_id:
        return dict(file_meta or {})
    source_raw = await read_file_content(file_id)
    if source_raw is None:
        raise HTTPException(status_code=404, detail="Forward source file not found")

    source_scope = f"chat:{source_chat_id}"
    target_scope = f"chat:{target_chat_id}"
    mime_type = str(file_meta.get("mimeType") or "").strip().lower()
    is_audio = mime_type.startswith("audio/") and not (
        source_raw.startswith(FILE_MAGIC) or source_raw.startswith(FILE_MAGIC_V2)
    )

    if is_audio:
        remapped_raw = source_raw
    else:
        plain = decrypt_client_file_bytes(source_raw, source_scope)
        if plain is None:
            plain = source_raw
        remapped_raw = encrypt_client_file_bytes(plain, target_scope)

    remapped_meta = await save_uploaded_file(
        remapped_raw,
        str(file_meta.get("fileName") or "forwarded-file"),
    )
    remapped_meta["uploadedBy"] = uploaded_by
    remapped_meta["mimeType"] = str(
        file_meta.get("mimeType")
        or remapped_meta.get("mimeType")
        or "application/octet-stream"
    )
    remapped_meta["fileName"] = str(
        file_meta.get("fileName") or remapped_meta.get("fileName") or "forwarded-file"
    )
    remapped_meta["fileSize"] = int(
        file_meta.get("fileSize") or remapped_meta.get("fileSize") or 0
    )
    uploaded_at = remapped_meta.get("uploadedAt")
    if isinstance(uploaded_at, datetime):
        remapped_meta["uploadedAt"] = uploaded_at.isoformat()

    id_map: Dict[str, str] = {}

    cover_art_id = str(file_meta.get("coverArtFileId") or "").strip()
    if not cover_art_id:
        cover_art_id = _file_id_from_url(file_meta.get("coverArtUrl"))
    if cover_art_id:
        cover_raw = await read_file_content(cover_art_id)
        if cover_raw is not None:
            cover_plain = decrypt_client_file_bytes(cover_raw, source_scope)
            if cover_plain is None:
                cover_plain = cover_raw
            remapped_cover_raw = encrypt_client_file_bytes(cover_plain, target_scope)
            remapped_cover_meta = await save_uploaded_file(
                remapped_cover_raw, "cover-art"
            )
            remapped_cover_meta["uploadedBy"] = uploaded_by
            if remapped_cover_meta.get("fileId"):
                id_map[cover_art_id] = str(remapped_cover_meta.get("fileId"))
            remapped_meta["coverArtFileId"] = remapped_cover_meta.get("fileId")
            remapped_meta["coverArtUrl"] = (
                f"/files/{remapped_cover_meta.get('fileId')}"
                if remapped_cover_meta.get("fileId")
                else remapped_meta.get("coverArtUrl")
            )

    preview_id = str(file_meta.get("previewFileId") or "").strip()
    if not preview_id:
        preview_id = _file_id_from_url(file_meta.get("previewUrl"))
    if preview_id:
        preview_raw = await read_file_content(preview_id)
        if preview_raw is not None:
            remapped_preview_meta = await save_uploaded_file(
                preview_raw, "preview.jpg"
            )
            remapped_preview_meta["uploadedBy"] = uploaded_by
            if remapped_preview_meta.get("fileId"):
                id_map[preview_id] = str(remapped_preview_meta.get("fileId"))
            remapped_meta["previewFileId"] = remapped_preview_meta.get("fileId")
            remapped_meta["previewUrl"] = (
                f"/files/{remapped_preview_meta.get('fileId')}"
                if remapped_preview_meta.get("fileId")
                else remapped_meta.get("previewUrl")
            )
        else:
            remapped_meta["previewFileId"] = preview_id

    for key in ("previewUrl", "thumbUrl", "imagePreviewUrl"):
        value = str(file_meta.get(key) or "").strip()
        if not value:
            continue
        referenced_id = _file_id_from_url(value)
        if referenced_id and referenced_id in id_map:
            remapped_meta[key] = f"/files/{id_map[referenced_id]}"
        else:
            remapped_meta[key] = value

    for key in ("title", "artist"):
        if key in file_meta:
            remapped_meta[key] = file_meta.get(key)

    for key in ("width", "height", "duration"):
        if key in file_meta:
            remapped_meta[key] = file_meta.get(key)

    return remapped_meta


def user_bio_scope(chat_id: str) -> str:
    return f"user-bio:{chat_id}"


def decrypt_user_bio(user_doc: Dict[str, Any], token: str = "") -> str:
    chat_id = str(user_doc.get("chatId") or "")
    profile = user_doc.get("profile") or {}
    return decrypt_with_fallback(profile.get("bio", ""), token, user_bio_scope(chat_id))


def dt_to_epoch_ms(dt: Any) -> int:
    if dt is None:
        return int(utc_now().timestamp() * 1000)
    if isinstance(dt, (int, float)):
        v = float(dt)
        if v < 1_000_000_000_000:
            v *= 1000
        return int(v)

    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)

    try:
        return int(float(dt))
    except Exception:
        return int(utc_now().timestamp() * 1000)


def resolve_user_online_state(user_doc: Optional[Dict[str, Any]]) -> bool:
    if not user_doc:
        return False
    chat_id = user_doc.get("chatId")
    if chat_id:
        conns = active_connections.get(chat_id, [])
        alive = [ws for ws in conns if ws.client_state == WebSocketState.CONNECTED]
        if alive:
            return True
        if not conns and not alive:
            return False
    return bool(user_doc.get("online"))


PRIVACY_VISIBILITY_VALUES = {"everyone", "friends", "nobody"}
_MUTUAL_INTERACTION_CACHE_TTL_SECONDS = 30
_mutual_interaction_cache: Dict[Tuple[str, str], Tuple[bool, float]] = {}


def privacy_visibility(settings: Optional[Dict[str, Any]], key: str) -> str:
    settings = settings or {}
    value = str(settings.get(key) or "").strip()
    if value in PRIVACY_VISIBILITY_VALUES:
        return value
    if key == "lastSeenVisibility" and settings.get("hideOnlineStatus"):
        return "nobody"
    return "everyone"


def privacy_settings_payload(settings: Optional[Dict[str, Any]]) -> Dict[str, str]:
    return {
        "lastSeenVisibility": privacy_visibility(settings, "lastSeenVisibility"),
        "avatarVisibility": privacy_visibility(settings, "avatarVisibility"),
        "bioVisibility": privacy_visibility(settings, "bioVisibility"),
    }


def _visibility_allows(visibility: str, is_friend: bool) -> bool:
    if visibility == "everyone":
        return True
    if visibility == "friends":
        return is_friend
    return False


async def has_mutual_interaction(user_a: str, user_b: str) -> bool:
    a = str(user_a or "").strip()
    b = str(user_b or "").strip()
    if not a or not b or a == b:
        return False
    cache_key = (a, b) if a < b else (b, a)
    cached = _mutual_interaction_cache.get(cache_key)
    now = time.time()
    if cached and now - cached[1] < _MUTUAL_INTERACTION_CACHE_TTL_SECONDS:
        return cached[0]
    chat_id = get_chat_id_for_two(a, b)
    chat = await cl_chats.find_one(
        {"_id": chat_id, "participants": {"$all": [a, b]}}, {"_id": 1}
    )
    if not chat:
        result = False
    else:
        senders = await cl_messages.distinct(
            "senderId", {"chatId": chat_id, "senderId": {"$in": [a, b]}}
        )
        sender_ids = {str(sender) for sender in senders}
        result = a in sender_ids and b in sender_ids
    if len(_mutual_interaction_cache) > 10000:
        _mutual_interaction_cache.clear()
    _mutual_interaction_cache[cache_key] = (result, now)
    return result


def _last_seen_category(target_last_seen: Any, target_online: bool) -> str:
    now = utc_now()
    ref_dt = now if target_online else target_last_seen
    if not ref_dt:
        return "recently"
    if not isinstance(ref_dt, datetime):
        try:
            ref_dt = datetime.fromtimestamp(float(ref_dt) / 1000.0, tz=timezone.utc)
        except Exception:
            ref_dt = now
    elif ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)
    else:
        ref_dt = ref_dt.astimezone(timezone.utc)
    diff_seconds = max(0.0, (now - ref_dt).total_seconds())
    if diff_seconds < 4 * 86400:
        return "recently"
    if diff_seconds < 14 * 86400:
        return "within_week"
    if diff_seconds < 30 * 86400:
        return "within_month"
    return "long_time_ago"


async def resolve_user_presence_for_viewer(
    viewer_user: Optional[Dict[str, Any]],
    target_user: Optional[Dict[str, Any]],
    blocked: bool = False,
) -> Dict[str, Any]:
    if not target_user:
        return {
            "online": False,
            "lastSeen": None,
            "lastSeenCategory": None,
            "avatarVisible": False,
            "bioVisible": False,
        }

    if blocked:
        return {
            "online": False,
            "lastSeen": None,
            "lastSeenCategory": "long_time_ago",
            "avatarVisible": False,
            "bioVisible": False,
        }

    viewer_id = str((viewer_user or {}).get("chatId") or "")
    target_id = str(target_user.get("chatId") or "")
    target_actual_online = resolve_user_online_state(target_user)
    target_last_seen = target_user.get("lastSeen")

    if viewer_id and target_id and viewer_id == target_id:
        return {
            "online": target_actual_online,
            "lastSeen": dt_to_epoch_ms(target_last_seen) if target_last_seen else None,
            "lastSeenCategory": None,
            "avatarVisible": True,
            "bioVisible": True,
        }

    viewer_settings = (viewer_user or {}).get("settings") or {}
    target_settings = target_user.get("settings") or {}
    viewer_visibility = privacy_visibility(viewer_settings, "lastSeenVisibility")
    target_visibility = privacy_visibility(target_settings, "lastSeenVisibility")
    avatar_visibility = privacy_visibility(target_settings, "avatarVisibility")
    bio_visibility = privacy_visibility(target_settings, "bioVisibility")

    is_friend = False
    if "friends" in (
        viewer_visibility,
        target_visibility,
        avatar_visibility,
        bio_visibility,
    ):
        is_friend = await has_mutual_interaction(viewer_id, target_id)

    avatar_visible = _visibility_allows(avatar_visibility, is_friend)
    bio_visible = _visibility_allows(bio_visibility, is_friend)

    can_see_last_seen = _visibility_allows(
        target_visibility, is_friend
    ) and _visibility_allows(viewer_visibility, is_friend)
    if not can_see_last_seen:
        return {
            "online": False,
            "lastSeen": None,
            "lastSeenCategory": _last_seen_category(
                target_last_seen, target_actual_online
            ),
            "avatarVisible": avatar_visible,
            "bioVisible": bio_visible,
        }

    return {
        "online": target_actual_online,
        "lastSeen": dt_to_epoch_ms(target_last_seen) if target_last_seen else None,
        "lastSeenCategory": None,
        "avatarVisible": avatar_visible,
        "bioVisible": bio_visible,
    }


async def mark_user_connected(user_id: str) -> bool:
    if not user_id:
        return False
    alive_count = len([ws for ws in active_connections.get(user_id, []) if ws.client_state == WebSocketState.CONNECTED])
    prev = await cl_users.find_one_and_update(
        {"chatId": user_id},
        {"$set": {"online": True, "wsConnectionCount": max(1, alive_count)}},
        return_document=ReturnDocument.BEFORE,
        projection={"online": 1, "wsConnectionCount": 1},
    )
    prev_online = resolve_user_online_state(prev)
    return not prev_online


async def mark_user_disconnected(user_id: str) -> bool:
    if not user_id:
        return False
    alive_count = len([ws for ws in active_connections.get(user_id, []) if ws.client_state == WebSocketState.CONNECTED])
    if alive_count > 0:
        await cl_users.update_one(
            {"chatId": user_id},
            {"$set": {"online": True, "wsConnectionCount": alive_count}},
        )
        return False
    active_connections.pop(user_id, None)
    await cl_users.update_one(
        {"chatId": user_id},
        {"$set": {"online": False, "wsConnectionCount": 0, "lastSeen": utc_now()}},
    )
    return True


async def force_user_offline(user_id: str) -> bool:
    if not user_id:
        return False
    active_connections.pop(user_id, None)
    prev = await cl_users.find_one(
        {"chatId": user_id}, {"online": 1, "wsConnectionCount": 1}
    )
    was_online = resolve_user_online_state(prev)
    await cl_users.update_one(
        {"chatId": user_id},
        {"$set": {"online": False, "wsConnectionCount": 0, "lastSeen": utc_now()}},
    )
    return bool(was_online)


def normalize_username(value: Optional[str]) -> str:
    return (value or "").strip()


def validate_username(value: str) -> bool:
    if not value:
        return False
    if len(value) < 3 or len(value) > 32:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9_]+", value))


def _is_valid_file_id(value: str) -> bool:
    return bool(value) and Path(value).name == value


def _file_id_from_url(value: Any) -> str:
    text = str(value or "").strip()
    marker = "/files/"
    idx = text.find(marker)
    if idx == -1:
        return ""
    candidate = text[idx + len(marker):].split("?", 1)[0].split("#", 1)[0].strip("/")
    return candidate if _is_valid_file_id(candidate) else ""


def collect_file_ids(message_doc: Dict[str, Any]) -> set:
    ids: set = set()
    file_data = message_doc.get("file") or {}
    if not isinstance(file_data, dict):
        return ids
    for key in ("fileId", "previewFileId", "coverArtFileId"):
        value = str(file_data.get(key) or "").strip()
        if _is_valid_file_id(value):
            ids.add(value)
    for key in ("previewUrl", "thumbUrl", "imagePreviewUrl", "coverArtUrl"):
        value = _file_id_from_url(file_data.get(key))
        if value:
            ids.add(value)
    return ids


async def _file_still_referenced(
    file_id: str, excluded_message_ids: Optional[set] = None
) -> bool:
    excluded = list(excluded_message_ids or [])
    message_query: Dict[str, Any] = {
        "$or": [
            {"file.fileId": file_id},
            {"file.previewFileId": file_id},
            {"file.coverArtFileId": file_id},
            {"file.previewUrl": f"/files/{file_id}"},
            {"file.thumbUrl": f"/files/{file_id}"},
            {"file.imagePreviewUrl": f"/files/{file_id}"},
            {"file.coverArtUrl": f"/files/{file_id}"},
        ]
    }
    if excluded:
        message_query["_id"] = {"$nin": excluded}
    if await cl_messages.find_one(message_query, {"_id": 1}):
        return True
    if await cl_users.find_one({"profile.avatar": file_id}, {"_id": 1}):
        return True
    if await cl_chats.find_one({"groupAvatar": file_id}, {"_id": 1}):
        return True
    return False


async def record_pending_file_deletion(file_id: str) -> None:
    await cl_pending_file_deletions.update_one(
        {"fileId": file_id},
        {"$inc": {"attempts": 1}, "$set": {"failedAt": utc_now()}},
        upsert=True,
    )


async def release_files(
    file_ids: set, excluded_message_ids: Optional[set] = None
) -> None:
    for file_id in {fid for fid in file_ids if _is_valid_file_id(fid)}:
        try:
            if await _file_still_referenced(file_id, excluded_message_ids):
                continue
            if await delete_file(file_id):
                await cl_pending_file_deletions.delete_one({"fileId": file_id})
            else:
                await record_pending_file_deletion(file_id)
        except Exception as e:
            print(f"File release warning for {file_id}: {e}")


async def retry_pending_file_deletions() -> None:
    async for record in cl_pending_file_deletions.find({}):
        file_id = str(record.get("fileId") or "")
        if not _is_valid_file_id(file_id):
            await cl_pending_file_deletions.delete_one({"_id": record["_id"]})
            continue
        try:
            if await _file_still_referenced(file_id):
                await cl_pending_file_deletions.delete_one({"_id": record["_id"]})
                continue
            if await delete_file(file_id):
                await cl_pending_file_deletions.delete_one({"_id": record["_id"]})
                continue
        except Exception as e:
            print(f"Pending file deletion retry warning for {file_id}: {e}")
        attempts = int(record.get("attempts") or 0) + 1
        if attempts >= 20:
            print(f"Dropping pending file deletion for {file_id} after {attempts} attempts")
            await cl_pending_file_deletions.delete_one({"_id": record["_id"]})
        else:
            await cl_pending_file_deletions.update_one(
                {"_id": record["_id"]},
                {"$set": {"attempts": attempts, "failedAt": utc_now()}},
            )


async def retry_pending_file_deletions_task() -> None:
    while True:
        try:
            await retry_pending_file_deletions()
        except Exception as e:
            print(f"Pending file deletion sweep warning: {e}")
        await asyncio.sleep(300)


async def sweep_orphaned_uploads() -> None:
    grace_hours = float(os.getenv("ORPHAN_GRACE_HOURS", "24"))
    dry_run = os.getenv("FILE_SWEEP_DRY_RUN", "true").lower().strip() not in (
        "false",
        "0",
        "no",
    )
    stored = await list_stored_files()
    cutoff = time.time() - grace_hours * 3600
    candidates = [
        file_id
        for file_id, mtime in stored.items()
        if mtime and mtime < cutoff and _is_valid_file_id(file_id)
    ]
    orphans: List[str] = []
    try:
        for start in range(0, len(candidates), 500):
            batch = candidates[start : start + 500]
            if not batch:
                continue
            referenced: set = set()
            url_values = [f"/files/{file_id}" for file_id in batch]
            async for row in cl_messages.find(
                {
                    "$or": [
                        {"file.fileId": {"$in": batch}},
                        {"file.previewFileId": {"$in": batch}},
                        {"file.coverArtFileId": {"$in": batch}},
                        {"file.previewUrl": {"$in": url_values}},
                        {"file.thumbUrl": {"$in": url_values}},
                        {"file.imagePreviewUrl": {"$in": url_values}},
                        {"file.coverArtUrl": {"$in": url_values}},
                    ]
                },
                {"file": 1},
            ):
                referenced |= collect_file_ids(row) & set(batch)
            referenced |= set(
                await cl_users.distinct(
                    "profile.avatar", {"profile.avatar": {"$in": batch}}
                )
            )
            referenced |= {
                value
                for value in await cl_chats.distinct(
                    "groupAvatar", {"groupAvatar": {"$in": batch}}
                )
                if value
            }
            orphans.extend(
                file_id for file_id in batch if file_id not in referenced
            )
    except Exception as e:
        print(f"Orphan file sweep skipped: {e}")
        return
    if dry_run:
        print(
            f"Orphan file sweep dry run: {len(orphans)} of {len(candidates)} candidates"
        )
        if orphans:
            print(f"Orphan file sweep dry run ids: {orphans[:100]}")
        return
    for file_id in orphans:
        try:
            await release_files({file_id})
        except Exception as e:
            print(f"Orphan file sweep warning for {file_id}: {e}")


async def sweep_orphaned_uploads_task() -> None:
    while True:
        try:
            await sweep_orphaned_uploads()
        except Exception as e:
            print(f"Orphan file sweep warning: {e}")
        await asyncio.sleep(86400)


async def jwt_encode_async(payload: dict) -> str:
    return await asyncio.to_thread(jwt.encode, payload, SECRET_KEY, algorithm=ALGORITHM)


async def jwt_decode_async(token: str) -> dict:
    return await asyncio.to_thread(
        jwt.decode, token, SECRET_KEY, algorithms=[ALGORITHM]
    )


async def bcrypt_checkpw_async(password: str, stored_hash: str) -> bool:
    pw = password.encode("utf-8")
    sh = stored_hash.encode("utf-8")
    return await asyncio.to_thread(bcrypt.checkpw, pw, sh)


class LoginRequest(BaseModel):
    identifier: Optional[str] = None
    email: Optional[str] = None
    password: str
    deviceName: Optional[str] = None


class TokenResponse(BaseModel):
    token: str
    user: dict


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None


class UserSearchResult(BaseModel):
    chatId: str
    username: str
    name: str
    avatar: str
    bio: str
    online: bool
    lastSeen: Optional[int] = None
    lastSeenCategory: Optional[str] = None
    verified: bool = False
    registrationDate: Optional[str] = None


class ChatCreateRequest(BaseModel):
    targetChatId: str


class GroupCreateRequest(BaseModel):
    name: str


class GroupUpdateRequest(BaseModel):
    name: Optional[str] = None
    avatar: Optional[str] = None


class GroupJoinRequest(BaseModel):
    inviteCode: str


class RegisterWithLinkRequest(BaseModel):
    token: str
    name: str
    username: str
    password: str
    deviceName: Optional[str] = None


class ValidateLinkRequest(BaseModel):
    token: str


class ConsumePasswordLinkRequest(BaseModel):
    token: str
    newPassword: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


class DeleteAccountRequest(BaseModel):
    password: str


class AdminDeleteUserRequest(BaseModel):
    confirmUsername: str


class VerifyUserRequest(BaseModel):
    verified: bool


class AdminLevelRequest(BaseModel):
    level: Optional[Literal["admin1"]] = None


class RegistrationStateRequest(BaseModel):
    open: bool


class AdminAISettingsRequest(BaseModel):
    enabled: bool = True
    dailyTokenLimit: int = Field(default=20000, ge=0, le=10_000_000)
    dailySearchLimit: int = Field(default=3, ge=0, le=10_000)
    dailyFileLimit: int = Field(default=5, ge=0, le=10_000)
    disabledMessage: str = Field(default=AI_DISABLED_DEFAULT_MESSAGE, max_length=AI_DISABLED_MESSAGE_MAX_LENGTH)


class AdminAIResetQuotaRequest(BaseModel):
    tokens: bool = False
    search: bool = False
    files: bool = False


class AdminUserAILimitsRequest(BaseModel):
    mode: Literal["global", "custom"] = "global"
    dailyTokenLimit: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    dailySearchLimit: Optional[int] = Field(default=None, ge=0, le=10_000)
    dailyFileLimit: Optional[int] = Field(default=None, ge=0, le=10_000)


ALLOWED_LINK_TTL_MINUTES = {30, 60, 180, 360, 720, 1440}


class CreateLinkRequest(BaseModel):
    expiresInMinutes: int = 30


class ReactionRequest(BaseModel):
    emoji: str


class ForwardBatchItem(BaseModel):
    messageId: str
    encryptedText: Optional[str] = None
    encryptedReasoningContent: Optional[str] = None
    encryptedReplyText: Optional[str] = None
    encryptedSearchSources: Optional[str] = None
    clientId: Optional[str] = None


class ForwardMessageRequest(BaseModel):
    messageId: Optional[str] = None
    targetChatId: str
    encryptedText: Optional[str] = None
    encryptedReasoningContent: Optional[str] = None
    encryptedReplyText: Optional[str] = None
    encryptedSearchSources: Optional[str] = None
    clientId: Optional[str] = None
    items: Optional[List[ForwardBatchItem]] = None


class BatchDeleteMessagesRequest(BaseModel):
    messageIds: List[str]


class OfficialChSendRequest(BaseModel):
    text: str
    replyToId: Optional[str] = None
    file: Optional[dict] = None


class OfficialChEditRequest(BaseModel):
    text: str


async def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = utc_now() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "jti": secrets.token_urlsafe(24)})
    return await jwt_encode_async(to_encode)


def hash_access_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def normalize_device_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:120]


def normalize_ip_address(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:64]


def extract_client_ip(request: Optional[Request]) -> str:
    if not request:
        return ""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = str(forwarded).split(",")[0].strip()
        if first:
            return normalize_ip_address(first)
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return normalize_ip_address(real_ip)
    client = getattr(request, "client", None)
    host = getattr(client, "host", "") if client else ""
    return normalize_ip_address(host)


def _normalize_session_list(user_doc: dict) -> List[dict]:
    login = (user_doc or {}).get("login") or {}
    sessions = login.get("sessions") or []
    if not isinstance(sessions, list):
        sessions = []
    now = utc_now()
    inactivity_cutoff = now - timedelta(days=SESSION_INACTIVITY_EXPIRE_DAYS)
    valid_sessions: List[dict] = []
    for item in sessions:
        if not isinstance(item, dict):
            continue
        token_hash = str(item.get("tokenHash") or "").strip()
        if not token_hash:
            continue
        expires_at = item.get("expiresAt")
        if isinstance(expires_at, datetime):
            exp_dt = (
                expires_at
                if expires_at.tzinfo
                else expires_at.replace(tzinfo=timezone.utc)
            )
            if exp_dt <= now:
                continue
        last_used_at = item.get("lastUsedAt")
        if isinstance(last_used_at, datetime):
            last_used_dt = (
                last_used_at
                if last_used_at.tzinfo
                else last_used_at.replace(tzinfo=timezone.utc)
            )
        else:
            created_at = item.get("createdAt")
            if isinstance(created_at, datetime):
                last_used_dt = (
                    created_at
                    if created_at.tzinfo
                    else created_at.replace(tzinfo=timezone.utc)
                )
            else:
                last_used_dt = now
        if last_used_dt <= inactivity_cutoff:
            continue
        valid_sessions.append(
            {
                "tokenHash": token_hash,
                "createdAt": item.get("createdAt") or now,
                "lastUsedAt": last_used_dt,
                "expiresAt": expires_at,
                "deviceName": normalize_device_name(item.get("deviceName")),
                "ipAddress": normalize_ip_address(item.get("ipAddress")),
            }
        )
    valid_sessions.sort(key=lambda s: dt_to_epoch_ms(s.get("createdAt")), reverse=True)
    return valid_sessions[:MAX_ACTIVE_SESSIONS]


def _normalize_login_events(user_doc: dict) -> List[dict]:
    login = (user_doc or {}).get("login") or {}
    events = login.get("loginEvents") or []
    if not isinstance(events, list):
        events = []
    normalized: List[dict] = []
    for item in events:
        if not isinstance(item, dict):
            continue
        token_hash = str(item.get("tokenHash") or "").strip()
        created_at = item.get("createdAt")
        if not token_hash or not isinstance(created_at, datetime):
            continue
        normalized.append(
            {
                "tokenHash": token_hash,
                "deviceName": normalize_device_name(item.get("deviceName")),
                "ipAddress": normalize_ip_address(item.get("ipAddress")),
                "createdAt": (
                    created_at
                    if created_at.tzinfo
                    else created_at.replace(tzinfo=timezone.utc)
                ),
                "seenBy": [
                    str(h).strip() for h in (item.get("seenBy") or []) if str(h).strip()
                ],
            }
        )
    normalized.sort(key=lambda e: dt_to_epoch_ms(e.get("createdAt")), reverse=True)
    return normalized[:MAX_LOGIN_EVENTS]


async def attach_session_to_user(
    chat_id: str, token: str, device_name: str = "", ip_address: str = ""
):
    user = await cl_users.find_one({"chatId": chat_id}, {"login": 1})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    payload = await jwt_decode_async(token)
    exp_ts = payload.get("exp")
    if isinstance(exp_ts, (int, float)):
        expires_at = datetime.fromtimestamp(float(exp_ts), tz=timezone.utc)
    else:
        expires_at = utc_now() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    sessions = _normalize_session_list(user)
    current_hash = hash_access_token(token)
    now = utc_now()
    sessions.insert(
        0,
        {
            "tokenHash": current_hash,
            "createdAt": now,
            "lastUsedAt": now,
            "expiresAt": expires_at,
            "deviceName": normalize_device_name(device_name),
            "ipAddress": normalize_ip_address(ip_address),
        },
    )
    deduped: List[dict] = []
    seen_hashes = set()
    for item in sessions:
        h = item["tokenHash"]
        if h in seen_hashes:
            continue
        seen_hashes.add(h)
        deduped.append(item)
        if len(deduped) >= MAX_ACTIVE_SESSIONS:
            break
    login_events = _normalize_login_events(user)
    login_events.insert(
        0,
        {
            "tokenHash": current_hash,
            "deviceName": normalize_device_name(device_name),
            "ipAddress": normalize_ip_address(ip_address),
            "createdAt": now,
            "seenBy": [current_hash],
        },
    )
    login_events = login_events[:MAX_LOGIN_EVENTS]
    await cl_users.update_one(
        {"chatId": chat_id},
        {
            "$set": {
                "login.sessions": deduped,
                "login.loginEvents": [
                    {
                        **evt,
                        "seenBy": list(set(evt.get("seenBy") or [])),
                    }
                    for evt in login_events
                ],
            },
            "$unset": {"login.token": ""},
        },
    )


async def get_user_from_session_token(token: str) -> Optional[dict]:
    try:
        payload = await jwt_decode_async(token)
    except Exception:
        return None
    chat_id = payload.get("chatId")
    if not chat_id:
        return None
    user = await cl_users.find_one({"chatId": chat_id})
    if not user:
        return None
    if is_purging(user):
        return None

    raw_sessions = (user.get("login") or {}).get("sessions") or []
    if not isinstance(raw_sessions, list):
        raw_sessions = []
    token_hash = hash_access_token(token)
    sessions = _normalize_session_list(user)
    if len(sessions) != len(raw_sessions):
        await cl_users.update_one(
            {"chatId": chat_id},
            {"$set": {"login.sessions": sessions}, "$unset": {"login.token": ""}},
        )
    if any(s.get("tokenHash") == token_hash for s in sessions):
        await cl_users.update_one(
            {"chatId": chat_id, "login.sessions.tokenHash": token_hash},
            {"$set": {"login.sessions.$.lastUsedAt": utc_now()}},
        )
        return user

    legacy_token = ((user.get("login") or {}).get("token") or "").strip()
    if legacy_token and legacy_token == token:
        await attach_session_to_user(chat_id, token)
        return await cl_users.find_one({"chatId": chat_id})
    return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_user_from_session_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    user["_session_token"] = credentials.credentials
    user.setdefault("profile", {})
    user["profile"]["bio"] = decrypt_user_bio(user, credentials.credentials)
    user["online"] = resolve_user_online_state(user)
    return user


OWNER_USERNAME = os.getenv("ADMIN0_USERNAME", "").strip()
LINK_TTL = timedelta(minutes=30)


def get_admin_level(user: dict) -> Optional[str]:
    username = str((user.get("profile") or {}).get("username") or "")
    if username.lower() == OWNER_USERNAME.lower():
        return "admin0"
    level = user.get("adminLevel")
    return level if level == "admin1" else None


def can_manage_group(user: dict, chat: dict) -> bool:
    if get_admin_level(user) is not None:
        return True
    return str(chat.get("createdBy") or "") == str(user.get("chatId") or "")


async def require_admin0(current_user: dict = Depends(get_current_user)):
    if get_admin_level(current_user) != "admin0":
        raise HTTPException(status_code=403, detail="Forbidden")
    return current_user


async def require_admin(current_user: dict = Depends(get_current_user)):
    if get_admin_level(current_user) is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    return current_user


def link_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def is_registration_open() -> bool:
    doc = await cl_app_settings.find_one({"_id": "registration"})
    if not doc:
        return True
    return bool(doc.get("open", True))


def _coerce_non_negative_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed >= 0 else fallback
    except (TypeError, ValueError):
        return fallback


def _coerce_ai_disabled_message(value: Any) -> str:
    text = str(value or "").strip()
    return text[:AI_DISABLED_MESSAGE_MAX_LENGTH] if text else AI_DISABLED_DEFAULT_MESSAGE


async def get_ai_settings() -> Dict[str, Any]:
    doc = await cl_app_settings.find_one({"_id": "ai"})
    if not isinstance(doc, dict):
        return {
            "enabled": True,
            "dailyTokenLimit": AI_DAILY_TOKEN_LIMIT,
            "dailySearchLimit": AI_DAILY_SEARCH_LIMIT,
            "dailyFileLimit": AI_DAILY_FILE_LIMIT,
            "disabledMessage": AI_DISABLED_DEFAULT_MESSAGE,
        }
    return {
        "enabled": bool(doc.get("enabled", True)),
        "dailyTokenLimit": _coerce_non_negative_int(doc.get("dailyTokenLimit"), AI_DAILY_TOKEN_LIMIT),
        "dailySearchLimit": _coerce_non_negative_int(doc.get("dailySearchLimit"), AI_DAILY_SEARCH_LIMIT),
        "dailyFileLimit": _coerce_non_negative_int(doc.get("dailyFileLimit"), AI_DAILY_FILE_LIMIT),
        "disabledMessage": _coerce_ai_disabled_message(doc.get("disabledMessage")),
    }


def resolve_user_ai_limits(user_doc: Optional[Dict[str, Any]], global_settings: Dict[str, Any]) -> Dict[str, Any]:
    raw_limits = (user_doc or {}).get("aiLimits")
    if isinstance(raw_limits, dict) and raw_limits.get("mode") == "custom":
        return {
            "mode": "custom",
            "dailyTokenLimit": _coerce_non_negative_int(raw_limits.get("dailyTokenLimit"), global_settings["dailyTokenLimit"]),
            "dailySearchLimit": _coerce_non_negative_int(raw_limits.get("dailySearchLimit"), global_settings["dailySearchLimit"]),
            "dailyFileLimit": _coerce_non_negative_int(raw_limits.get("dailyFileLimit"), global_settings["dailyFileLimit"]),
        }
    return {
        "mode": "global",
        "dailyTokenLimit": global_settings["dailyTokenLimit"],
        "dailySearchLimit": global_settings["dailySearchLimit"],
        "dailyFileLimit": global_settings["dailyFileLimit"],
    }


async def is_ai_enabled_for_user(user_doc: Optional[Dict[str, Any]], global_settings: Optional[Dict[str, Any]] = None) -> bool:
    if user_doc and get_admin_level(user_doc) == "admin0":
        return True
    settings = global_settings or await get_ai_settings()
    return bool(settings.get("enabled", True))


async def consume_link(collection, token: str) -> Optional[dict]:
    value = str(token or "").strip()
    if not value or len(value) > 128:
        return None
    return await collection.find_one_and_update(
        {"tokenHash": link_hash(value), "usedAt": None, "expiresAt": {"$gt": utc_now()}},
        {"$set": {"usedAt": utc_now()}},
        return_document=ReturnDocument.AFTER,
    )


async def release_link(collection, doc: dict) -> None:
    if not doc:
        return
    await collection.update_one(
        {"_id": doc["_id"], "usedAt": doc.get("usedAt")},
        {"$set": {"usedAt": None}},
    )


def dt_to_utc_iso(dt: Any) -> str:
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    return str(dt or "")


async def create_register_link(
    created_by: str, created_by_username: str = "", ttl_minutes: int = 30
) -> dict:
    minutes = ttl_minutes if ttl_minutes in ALLOWED_LINK_TTL_MINUTES else 30
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(minutes=minutes)
    result = await cl_register_links.insert_one(
        {
            "token": token,
            "tokenHash": link_hash(token),
            "createdBy": created_by,
            "createdByUsername": created_by_username,
            "createdAt": utc_now(),
            "expiresAt": expires_at,
            "usedAt": None,
            "usedBy": None,
        }
    )
    return {
        "id": str(result.inserted_id),
        "token": token,
        "expiresAt": dt_to_utc_iso(expires_at),
        "path": f"/register/{token}",
        "createdByUsername": created_by_username,
    }


async def create_password_link(
    target_chat_id: str, created_by: str, ttl_minutes: int = 30
) -> dict:
    minutes = ttl_minutes if ttl_minutes in ALLOWED_LINK_TTL_MINUTES else 30
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(minutes=minutes)
    await cl_password_links.delete_many({"targetChatId": target_chat_id, "usedAt": None})
    await cl_password_links.insert_one(
        {
            "tokenHash": link_hash(token),
            "targetChatId": target_chat_id,
            "createdBy": created_by,
            "createdAt": utc_now(),
            "expiresAt": expires_at,
            "usedAt": None,
        }
    )
    return {
        "token": token,
        "expiresAt": dt_to_utc_iso(expires_at),
        "path": f"/reset-password/{token}",
    }


async def clear_user_sessions(chat_id: str) -> None:
    await cl_users.update_one(
        {"chatId": chat_id},
        {"$set": {"login.sessions": []}, "$unset": {"login.token": ""}},
    )
    await _sync_login_seen_by_with_sessions(chat_id, [])
    for ws in list(active_connections.get(chat_id, [])):
        try:
            await ws.close(code=1008)
        except Exception:
            pass
    active_connections.pop(chat_id, None)
    for ws in list(active_ai_connections.get(chat_id, [])):
        try:
            await ws.close(code=1008)
        except Exception:
            pass
    active_ai_connections.pop(chat_id, None)
    await cl_users.update_one(
        {"chatId": chat_id}, {"$set": {"online": False, "wsConnectionCount": 0}}
    )


NOT_PURGING = {"deletion.status": {"$ne": "purging"}}


def is_purging(user: Optional[dict]) -> bool:
    return ((user or {}).get("deletion") or {}).get("status") == "purging"


def deletion_scheduled_for_ms(user: dict) -> Optional[int]:
    deletion = (user or {}).get("deletion") or {}
    if deletion.get("status") != "scheduled":
        return None
    return dt_to_epoch_ms(deletion.get("scheduledFor")) if deletion.get("scheduledFor") else None


security_optional = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
) -> Optional[dict]:
    if not credentials or not credentials.credentials:
        return None
    user = await get_user_from_session_token(credentials.credentials)
    if not user:
        return None
    user["_session_token"] = credentials.credentials
    user.setdefault("profile", {})
    user["profile"]["bio"] = decrypt_user_bio(user, credentials.credentials)
    user["online"] = resolve_user_online_state(user)
    return user


async def _sync_login_seen_by_with_sessions(
    chat_id: str, sessions: List[dict], login_events: Optional[List[dict]] = None
) -> None:
    allowed_hashes = {
        str(item.get("tokenHash") or "").strip() for item in (sessions or [])
    }
    allowed_hashes = {h for h in allowed_hashes if h}

    if login_events is None:
        user_doc = await cl_users.find_one({"chatId": chat_id}, {"login": 1})
        login_events = _normalize_login_events(user_doc or {})

    cleaned_events: List[dict] = []
    changed = False
    for event in login_events or []:
        current_seen = [
            str(h).strip() for h in (event.get("seenBy") or []) if str(h).strip()
        ]
        filtered_seen = []
        seen_unique = set()
        for h in current_seen:
            if h not in allowed_hashes or h in seen_unique:
                continue
            seen_unique.add(h)
            filtered_seen.append(h)
        if filtered_seen != current_seen:
            changed = True
        cleaned_events.append({**event, "seenBy": filtered_seen})

    if changed:
        await cl_users.update_one(
            {"chatId": chat_id},
            {
                "$set": {"login.loginEvents": cleaned_events},
                "$unset": {"login.token": ""},
            },
        )


@app.post("/auth/logout")
@limiter.limit("40/minute;100/hour")
async def logout(
    request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)
):
    user = await get_user_from_session_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    token_hash = hash_access_token(credentials.credentials)
    sessions = _normalize_session_list(user)
    next_sessions = [s for s in sessions if s.get("tokenHash") != token_hash]

    await cl_users.update_one(
        {"chatId": user["chatId"]},
        {"$set": {"login.sessions": next_sessions}, "$unset": {"login.token": ""}},
    )
    await _sync_login_seen_by_with_sessions(user["chatId"], next_sessions)
    await cl_push_subscriptions.delete_many(
        {"userId": user["chatId"], "tokenHash": token_hash}
    )
    user_id = user["chatId"]
    for ws in list(active_connections.get(user_id, [])):
        try:
            await ws.close(code=1008)
        except Exception:
            pass
    active_connections.pop(user_id, None)

    for ws in list(active_ai_connections.get(user_id, [])):
        try:
            await ws.close(code=1008)
        except Exception:
            pass
    active_ai_connections.pop(user_id, None)

    await cl_users.update_one(
        {"chatId": user_id}, {"$set": {"online": False, "wsConnectionCount": 0}}
    )
    user_chats = await cl_chats.find({"participants": user_id}).to_list(None)
    contacts_to_notify = set()
    for chat in user_chats:
        for p in chat.get("participants", []):
            if p != user_id:
                contacts_to_notify.add(p)
    allowed_contacts = await _filter_recipients_by_block_status(
        user_id, contacts_to_notify
    )
    allowed_contacts = await _filter_recipients_by_presence_visibility(
        user_id, allowed_contacts
    )
    await broadcast(
        allowed_contacts,
        {"type": "user_status", "userId": user_id, "online": False},
    )
    return {"message": "Logged out"}


def serialize_session_for_client(
    session: Dict[str, Any], current_token_hash: str
) -> Dict[str, Any]:
    token_hash = str(session.get("tokenHash") or "")
    return {
        "tokenHash": token_hash,
        "deviceName": normalize_device_name(session.get("deviceName")) or None,
        "ipAddress": normalize_ip_address(session.get("ipAddress")) or None,
        "createdAt": dt_to_epoch_ms(session.get("createdAt")),
        "lastUsedAt": dt_to_epoch_ms(session.get("lastUsedAt")),
        "current": bool(current_token_hash and token_hash == current_token_hash),
    }


@app.get("/auth/sessions")
@limiter.limit("100/minute;2000/hour")
async def list_sessions(
    request: Request, current_user: dict = Depends(get_current_user)
):
    token = str(current_user.get("_session_token") or "")
    token_hash = hash_access_token(token) if token else ""
    sessions = _normalize_session_list(current_user)
    serialized = [serialize_session_for_client(item, token_hash) for item in sessions]
    serialized.sort(
        key=lambda item: (
            0 if item.get("current") else 1,
            -int(item.get("lastUsedAt") or 0),
        )
    )
    return {"sessions": serialized}


@app.delete("/auth/sessions/{token_hash}")
@limiter.limit("30/minute;100/hour")
async def revoke_single_session(
    request: Request, token_hash: str, current_user: dict = Depends(get_current_user)
):
    my_token = str(current_user.get("_session_token") or "")
    my_hash = hash_access_token(my_token) if my_token else ""
    target_hash = str(token_hash or "").strip()
    if not target_hash:
        raise HTTPException(status_code=400, detail="Invalid session token hash")
    if target_hash == my_hash:
        raise HTTPException(status_code=400, detail="Cannot revoke current session")

    sessions = _normalize_session_list(current_user)
    next_sessions = [
        s for s in sessions if str(s.get("tokenHash") or "") != target_hash
    ]
    await cl_users.update_one(
        {"chatId": current_user["chatId"]},
        {"$set": {"login.sessions": next_sessions}, "$unset": {"login.token": ""}},
    )
    await _sync_login_seen_by_with_sessions(current_user["chatId"], next_sessions)
    return {"ok": True}


@app.post("/auth/sessions/revoke-others")
@limiter.limit("20/minute;100/hour")
async def revoke_other_sessions(
    request: Request, current_user: dict = Depends(get_current_user)
):
    my_token = str(current_user.get("_session_token") or "")
    my_hash = hash_access_token(my_token) if my_token else ""
    sessions = _normalize_session_list(current_user)
    keep = [s for s in sessions if str(s.get("tokenHash") or "") == my_hash]
    await cl_users.update_one(
        {"chatId": current_user["chatId"]},
        {"$set": {"login.sessions": keep}, "$unset": {"login.token": ""}},
    )
    await _sync_login_seen_by_with_sessions(current_user["chatId"], keep)
    return {"ok": True}


@app.get("/auth/login-events")
@limiter.limit("100/minute;2000/hour")
async def list_login_events(
    request: Request, current_user: dict = Depends(get_current_user)
):
    token = str(current_user.get("_session_token") or "")
    my_hash = hash_access_token(token) if token else ""
    events = _normalize_login_events(current_user)
    unseen_count = 0
    serialized_events = []
    for e in events:
        seen_by = {str(h).strip() for h in (e.get("seenBy") or []) if str(h).strip()}
        unseen_for_current = bool(my_hash) and (my_hash not in seen_by)
        if unseen_for_current:
            unseen_count += 1
        serialized_events.append(
            {
                "tokenHash": str(e.get("tokenHash") or ""),
                "deviceName": normalize_device_name(e.get("deviceName")) or None,
                "ipAddress": normalize_ip_address(e.get("ipAddress")) or None,
                "createdAt": dt_to_epoch_ms(e.get("createdAt")),
                "isCurrentDevice": bool(
                    my_hash and str(e.get("tokenHash") or "") == my_hash
                ),
                "unseenForCurrent": unseen_for_current,
            }
        )
    return {
        "events": serialized_events,
        "unseenCount": unseen_count,
    }


@app.post("/auth/login-events/mark-seen")
@limiter.limit("100/minute;2000/hour")
async def mark_login_events_seen(
    request: Request, current_user: dict = Depends(get_current_user)
):
    token = str(current_user.get("_session_token") or "")
    my_hash = hash_access_token(token) if token else ""
    events = _normalize_login_events(current_user)
    next_events = []
    for e in events:
        seen_by = {str(h).strip() for h in (e.get("seenBy") or []) if str(h).strip()}
        if my_hash:
            seen_by.add(my_hash)
        next_events.append({**e, "seenBy": list(seen_by)})
    await cl_users.update_one(
        {"chatId": current_user["chatId"]},
        {"$set": {"login.loginEvents": next_events}},
    )
    return {"ok": True}


def get_chat_id_for_two(part1: str, part2: str) -> str:
    sorted_ids = sorted([part1, part2])
    return f"chat_{sorted_ids[0]}_{sorted_ids[1]}"


def get_saved_messages_id(user_id: str) -> str:
    return f"saved_messages_{user_id}"


def build_group_invite_link(invite_code: str) -> str:
    return f"novaroom://group/{invite_code}"


def _get_pinned_from_user_doc(user: dict) -> List[str]:
    ids = ((user or {}).get("settings") or {}).get("pinnedChatIds") or []
    if not isinstance(ids, list):
        return []

    out: List[str] = []
    seen = set()
    for x in ids:
        if not isinstance(x, str):
            continue
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
        if len(out) >= MAX_PINNED_CHATS:
            break
    return out


def _get_blocked_from_user_doc(user: dict) -> List[str]:
    ids = ((user or {}).get("settings") or {}).get("blockedChatIds") or []
    if not isinstance(ids, list):
        return []

    out: List[str] = []
    seen = set()
    for x in ids:
        if not isinstance(x, str):
            continue
        cid = x.strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out.append(cid)
    return out


async def _is_direct_blocked_between(user_a: str, user_b: str) -> bool:
    rows = await cl_users.find(
        {"chatId": {"$in": [user_a, user_b]}},
        {"chatId": 1, "settings.blockedChatIds": 1},
    ).to_list(2)
    by_id = {str(r.get("chatId")): r for r in rows}
    a_doc = by_id.get(user_a) or {}
    b_doc = by_id.get(user_b) or {}
    a_blocked = set(_get_blocked_from_user_doc(a_doc))
    b_blocked = set(_get_blocked_from_user_doc(b_doc))
    return user_b in a_blocked or user_a in b_blocked


async def _filter_recipients_by_block_status(
    actor_id: str, candidate_ids: Iterable[str]
) -> List[str]:
    unique_candidates = [str(cid or "").strip() for cid in candidate_ids]
    unique_candidates = [cid for cid in unique_candidates if cid and cid != actor_id]
    if not unique_candidates:
        return []

    rows = await cl_users.find(
        {"chatId": {"$in": [actor_id, *unique_candidates]}},
        {"chatId": 1, "settings.blockedChatIds": 1},
    ).to_list(len(unique_candidates) + 1)

    by_id = {str(r.get("chatId")): r for r in rows}
    actor_blocked = set(_get_blocked_from_user_doc(by_id.get(actor_id) or {}))

    allowed: List[str] = []
    for cid in unique_candidates:
        cand_blocked = set(_get_blocked_from_user_doc(by_id.get(cid) or {}))
        if cid in actor_blocked or actor_id in cand_blocked:
            continue
        allowed.append(cid)
    return allowed


async def _filter_recipients_by_presence_visibility(
    actor_id: str, candidate_ids: Iterable[str]
) -> List[str]:
    unique_candidates = [str(cid or "").strip() for cid in candidate_ids]
    unique_candidates = [cid for cid in unique_candidates if cid and cid != actor_id]
    if not unique_candidates:
        return []

    actor = await cl_users.find_one({"chatId": actor_id}, {"settings": 1})
    visibility = privacy_visibility((actor or {}).get("settings"), "lastSeenVisibility")
    if visibility == "everyone":
        return unique_candidates
    if visibility == "nobody":
        return []

    allowed_flags = await asyncio.gather(
        *(has_mutual_interaction(actor_id, cid) for cid in unique_candidates),
        return_exceptions=True,
    )
    return [
        cid
        for cid, allowed in zip(unique_candidates, allowed_flags)
        if allowed is True
    ]


def _user_can_pin_chat(user_id: str, chat_id: str) -> bool:
    if chat_id == get_saved_messages_id(user_id):
        return True
    if is_official_channel_chat(chat_id):
        return True
    return isinstance(chat_id, str) and (
        chat_id.startswith("chat_") or chat_id.startswith("grp_")
    )


async def _extend_purge_lease(user_id: str) -> None:
    await cl_users.update_one(
        {"chatId": user_id, "deletion.status": "purging"},
        {
            "$set": {
                "deletion.leaseUntil": utc_now()
                + timedelta(seconds=ACCOUNT_DELETION_LEASE_SECONDS)
            }
        },
    )


async def _purge_messages(query: Dict[str, Any], user_id: str) -> None:
    while True:
        rows = (
            await cl_messages.find(query, {"_id": 1, "file": 1})
            .limit(ACCOUNT_PURGE_BATCH)
            .to_list(ACCOUNT_PURGE_BATCH)
        )
        if not rows:
            return
        file_ids: set = set()
        for row in rows:
            file_ids |= collect_file_ids(row)
        for file_id in file_ids:
            await record_pending_file_deletion(file_id)
        await cl_messages.delete_many({"_id": {"$in": [row["_id"] for row in rows]}})
        await release_files(file_ids)
        await _extend_purge_lease(user_id)


async def _drop_chess_game(game_id: str) -> None:
    handle = chess_timers.pop(game_id, None)
    if handle:
        handle.cancel()
    for key in [k for k in chess_abandon_tasks if k.startswith(f"{game_id}:")]:
        task = chess_abandon_tasks.pop(key, None)
        if task:
            task.cancel()
    chess_locks.pop(game_id, None)
    chess_latency.pop(game_id, None)
    sockets = [ws for conns in chess_rooms.pop(game_id, {}).values() for ws in conns]
    await cl_chess_games.delete_one({"_id": game_id})
    for ws in sockets:
        try:
            await ws.close(code=1008)
        except Exception:
            pass


async def _purge_user_chess(user_id: str) -> None:
    games = await cl_chess_games.find(
        {
            "$or": [
                {"players.white": user_id},
                {"players.black": user_id},
                {"creatorId": user_id},
                {"invitedChatId": user_id},
            ]
        }
    ).to_list(None)
    for game in games:
        game_id = str(game.get("_id"))
        players = game.get("players") or {}
        white = players.get("white")
        black = players.get("black")
        guest_involved = any(
            chess_service.is_guest_id(value)
            for value in (white, black, game.get("guestId"))
            if value
        )
        status = game.get("status")
        if status == "finished" and not guest_involved:
            continue
        if status == "active" and not guest_involved and chess_service.color_of(game, user_id):
            try:
                await chess_run(
                    game_id, lambda g, n: chess_service.resign(g, user_id, n)
                )
                continue
            except ChessError:
                pass
        await _drop_chess_game(game_id)


async def run_account_purge(user_id: str) -> None:
    now = utc_now()
    claimed = await cl_users.find_one_and_update(
        {
            "chatId": user_id,
            "deletion.status": "purging",
            "$or": [{"deletion.leaseUntil": None}, {"deletion.leaseUntil": {"$lt": now}}],
        },
        {
            "$set": {
                "deletion.leaseUntil": now
                + timedelta(seconds=ACCOUNT_DELETION_LEASE_SECONDS)
            },
            "$inc": {"deletion.attempts": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return

    try:
        task = active_ai_stream_tasks.pop(user_id, None)
        if task:
            task.cancel()
        await clear_user_sessions(user_id)
        await _extend_purge_lease(user_id)

        await _purge_user_chess(user_id)
        await _extend_purge_lease(user_id)

        dm_chats = await cl_chats.find(
            {"participants": user_id, "chatType": {"$ne": "group"}}, {"_id": 1}
        ).to_list(None)
        dm_chat_ids = [str(chat["_id"]) for chat in dm_chats]

        message_query: Dict[str, Any] = {"$or": [{"senderId": user_id}]}
        if dm_chat_ids:
            message_query = {
                "$or": [
                    {"chatId": {"$in": dm_chat_ids}},
                    {"senderId": user_id},
                ]
            }
        await _purge_messages(message_query, user_id)

        await cl_messages.update_many(
            {"reactions.userId": user_id},
            {"$pull": {"reactions": {"userId": user_id}}},
        )
        await cl_messages.update_many(
            {"seenBy": user_id}, {"$pull": {"seenBy": user_id}}
        )
        await cl_messages.update_many(
            {"replyTo.senderId": user_id}, {"$unset": {"replyTo": ""}}
        )
        await cl_messages.update_many(
            {"forwardedFrom.originalSenderId": user_id},
            {"$unset": {"forwardedFrom": ""}},
        )
        await cl_chats.update_many(
            {"pinnedMessage.senderId": user_id}, {"$unset": {"pinnedMessage": ""}}
        )
        last_message_chats = await cl_chats.find(
            {"lastMessage.senderId": user_id}, {"_id": 1}
        ).to_list(None)
        for chat in last_message_chats:
            await cl_chats.update_one(
                {"_id": chat["_id"]},
                {"$set": {"lastMessage": await build_last_message(str(chat["_id"]))}},
            )
        await _extend_purge_lease(user_id)

        await cl_chats.delete_many(
            {"_id": {"$in": dm_chat_ids}, "chatType": {"$ne": "group"}}
        )

        groups = await cl_chats.find(
            {"chatType": "group", "participants": user_id}
        ).to_list(None)
        for group in groups:
            group_id = str(group["_id"])
            remaining = [
                p for p in (group.get("participants") or []) if p != user_id
            ]
            if not remaining:
                await _purge_messages({"chatId": group_id}, user_id)
                await cl_chats.delete_one({"_id": group_id})
                continue
            update: Dict[str, Any] = {
                "$pull": {"participants": user_id},
                "$set": {"updatedAt": utc_now()},
            }
            if group.get("createdBy") == user_id:
                update["$set"]["createdBy"] = remaining[0]
            await cl_chats.update_one({"_id": group_id}, update)

        await cl_users.update_many(
            {"settings.blockedChatIds": user_id},
            {"$pull": {"settings.blockedChatIds": user_id}},
        )
        if dm_chat_ids:
            await cl_users.update_many(
                {"settings.pinnedChatIds": {"$in": dm_chat_ids}},
                {"$pullAll": {"settings.pinnedChatIds": dm_chat_ids}},
            )
        await _extend_purge_lease(user_id)

        await cl_ai_messages.delete_many({"userId": user_id})
        await cl_ai_chats.delete_many({"userId": user_id})
        await cl_ai_memories.delete_many({"userId": user_id})
        await cl_ai_usage.delete_many({"userId": user_id})
        async for row in cl_ai_temp_files.find({"userId": user_id}):
            try:
                await delete_ai_temp_file(Path(str(row.get("filePath") or "")).name)
            except Exception as e:
                print(f"AI temp file purge warning: {e}")
        await cl_ai_temp_files.delete_many({"userId": user_id})
        await cl_push_subscriptions.delete_many({"userId": user_id})

        await cl_register_links.delete_many({"createdBy": user_id})
        await cl_password_links.delete_many(
            {"$or": [{"createdBy": user_id}, {"targetChatId": user_id}]}
        )
        await _extend_purge_lease(user_id)

        doc = await cl_users.find_one({"chatId": user_id}, {"profile.avatar": 1})
        await cl_users.delete_one({"chatId": user_id, "deletion.status": "purging"})
        avatar = _file_id_from_url(((doc or {}).get("profile") or {}).get("avatar"))
        if not avatar:
            raw_avatar = str(((doc or {}).get("profile") or {}).get("avatar") or "")
            if _is_valid_file_id(raw_avatar):
                avatar = raw_avatar
        if avatar:
            await release_files({avatar})
    except Exception as e:
        print(f"Account purge warning for {user_id}: {e}")


async def account_deletion_worker() -> None:
    while True:
        try:
            now = utc_now()
            await cl_users.update_many(
                {
                    "deletion.status": "scheduled",
                    "deletion.scheduledFor": {"$lte": now},
                },
                {
                    "$set": {
                        "deletion.status": "purging",
                        "deletion.startedAt": now,
                        "deletion.leaseUntil": None,
                        "deletion.attempts": 0,
                    }
                },
            )
            async for row in cl_users.find({"deletion.status": "purging"}, {"chatId": 1}):
                await run_account_purge(row["chatId"])
        except Exception as e:
            print(f"Account deletion worker warning: {e}")
        await asyncio.sleep(ACCOUNT_DELETION_POLL_SECONDS)


@app.on_event("startup")
async def startup_db():
    try:
        try:
            await cl_users.drop_index("login.email_1")
        except Exception:
            pass
        await asyncio.gather(
            cl_users.create_index("chatId", unique=True),
            cl_users.create_index(
                "login.email",
                unique=True,
                partialFilterExpression={"login.email": {"$type": "string"}},
                name="login_email_partial_unique",
            ),
            cl_register_links.create_index("tokenHash", unique=True),
            cl_register_links.create_index("expiresAt", expireAfterSeconds=86400),
            cl_password_links.create_index("tokenHash", unique=True),
            cl_password_links.create_index("expiresAt", expireAfterSeconds=86400),
            cl_users.create_index("login.sessions.tokenHash"),
            cl_users.create_index("profile.username", unique=True),
            cl_chats.create_index([("participants", 1)]),
            cl_chats.create_index([("updatedAt", -1)]),
            cl_messages.create_index("chatId"),
            cl_messages.create_index([("chatId", 1), ("timestamp", -1)]),
            cl_messages.create_index("file.fileId"),
            cl_messages.create_index("file.previewFileId"),
            cl_messages.create_index("file.coverArtFileId"),
            cl_users.create_index("profile.avatar"),
            cl_chats.create_index("groupAvatar"),
            cl_pending_file_deletions.create_index("fileId", unique=True),
            cl_ai_messages.create_index("userId"),
            cl_ai_messages.create_index(
                [("userId", 1), ("aiChatId", 1), ("timestamp", -1)]
            ),
            cl_ai_chats.create_index([("userId", 1), ("updatedAt", -1)]),
            cl_ai_memories.create_index([("userId", 1), ("updatedAt", -1)]),
            cl_ai_usage.create_index([("userId", 1), ("dateKey", 1)]),
            cl_ai_usage.create_index("updatedAt", expireAfterSeconds=2 * 86400),
            cl_chess_games.create_index("creatorId"),
            cl_chess_games.create_index([("players.white", 1), ("status", 1)]),
            cl_chess_games.create_index([("players.black", 1), ("status", 1)]),
            cl_chess_games.create_index("inviteToken", unique=True, sparse=True),
            cl_users.create_index([("chessStats.gamesPlayed", -1), ("chessStats.elo", -1)]),
            cl_users.create_index([("chessStats.elo", -1)]),
            cl_users.create_index("deletion.status", sparse=True),
            cl_users.create_index("deletion.scheduledFor", sparse=True),
            cl_messages.create_index("senderId"),
            cl_ai_temp_files.create_index("userId"),
            cl_push_subscriptions.create_index("userId"),
            return_exceptions=True,
        )
        AI_TEMP_DIR.mkdir(parents=True, exist_ok=True)
        await cl_users.update_many({}, {"$set": {"online": False, "wsConnectionCount": 0}})
        await cl_users.update_one(
            {"profile.username": {"$regex": f"^{re.escape(OWNER_USERNAME)}$", "$options": "i"}},
            {"$set": {"adminLevel": "admin0"}},
        )
        async for g in cl_chess_games.find({"status": {"$in": ["active", "waiting"]}}):
            chess_schedule(g)
    except Exception as e:
        print(f"Startup DB warning: {e}")
    asyncio.create_task(migrate_unencrypted_messages())
    asyncio.create_task(encrypt_existing_uploads())
    asyncio.create_task(sweep_ai_temp_files_task())
    asyncio.create_task(retry_pending_file_deletions_task())
    asyncio.create_task(sweep_orphaned_uploads_task())
    asyncio.create_task(chess_backfill_stats())
    asyncio.create_task(account_deletion_worker())


async def migrate_unencrypted_messages():
    async for m in cl_messages.find(
        {
            "$or": [
                {"textEncrypted": {"$ne": True}},
                {"text": {"$not": {"$regex": f"^{ENC_PREFIX}"}}},
            ]
        }
    ):
        chat_scope = f"chat:{m.get('chatId', '')}"
        updates: Dict[str, Any] = {"textEncrypted": True}
        txt = str(m.get("text") or "")
        if txt and not is_ciphertext(txt):
            updates["text"] = encrypt_scoped_text(
                txt, LEGACY_BOOTSTRAP_TOKEN, chat_scope
            )
        reply = m.get("replyTo")
        if isinstance(reply, dict):
            r_txt = str(reply.get("text") or "")
            if r_txt and not is_ciphertext(r_txt):
                updates["replyTo"] = {
                    **reply,
                    "text": encrypt_scoped_text(
                        r_txt, LEGACY_BOOTSTRAP_TOKEN, chat_scope
                    ),
                }
        reasoning = str(m.get("reasoningContent") or "")
        if reasoning and not is_ciphertext(reasoning):
            updates["reasoningContent"] = encrypt_scoped_text(
                reasoning, LEGACY_BOOTSTRAP_TOKEN, chat_scope
            )
        if updates:
            await cl_messages.update_one({"_id": m["_id"]}, {"$set": updates})

    async for m in cl_ai_messages.find(
        {
            "$or": [
                {"contentEncrypted": {"$ne": True}},
                {"content": {"$not": {"$regex": f"^{ENC_PREFIX}"}}},
            ]
        }
    ):
        ai_scope = f"ai:{m.get('aiChatId', '')}"
        updates = {"contentEncrypted": True}
        content = str(m.get("content") or "")
        if content and not is_ciphertext(content):
            updates["content"] = encrypt_scoped_text(
                content, LEGACY_BOOTSTRAP_TOKEN, ai_scope
            )
        reasoning = str(m.get("reasoningContent") or "")
        if reasoning and not is_ciphertext(reasoning):
            updates["reasoningContent"] = encrypt_scoped_text(
                reasoning, LEGACY_BOOTSTRAP_TOKEN, ai_scope
            )
        if updates:
            await cl_ai_messages.update_one({"_id": m["_id"]}, {"$set": updates})

    async for c in cl_ai_chats.find(
        {
            "$or": [
                {"titleEncrypted": {"$ne": True}},
                {"summaryEncrypted": {"$ne": True}},
                {"title": {"$not": {"$regex": f"^{ENC_PREFIX}"}}},
                {"summary": {"$not": {"$regex": f"^{ENC_PREFIX}"}}},
            ]
        }
    ):
        chat_id = str(c.get("_id"))
        scope = f"ai-chat-meta:{chat_id}"
        updates: Dict[str, Any] = {
            "titleEncrypted": True,
            "summaryEncrypted": True,
        }
        title = str(c.get("title") or "")
        summary = str(c.get("summary") or "")
        if title and not is_ciphertext(title):
            updates["title"] = encrypt_scoped_text(title, LEGACY_BOOTSTRAP_TOKEN, scope)
        if summary and not is_ciphertext(summary):
            updates["summary"] = encrypt_scoped_text(
                summary, LEGACY_BOOTSTRAP_TOKEN, scope
            )
        if updates:
            await cl_ai_chats.update_one({"_id": c["_id"]}, {"$set": updates})


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=200)
    auth: str = Field(..., min_length=1, max_length=100)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=1000)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=1000)


class NotificationSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    sound: Optional[bool] = None


class ChatNotifyModeUpdate(BaseModel):
    mode: Literal["all", "muted", "mentions"]


@app.get("/push/vapid-public-key")
@limiter.limit("60/minute")
async def get_vapid_public_key(request: Request):
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.post("/push/subscribe")
@limiter.limit("20/minute;200/hour")
async def push_subscribe(
    request: Request,
    body: PushSubscribeRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_user_from_session_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    endpoint = body.endpoint.strip()
    if not endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid endpoint")
    me = user["chatId"]
    sub_id = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()
    existing = await cl_push_subscriptions.find_one({"_id": sub_id}, {"_id": 1})
    count = await cl_push_subscriptions.count_documents({"userId": me})
    if not existing and count >= 20:
        oldest = (
            await cl_push_subscriptions.find({"userId": me}, {"_id": 1})
            .sort("updatedAt", 1)
            .limit(count - 19)
            .to_list(None)
        )
        if oldest:
            await cl_push_subscriptions.delete_many(
                {"_id": {"$in": [doc["_id"] for doc in oldest]}}
            )
    now = utc_now()
    await cl_push_subscriptions.update_one(
        {"_id": sub_id},
        {
            "$set": {
                "userId": me,
                "tokenHash": hash_access_token(credentials.credentials),
                "endpoint": endpoint,
                "keys": {"p256dh": body.keys.p256dh, "auth": body.keys.auth},
                "userAgent": str(request.headers.get("user-agent") or "")[:300],
                "updatedAt": now,
            },
            "$setOnInsert": {"createdAt": now},
        },
        upsert=True,
    )
    return {"ok": True}


@app.post("/push/unsubscribe")
@limiter.limit("20/minute")
async def push_unsubscribe(
    request: Request,
    body: PushUnsubscribeRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user = await get_user_from_session_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    sub_id = hashlib.sha256(body.endpoint.strip().encode("utf-8")).hexdigest()
    await cl_push_subscriptions.delete_one(
        {"_id": sub_id, "userId": user["chatId"]}
    )
    return {"ok": True}


@app.get("/profile/me/notifications")
@limiter.limit("100/minute;2000/hour")
async def get_notification_settings(
    request: Request, current_user: dict = Depends(get_current_user)
):
    return _notification_prefs(current_user)


@app.put("/profile/me/notifications")
@limiter.limit("30/minute")
async def update_notification_settings(
    request: Request,
    body: NotificationSettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    updates: Dict[str, Any] = {}
    if body.enabled is not None:
        updates["settings.notifications.enabled"] = bool(body.enabled)
    if body.sound is not None:
        updates["settings.notifications.sound"] = bool(body.sound)
    if updates:
        await cl_users.update_one({"chatId": me}, {"$set": updates})
    user = await cl_users.find_one({"chatId": me}, {"settings": 1})
    return _notification_prefs(user or {})


@app.put("/profile/me/notifications/chats/{chat_id}")
@limiter.limit("30/minute;300/hour")
async def update_chat_notify_mode(
    request: Request,
    chat_id: str,
    body: ChatNotifyModeUpdate,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    if not chat_id or "." in chat_id or chat_id.startswith("$"):
        raise HTTPException(status_code=400, detail="Invalid chatId")
    if chat_id == get_saved_messages_id(me):
        raise HTTPException(status_code=400, detail="Saved messages is not supported")
    chat = None
    if not is_official_channel_chat(chat_id):
        chat = await cl_chats.find_one(
            {"_id": chat_id}, {"participants": 1, "chatType": 1}
        )
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        if me not in (chat.get("participants") or []):
            raise HTTPException(status_code=403, detail="Forbidden")
    if body.mode == "mentions" and not (chat and chat.get("chatType") == "group"):
        raise HTTPException(
            status_code=400, detail="Mentions mode is only for groups"
        )
    if body.mode == "all":
        await cl_users.update_one(
            {"chatId": me}, {"$unset": {f"settings.chatNotifyModes.{chat_id}": ""}}
        )
    else:
        await cl_users.update_one(
            {"chatId": me},
            {"$set": {f"settings.chatNotifyModes.{chat_id}": body.mode}},
        )
    user = await cl_users.find_one({"chatId": me}, {"settings": 1})
    await broadcast([me], {"type": "notify_settings_changed"})
    return _notification_prefs(user or {})


@app.get("/profile/me/pins")
@limiter.limit("100/minute;2000/hour")
async def get_my_pins(request: Request, current_user: dict = Depends(get_current_user)):
    return {"pinnedChatIds": _get_pinned_from_user_doc(current_user)}


@app.post("/profile/me/pins/{chat_id}")
@limiter.limit("20/minute;300/hour")
async def pin_chat(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]

    if not _user_can_pin_chat(user_id, chat_id):
        raise HTTPException(status_code=400, detail="Invalid chatId")

    if chat_id != get_saved_messages_id(user_id) and not is_official_channel_chat(
        chat_id
    ):
        chat = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        if user_id not in (chat.get("participants", []) or []):
            raise HTTPException(status_code=403, detail="Forbidden")

    pinned = _get_pinned_from_user_doc(current_user)
    if chat_id in pinned:
        return {"pinnedChatIds": pinned}

    if len(pinned) >= MAX_PINNED_CHATS:
        raise HTTPException(status_code=400, detail="Max pinned chats reached")

    pinned = [chat_id, *pinned]

    await cl_users.update_one(
        {"chatId": user_id},
        {
            "$set": {
                "settings.pinnedChatIds": pinned,
                "settings.pinnedUpdatedAt": utc_now(),
            }
        },
    )

    user = await cl_users.find_one({"chatId": user_id}, {"settings": 1})
    return {"pinnedChatIds": _get_pinned_from_user_doc(user or {})}


@app.delete("/profile/me/pins/{chat_id}")
@limiter.limit("20/minute;300/hour")
async def unpin_chat(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]

    pinned = _get_pinned_from_user_doc(current_user)
    if chat_id not in pinned:
        return {"pinnedChatIds": pinned}

    pinned = [x for x in pinned if x != chat_id]

    await cl_users.update_one(
        {"chatId": user_id},
        {
            "$set": {
                "settings.pinnedChatIds": pinned,
                "settings.pinnedUpdatedAt": utc_now(),
            }
        },
    )

    user = await cl_users.find_one({"chatId": user_id}, {"settings": 1})
    return {"pinnedChatIds": _get_pinned_from_user_doc(user or {})}


@app.get("/profile/me/blocks")
@limiter.limit("100/minute;2000/hour")
async def get_my_blocks(
    request: Request, current_user: dict = Depends(get_current_user)
):
    return {"blockedChatIds": _get_blocked_from_user_doc(current_user)}


@app.post("/profile/me/blocks/{target_chat_id}")
@limiter.limit("20/minute;300/hour")
async def block_user(
    request: Request,
    target_chat_id: str,
    current_user: dict = Depends(get_current_user),
):
    my_id = str(current_user["chatId"])
    target_id = str(target_chat_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Invalid target chatId")
    if target_id == my_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    target_user = await cl_users.find_one({"chatId": target_id}, {"chatId": 1})
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")

    blocked = _get_blocked_from_user_doc(current_user)
    if target_id in blocked:
        return {"blockedChatIds": blocked}

    blocked.append(target_id)
    await cl_users.update_one(
        {"chatId": my_id},
        {
            "$set": {
                "settings.blockedChatIds": blocked,
                "settings.blockedUpdatedAt": utc_now(),
            }
        },
    )
    await broadcast(
        [my_id, target_id],
        {"type": "block_status_changed", "userId": my_id, "targetUserId": target_id},
    )
    user = await cl_users.find_one({"chatId": my_id}, {"settings": 1})
    return {"blockedChatIds": _get_blocked_from_user_doc(user or {})}


@app.delete("/profile/me/blocks/{target_chat_id}")
@limiter.limit("20/minute;300/hour")
async def unblock_user(
    request: Request,
    target_chat_id: str,
    current_user: dict = Depends(get_current_user),
):
    my_id = str(current_user["chatId"])
    target_id = str(target_chat_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="Invalid target chatId")

    blocked = _get_blocked_from_user_doc(current_user)
    if target_id not in blocked:
        return {"blockedChatIds": blocked}

    blocked = [x for x in blocked if x != target_id]
    await cl_users.update_one(
        {"chatId": my_id},
        {
            "$set": {
                "settings.blockedChatIds": blocked,
                "settings.blockedUpdatedAt": utc_now(),
            }
        },
    )
    await broadcast(
        [my_id, target_id],
        {"type": "block_status_changed", "userId": my_id, "targetUserId": target_id},
    )
    user = await cl_users.find_one({"chatId": my_id}, {"settings": 1})
    return {"blockedChatIds": _get_blocked_from_user_doc(user or {})}


@app.get("/auth/register-link/{token}")
@limiter.limit("30/minute")
async def validate_register_link(request: Request, token: str):
    value = str(token or "").strip()
    if not value or len(value) > 128:
        return {"valid": False}
    link = await cl_register_links.find_one(
        {"tokenHash": link_hash(value), "usedAt": None, "expiresAt": {"$gt": utc_now()}},
        {"_id": 1},
    )
    return {"valid": bool(link)}


@app.post("/auth/register", response_model=TokenResponse)
@limiter.limit("5/minute;20/hour")
async def register_with_link(req: RegisterWithLinkRequest, request: Request):
    name = str(req.name or "").strip()
    if not name or len(name) > 64:
        raise HTTPException(status_code=400, detail="Invalid name")

    desired_username = normalize_username(req.username)
    if not validate_username(desired_username):
        raise HTTPException(status_code=400, detail="Invalid username format")
    if desired_username.lower() == OWNER_USERNAME.lower():
        raise HTTPException(status_code=409, detail="Username already taken")
    if len(str(req.password or "")) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    link_doc = await consume_link(cl_register_links, req.token)
    if not link_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired link")

    existing_username = await cl_users.find_one(
        {
            "profile.username": {
                "$regex": f"^{re.escape(desired_username)}$",
                "$options": "i",
            }
        },
        {"_id": 1},
    )
    if existing_username:
        await release_link(cl_register_links, link_doc)
        raise HTTPException(status_code=409, detail="Username already taken")

    chat_id = f"user_{uuid.uuid4().hex[:16]}"

    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    hashed_password = await asyncio.to_thread(_hash_password, req.password)

    now_jalali = jdatetime.datetime.now()
    registration_date = f"{now_jalali.year}/{now_jalali.month}/{now_jalali.day}"

    user_doc = {
        "chatId": chat_id,
        "login": {"password": hashed_password, "sessions": []},
        "profile": {
            "name": name,
            "username": desired_username,
            "bio": "",
            "bioEncrypted": False,
            "avatar": "",
        },
        "online": False,
        "verified": False,
        "registrationDate": registration_date,
        "createdAt": utc_now(),
    }

    try:
        await cl_users.insert_one(user_doc)
    except DuplicateKeyError:
        await release_link(cl_register_links, link_doc)
        raise HTTPException(status_code=409, detail="Username already taken")
    except Exception:
        await release_link(cl_register_links, link_doc)
        raise HTTPException(status_code=500, detail="Failed to create user")

    await cl_register_links.update_one(
        {"_id": link_doc["_id"]}, {"$set": {"usedBy": chat_id}}
    )

    token = await create_access_token({"chatId": chat_id})

    device_name = normalize_device_name(req.deviceName) or normalize_device_name(
        request.headers.get("x-device-name")
    )
    await attach_session_to_user(
        chat_id, token, device_name, extract_client_ip(request)
    )

    return {
        "token": token,
        "user": {
            "chatId": chat_id,
            "username": desired_username,
            "name": name,
            "bio": "",
            "avatar": "",
            "online": False,
            "verified": False,
            "registrationDate": registration_date,
            "adminLevel": get_admin_level(user_doc),
        },
    }


@app.get("/auth/password-link/{token}")
@limiter.limit("30/minute")
async def validate_password_link(request: Request, token: str):
    value = str(token or "").strip()
    if not value or len(value) > 128:
        return {"valid": False, "username": None}
    link = await cl_password_links.find_one(
        {"tokenHash": link_hash(value), "usedAt": None, "expiresAt": {"$gt": utc_now()}},
        {"targetChatId": 1},
    )
    if not link:
        return {"valid": False, "username": None}
    user = await cl_users.find_one(
        {"chatId": link.get("targetChatId")}, {"profile.username": 1}
    )
    return {
        "valid": bool(user),
        "username": ((user or {}).get("profile") or {}).get("username"),
    }


@app.post("/auth/password-link/consume")
@limiter.limit("10/minute;40/hour")
async def consume_password_link(req: ConsumePasswordLinkRequest, request: Request):
    new_password = str(req.newPassword or "")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    link_doc = await consume_link(cl_password_links, req.token)
    if not link_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired link")

    chat_id = str(link_doc.get("targetChatId") or "")
    user = await cl_users.find_one({"chatId": chat_id}, {"chatId": 1})
    if not user:
        await release_link(cl_password_links, link_doc)
        raise HTTPException(status_code=404, detail="User not found")

    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    hashed_password = await asyncio.to_thread(_hash_password, new_password)
    await cl_users.update_one(
        {"chatId": chat_id}, {"$set": {"login.password": hashed_password}}
    )
    await clear_user_sessions(chat_id)
    return {"message": "ok"}


@app.post("/auth/change-password")
@limiter.limit("5/minute;20/hour")
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    new_password = str(req.newPassword or "")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if new_password == req.currentPassword:
        raise HTTPException(status_code=400, detail="New password must be different")

    stored_hash = (current_user.get("login") or {}).get("password")
    if not stored_hash or not isinstance(stored_hash, str):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if not await bcrypt_checkpw_async(req.currentPassword, stored_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    hashed_password = await asyncio.to_thread(_hash_password, new_password)
    await cl_users.update_one(
        {"chatId": current_user["chatId"]},
        {"$set": {"login.password": hashed_password}},
    )
    await clear_user_sessions(current_user["chatId"])
    return {"message": "ok"}


@app.post("/account/deletion")
@limiter.limit("5/minute;20/hour")
async def request_account_deletion(
    request: Request,
    req: DeleteAccountRequest,
    current_user: dict = Depends(get_current_user),
):
    if get_admin_level(current_user) == "admin0":
        raise HTTPException(status_code=403, detail="Owner account cannot be deleted")

    stored_hash = (current_user.get("login") or {}).get("password")
    if not stored_hash or not isinstance(stored_hash, str):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    if not await bcrypt_checkpw_async(req.password, stored_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect")

    uid = current_user["chatId"]
    now = utc_now()
    scheduled_for = now + timedelta(seconds=ACCOUNT_DELETION_GRACE_SECONDS)
    result = await cl_users.update_one(
        {"chatId": uid, "deletion": {"$exists": False}},
        {
            "$set": {
                "deletion": {
                    "status": "scheduled",
                    "source": "self",
                    "requestedAt": now,
                    "scheduledFor": scheduled_for,
                    "startedAt": None,
                    "leaseUntil": None,
                    "attempts": 0,
                }
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Deletion already requested")

    scheduled_ms = dt_to_epoch_ms(scheduled_for)
    await safe_send(uid, {"type": "account_deletion", "scheduledFor": scheduled_ms})
    return {"scheduledFor": scheduled_ms}


@app.post("/account/deletion/cancel")
@limiter.limit("10/minute")
async def cancel_account_deletion(
    request: Request, current_user: dict = Depends(get_current_user)
):
    uid = current_user["chatId"]
    result = await cl_users.update_one(
        {"chatId": uid, "deletion.status": "scheduled"},
        {"$unset": {"deletion": ""}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="No scheduled deletion")
    await safe_send(uid, {"type": "account_deletion", "scheduledFor": None})
    return {"message": "ok"}


@app.get("/account/deletion")
@limiter.limit("60/minute;1000/hour")
async def get_account_deletion(
    request: Request, current_user: dict = Depends(get_current_user)
):
    return {"scheduledFor": deletion_scheduled_for_ms(current_user)}


@app.get("/admin/me")
@limiter.limit("60/minute;600/hour")
async def admin_me(request: Request, current_user: dict = Depends(require_admin)):
    level = get_admin_level(current_user)
    response: Dict[str, Any] = {
        "adminLevel": level,
        "registrationOpen": await is_registration_open(),
    }
    if level == "admin0":
        response["aiSettings"] = await get_ai_settings()
    return response


@app.post("/admin/register-links")
@limiter.limit("60/minute;600/hour")
async def admin_create_register_link(
    request: Request,
    payload: Optional[CreateLinkRequest] = None,
    current_user: dict = Depends(require_admin),
):
    level = get_admin_level(current_user)
    if not await is_registration_open() and level != "admin0":
        raise HTTPException(status_code=403, detail="Registration is closed")
    ttl_minutes = payload.expiresInMinutes if payload else 30
    if ttl_minutes not in ALLOWED_LINK_TTL_MINUTES:
        raise HTTPException(status_code=400, detail="Invalid expiration duration")
    active_links = await cl_register_links.count_documents(
        {
            "createdBy": current_user["chatId"],
            "usedAt": None,
            "expiresAt": {"$gt": utc_now()},
        }
    )
    if active_links >= 20:
        raise HTTPException(status_code=429, detail="Too many active links")
    username = (current_user.get("profile") or {}).get("username") or ""
    return await create_register_link(current_user["chatId"], username, ttl_minutes)


@app.get("/admin/register-links")
@limiter.limit("60/minute;600/hour")
async def admin_list_register_links(
    request: Request, current_user: dict = Depends(require_admin)
):
    query: Dict[str, Any] = {
        "createdBy": current_user["chatId"],
        "usedAt": None,
        "expiresAt": {"$gt": utc_now()},
    }
    docs = (
        await cl_register_links.find(query).sort("createdAt", -1).limit(50).to_list(None)
    )
    items = [
        {
            "id": str(doc["_id"]),
            "path": f"/register/{doc['token']}",
            "expiresAt": dt_to_utc_iso(doc["expiresAt"]),
            "createdAt": dt_to_utc_iso(doc.get("createdAt")),
            "createdBy": doc.get("createdBy"),
            "createdByUsername": doc.get("createdByUsername") or "",
            "mine": True,
        }
        for doc in docs
        if doc.get("token")
    ]
    return {"items": items}


@app.delete("/admin/register-links/{link_id}")
@limiter.limit("60/minute;600/hour")
async def admin_delete_register_link(
    request: Request, link_id: str, current_user: dict = Depends(require_admin)
):
    if not ObjectId.is_valid(link_id):
        raise HTTPException(status_code=400, detail="Invalid link id")
    query: Dict[str, Any] = {
        "_id": ObjectId(link_id),
        "createdBy": current_user["chatId"],
        "usedAt": None,
    }
    result = await cl_register_links.delete_one(query)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"deleted": True}


def parse_registration_date_key(value: Any) -> Tuple[int, int, int]:
    parts = [int(x) for x in re.findall(r"\d+", str(value or ""))]
    if len(parts) >= 3:
        if parts[0] > 1000:
            return (parts[0], parts[1], parts[2])
        if parts[2] > 1000:
            return (parts[2], parts[1], parts[0])
    return (0, 0, 0)


@app.get("/admin/users")
@limiter.limit("60/minute;600/hour")
async def admin_list_users(
    request: Request,
    q: str = "",
    filter: str = "all",
    limit: int = 20,
    cursor: Optional[str] = None,
    current_user: dict = Depends(require_admin0),
):
    page_size = max(1, min(50, int(limit)))
    filter_value = str(filter or "all").strip()
    owner_username = {"profile.username": {"$regex": f"^{re.escape(OWNER_USERNAME)}$", "$options": "i"}}
    filter_options: Dict[str, Optional[Dict[str, Any]]] = {
        "all": None,
        "newest": None,
        "verified": {"verified": True},
        "unverified": {"verified": {"$ne": True}},
        "admins": {"$or": [{"adminLevel": "admin1"}, owner_username]},
        "admin1": {"adminLevel": "admin1"},
        "regular": {
            "$and": [
                {"adminLevel": {"$exists": False}},
                {"$nor": [owner_username]},
            ]
        },
        "online": {"online": True},
    }
    if filter_value not in filter_options:
        raise HTTPException(status_code=400, detail="Invalid filter")
    conditions: List[Dict[str, Any]] = []
    text = str(q or "").strip()
    if text:
        prefix = f"^{re.escape(text)}"
        conditions.append(
            {
                "$or": [
                    {"chatId": text},
                    {"profile.username": {"$regex": prefix, "$options": "i"}},
                    {"chatId": {"$regex": prefix, "$options": "i"}},
                ]
            }
        )
    filter_condition = filter_options[filter_value]
    if filter_condition:
        conditions.append(filter_condition)
    if len(conditions) == 1:
        query: Dict[str, Any] = dict(conditions[0])
    elif conditions:
        query = {"$and": conditions}
    else:
        query = {}

    cursor_value = str(cursor or "").strip()
    offset = 0
    if cursor_value:
        if cursor_value.isdigit():
            offset = int(cursor_value)
        else:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    docs = await cl_users.find(
        query,
        {
            "chatId": 1,
            "profile.name": 1,
            "profile.username": 1,
            "profile.avatar": 1,
            "verified": 1,
            "adminLevel": 1,
            "online": 1,
            "wsConnectionCount": 1,
            "registrationDate": 1,
            "createdAt": 1,
            "login.sessions": 1,
            "deletion": 1,
        },
    ).to_list(None)

    newest_first = filter_value == "newest"
    fallback_date = (0, 0, 0) if newest_first else (9999, 99, 99)
    docs.sort(
        key=lambda doc: (
            parse_registration_date_key(doc.get("registrationDate"))
            if parse_registration_date_key(doc.get("registrationDate")) != (0, 0, 0)
            else fallback_date,
            dt_to_epoch_ms(doc.get("createdAt")) if doc.get("createdAt") else 0,
            str(doc.get("_id") or ""),
        ),
        reverse=newest_first,
    )

    total: Optional[int] = len(docs) if offset == 0 else None
    page_docs = docs[offset : offset + page_size]
    has_more = offset + page_size < len(docs)
    items = [
        {
            "chatId": doc.get("chatId"),
            "name": ((doc.get("profile") or {}).get("name") or ""),
            "username": ((doc.get("profile") or {}).get("username") or ""),
            "avatar": ((doc.get("profile") or {}).get("avatar") or ""),
            "verified": bool(doc.get("verified", False)),
            "adminLevel": get_admin_level(doc),
            "online": resolve_user_online_state(doc),
            "registrationDate": doc.get("registrationDate"),
            "sessionsCount": len(((doc.get("login") or {}).get("sessions")) or []),
            "deletionStatus": (doc.get("deletion") or {}).get("status"),
        }
        for doc in page_docs
    ]
    response = {
        "items": items,
        "nextCursor": str(offset + page_size) if has_more else None,
        "hasMore": has_more,
    }
    if total is not None:
        response["total"] = total
    return response


@app.get("/admin/users/{chat_id}")
@limiter.limit("100/minute;1000/hour")
async def admin_user_detail(
    request: Request, chat_id: str, current_user: dict = Depends(require_admin0)
):
    user = await cl_users.find_one({"chatId": chat_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    login_data = user.get("login") or {}
    last_seen = user.get("lastSeen")
    global_ai = await get_ai_settings()
    resolved_limits = resolve_user_ai_limits(user, global_ai)
    usage_row = await cl_ai_usage.find_one({"userId": chat_id, "dateKey": tehran_day_key()})
    return {
        "chatId": user.get("chatId"),
        "name": ((user.get("profile") or {}).get("name") or ""),
        "username": ((user.get("profile") or {}).get("username") or ""),
        "avatar": ((user.get("profile") or {}).get("avatar") or ""),
        "verified": bool(user.get("verified", False)),
        "adminLevel": get_admin_level(user),
        "registrationDate": user.get("registrationDate"),
        "createdAt": dt_to_epoch_ms(user.get("createdAt")) if user.get("createdAt") else None,
        "online": resolve_user_online_state(user),
        "lastSeen": dt_to_epoch_ms(last_seen) if last_seen else None,
        "email": login_data.get("email"),
        "sessionsCount": len(login_data.get("sessions") or []),
        "hasPassword": bool(login_data.get("password")),
        "deletionStatus": (user.get("deletion") or {}).get("status"),
        "aiLimits": {
            **resolved_limits,
            "globalDefaults": {
                "dailyTokenLimit": global_ai["dailyTokenLimit"],
                "dailySearchLimit": global_ai["dailySearchLimit"],
                "dailyFileLimit": global_ai["dailyFileLimit"],
            },
        },
        "aiUsage": {
            "tokensUsed": max(0, int(usage_row.get("tokensUsed", 0))) if isinstance(usage_row, dict) else 0,
            "searchUsed": max(0, int(usage_row.get("searchCount", 0))) if isinstance(usage_row, dict) else 0,
            "filesUsed": max(0, int(usage_row.get("fileCount", 0))) if isinstance(usage_row, dict) else 0,
        },
    }


@app.post("/admin/users/{chat_id}/verify")
@limiter.limit("60/minute;600/hour")
async def admin_set_verified(
    request: Request,
    chat_id: str,
    payload: VerifyUserRequest,
    current_user: dict = Depends(require_admin0),
):
    target = await cl_users.find_one({"chatId": chat_id}, {"deletion": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_purging(target):
        raise HTTPException(status_code=409, detail="Account is being deleted")
    result = await cl_users.update_one(
        {"chatId": chat_id}, {"$set": {"verified": bool(payload.verified)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"verified": bool(payload.verified)}


@app.post("/admin/users/{chat_id}/admin-level")
@limiter.limit("30/minute;200/hour")
async def admin_set_level(
    request: Request,
    chat_id: str,
    payload: AdminLevelRequest,
    current_user: dict = Depends(require_admin0),
):
    target = await cl_users.find_one({"chatId": chat_id}, {"profile.username": 1, "adminLevel": 1, "chatId": 1, "deletion": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if get_admin_level(target) == "admin0":
        raise HTTPException(status_code=403, detail="Forbidden")
    if is_purging(target):
        raise HTTPException(status_code=409, detail="Account is being deleted")
    if payload.level == "admin1":
        await cl_users.update_one({"chatId": chat_id}, {"$set": {"adminLevel": "admin1"}})
    else:
        await cl_users.update_one({"chatId": chat_id}, {"$unset": {"adminLevel": ""}})
    return {"adminLevel": payload.level}


@app.post("/admin/users/{chat_id}/password-link")
@limiter.limit("30/minute;200/hour")
async def admin_create_password_link(
    request: Request,
    chat_id: str,
    payload: Optional[CreateLinkRequest] = None,
    current_user: dict = Depends(require_admin0),
):
    ttl_minutes = payload.expiresInMinutes if payload else 30
    if ttl_minutes not in ALLOWED_LINK_TTL_MINUTES:
        raise HTTPException(status_code=400, detail="Invalid expiration duration")
    target = await cl_users.find_one({"chatId": chat_id}, {"profile.username": 1, "adminLevel": 1, "chatId": 1, "deletion": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if get_admin_level(target) == "admin0":
        raise HTTPException(status_code=403, detail="Forbidden")
    if is_purging(target):
        raise HTTPException(status_code=409, detail="Account is being deleted")
    return await create_password_link(chat_id, current_user["chatId"], ttl_minutes)


@app.post("/admin/users/{chat_id}/delete")
@limiter.limit("10/minute;60/hour")
async def admin_delete_user(
    request: Request,
    chat_id: str,
    payload: AdminDeleteUserRequest,
    current_user: dict = Depends(require_admin0),
):
    target = await cl_users.find_one({"chatId": chat_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if get_admin_level(target) == "admin0" or chat_id == current_user["chatId"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if str(payload.confirmUsername or "") != str((target.get("profile") or {}).get("username") or ""):
        raise HTTPException(status_code=400, detail="Confirmation does not match")

    now = utc_now()
    await cl_users.update_one(
        {"chatId": chat_id, "deletion.status": {"$ne": "purging"}},
        {
            "$set": {
                "deletion": {
                    "status": "purging",
                    "source": "admin",
                    "requestedAt": now,
                    "scheduledFor": now,
                    "startedAt": now,
                    "leaseUntil": None,
                    "attempts": 0,
                }
            }
        },
    )
    asyncio.create_task(run_account_purge(chat_id))
    return {"status": "purging"}


@app.put("/admin/registration")
@limiter.limit("30/minute;200/hour")
async def admin_set_registration(
    request: Request,
    payload: RegistrationStateRequest,
    current_user: dict = Depends(require_admin0),
):
    await cl_app_settings.update_one(
        {"_id": "registration"}, {"$set": {"open": bool(payload.open)}}, upsert=True
    )
    return {"open": bool(payload.open)}


def _build_quota_reset_fields(payload: AdminAIResetQuotaRequest) -> Dict[str, int]:
    fields: Dict[str, int] = {}
    if payload.tokens:
        fields["tokensUsed"] = 0
    if payload.search:
        fields["searchCount"] = 0
    if payload.files:
        fields["fileCount"] = 0
    return fields


@app.put("/admin/ai/settings")
@limiter.limit("30/minute;200/hour")
async def admin_update_ai_settings(
    request: Request,
    payload: AdminAISettingsRequest,
    current_user: dict = Depends(require_admin0),
):
    settings_doc = {
        "enabled": bool(payload.enabled),
        "dailyTokenLimit": int(payload.dailyTokenLimit),
        "dailySearchLimit": int(payload.dailySearchLimit),
        "dailyFileLimit": int(payload.dailyFileLimit),
        "disabledMessage": _coerce_ai_disabled_message(payload.disabledMessage),
        "updatedAt": utc_now(),
    }
    await cl_app_settings.update_one(
        {"_id": "ai"}, {"$set": settings_doc}, upsert=True
    )
    return {
        "enabled": settings_doc["enabled"],
        "dailyTokenLimit": settings_doc["dailyTokenLimit"],
        "dailySearchLimit": settings_doc["dailySearchLimit"],
        "dailyFileLimit": settings_doc["dailyFileLimit"],
        "disabledMessage": settings_doc["disabledMessage"],
    }


@app.post("/admin/ai/reset-usage")
@limiter.limit("20/minute;100/hour")
async def admin_reset_all_ai_usage(
    request: Request,
    payload: AdminAIResetQuotaRequest,
    current_user: dict = Depends(require_admin0),
):
    reset_fields = _build_quota_reset_fields(payload)
    if not reset_fields:
        raise HTTPException(status_code=400, detail="At least one quota must be selected")
    await cl_ai_usage.update_many(
        {},
        {"$set": {**reset_fields, "updatedAt": utc_now()}},
    )
    return {"reset": True}


@app.put("/admin/users/{chat_id}/ai-limits")
@limiter.limit("30/minute;200/hour")
async def admin_update_user_ai_limits(
    request: Request,
    chat_id: str,
    payload: AdminUserAILimitsRequest,
    current_user: dict = Depends(require_admin0),
):
    target = await cl_users.find_one({"chatId": chat_id}, {"deletion": 1, "aiLimits": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_purging(target):
        raise HTTPException(status_code=409, detail="Account is being deleted")
    global_ai = await get_ai_settings()
    if payload.mode == "custom":
        ai_limits = {
            "mode": "custom",
            "dailyTokenLimit": int(payload.dailyTokenLimit if payload.dailyTokenLimit is not None else global_ai["dailyTokenLimit"]),
            "dailySearchLimit": int(payload.dailySearchLimit if payload.dailySearchLimit is not None else global_ai["dailySearchLimit"]),
            "dailyFileLimit": int(payload.dailyFileLimit if payload.dailyFileLimit is not None else global_ai["dailyFileLimit"]),
        }
        await cl_users.update_one({"chatId": chat_id}, {"$set": {"aiLimits": ai_limits}})
    else:
        await cl_users.update_one({"chatId": chat_id}, {"$unset": {"aiLimits": ""}})
        ai_limits = {
            "mode": "global",
            "dailyTokenLimit": global_ai["dailyTokenLimit"],
            "dailySearchLimit": global_ai["dailySearchLimit"],
            "dailyFileLimit": global_ai["dailyFileLimit"],
        }
    return {
        **ai_limits,
        "globalDefaults": {
            "dailyTokenLimit": global_ai["dailyTokenLimit"],
            "dailySearchLimit": global_ai["dailySearchLimit"],
            "dailyFileLimit": global_ai["dailyFileLimit"],
        },
    }


@app.post("/admin/users/{chat_id}/ai-reset")
@limiter.limit("30/minute;200/hour")
async def admin_reset_user_ai_usage(
    request: Request,
    chat_id: str,
    payload: AdminAIResetQuotaRequest,
    current_user: dict = Depends(require_admin0),
):
    target = await cl_users.find_one({"chatId": chat_id}, {"deletion": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    reset_fields = _build_quota_reset_fields(payload)
    if not reset_fields:
        raise HTTPException(status_code=400, detail="At least one quota must be selected")
    day_key = tehran_day_key()
    await cl_ai_usage.update_many(
        {"userId": chat_id},
        {"$set": {**reset_fields, "updatedAt": utc_now()}},
    )
    usage_row = await cl_ai_usage.find_one({"userId": chat_id, "dateKey": day_key})
    return {
        "reset": True,
        "aiUsage": {
            "tokensUsed": max(0, int(usage_row.get("tokensUsed", 0))) if isinstance(usage_row, dict) else 0,
            "searchUsed": max(0, int(usage_row.get("searchCount", 0))) if isinstance(usage_row, dict) else 0,
            "filesUsed": max(0, int(usage_row.get("fileCount", 0))) if isinstance(usage_row, dict) else 0,
        },
    }


@app.post("/auth/login", response_model=TokenResponse)
@limiter.limit("5/minute;20/hour")
async def login(req: LoginRequest, request: Request):
    ident = str(req.identifier or req.email or "").strip()
    if not ident:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if "@" in ident:
        user = await cl_users.find_one(
            {"$or": [{"login.email": ident}, {"login.email": ident.lower()}]}
        )
    else:
        user = await cl_users.find_one(
            {
                "profile.username": {
                    "$regex": f"^{re.escape(normalize_username(ident))}$",
                    "$options": "i",
                }
            }
        )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    stored_hash = user.get("login", {}).get("password")
    if not stored_hash or not isinstance(stored_hash, str):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    ok = await bcrypt_checkpw_async(req.password, stored_hash)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if is_purging(user):
        raise HTTPException(status_code=403, detail="Account is being deleted")

    token = await create_access_token({"chatId": user["chatId"]})

    device_name = normalize_device_name(req.deviceName) or normalize_device_name(
        request.headers.get("x-device-name")
    )
    await attach_session_to_user(
        user["chatId"], token, device_name, extract_client_ip(request)
    )

    return {
        "token": token,
        "user": {
            "chatId": user["chatId"],
            "username": user["profile"]["username"],
            "name": user["profile"]["name"],
            "bio": decrypt_user_bio(user, token),
            "avatar": user["profile"]["avatar"],
            "online": resolve_user_online_state(user),
            "verified": bool(user.get("verified", False)),
            "registrationDate": user.get("registrationDate"),
            "adminLevel": get_admin_level(user),
            **privacy_settings_payload(user.get("settings")),
        },
    }


class PrivacySettingsUpdate(BaseModel):
    lastSeenVisibility: Optional[Literal["everyone", "friends", "nobody"]] = None
    avatarVisibility: Optional[Literal["everyone", "friends", "nobody"]] = None
    bioVisibility: Optional[Literal["everyone", "friends", "nobody"]] = None


@app.get("/profile/me")
@limiter.limit("100/minute;2000/hour")
async def get_profile(request: Request, current_user: dict = Depends(get_current_user)):
    user_settings = current_user.get("settings") or {}
    last_seen = current_user.get("lastSeen")
    return {
        "chatId": current_user["chatId"],
        "username": current_user["profile"]["username"],
        "name": current_user["profile"]["name"],
        "bio": current_user["profile"]["bio"],
        "avatar": current_user["profile"]["avatar"],
        "online": resolve_user_online_state(current_user),
        "lastSeen": dt_to_epoch_ms(last_seen) if last_seen else None,
        "verified": bool(current_user.get("verified", False)),
        "registrationDate": current_user.get("registrationDate"),
        "adminLevel": get_admin_level(current_user),
        "deletionScheduledFor": deletion_scheduled_for_ms(current_user),
        **privacy_settings_payload(user_settings),
    }


@app.get("/profile/me/privacy")
@limiter.limit("60/minute;1000/hour")
async def get_privacy_settings(request: Request, current_user: dict = Depends(get_current_user)):
    return privacy_settings_payload(current_user.get("settings"))


@app.patch("/profile/me/privacy")
@limiter.limit("30/minute;300/hour")
async def update_privacy_settings(
    request: Request,
    payload: PrivacySettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    update_data: Dict[str, str] = {}
    if payload.lastSeenVisibility is not None:
        update_data["settings.lastSeenVisibility"] = payload.lastSeenVisibility
    if payload.avatarVisibility is not None:
        update_data["settings.avatarVisibility"] = payload.avatarVisibility
    if payload.bioVisibility is not None:
        update_data["settings.bioVisibility"] = payload.bioVisibility
    if not update_data:
        raise HTTPException(status_code=400, detail="No privacy setting provided")
    await cl_users.update_one(
        {"chatId": current_user["chatId"]},
        {"$set": update_data},
    )
    updated_settings = {
        **(current_user.get("settings") or {}),
        **{
            key.removeprefix("settings."): value
            for key, value in update_data.items()
        },
    }
    return privacy_settings_payload(updated_settings)


@app.patch("/profile/me")
@limiter.limit("30/minute;300/hour")
async def update_profile(
    request: Request,
    updates: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    update_data = {}
    if updates.name:
        update_data["profile.name"] = updates.name

    if updates.username:
        desired = normalize_username(updates.username)
        if not validate_username(desired):
            raise HTTPException(status_code=400, detail="Invalid username")

        my_un = normalize_username(current_user.get("profile", {}).get("username"))
        if my_un.lower() == OWNER_USERNAME.lower() and desired.lower() != OWNER_USERNAME.lower():
            raise HTTPException(status_code=403, detail="Owner username cannot be changed")
        if desired.lower() == OWNER_USERNAME.lower() and my_un.lower() != OWNER_USERNAME.lower():
            raise HTTPException(status_code=409, detail="Username already taken")
        if my_un.lower() != desired.lower():
            exists = await cl_users.find_one(
                {
                    "profile.username": {
                        "$regex": f"^{re.escape(desired)}$",
                        "$options": "i",
                    },
                    "chatId": {"$ne": current_user["chatId"]},
                },
                {"_id": 1},
            )
            if exists:
                raise HTTPException(status_code=409, detail="Username already taken")

        update_data["profile.username"] = desired

    if updates.bio is not None:
        update_data["profile.bio"] = str(updates.bio)
        update_data["profile.bioEncrypted"] = False

    if updates.avatar is not None:
        avatar_value = str(updates.avatar).strip()
        update_data["profile.avatar"] = avatar_value

    if update_data:
        await cl_users.update_one(
            {"chatId": current_user["chatId"]}, {"$set": update_data}
        )
    return {"message": "Profile updated"}


@app.get("/profile/groups")
@limiter.limit("100/minute;2000/hour")
async def get_profile_groups(
    request: Request, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    groups = (
        await cl_chats.find({"chatType": "group", "createdBy": user_id})
        .sort("updatedAt", -1)
        .to_list(100)
    )

    return [
        {
            "chatId": g["_id"],
            "name": g.get("groupName", "گروه"),
            "inviteCode": g.get("inviteCode", ""),
            "inviteLink": build_group_invite_link(g.get("inviteCode", "")),
        }
        for g in groups
        if g.get("inviteCode")
    ]


@app.post("/presence/offline")
async def set_presence_offline(current_user: dict = Depends(get_current_user)):
    user_id = current_user["chatId"]

    sockets = list(active_connections.get(user_id) or [])
    for ws in sockets:
        try:
            await ws.close(code=1001)
        except Exception:
            pass

    active_connections.pop(user_id, None)
    active_ai_connections.pop(user_id, None)

    became_offline = await force_user_offline(user_id)
    if became_offline:
        user_chats = await cl_chats.find({"participants": user_id}).to_list(None)
        contacts_to_notify = set()
        for chat in user_chats:
            for p in chat.get("participants", []):
                if p != user_id:
                    contacts_to_notify.add(p)

        allowed_contacts = await _filter_recipients_by_block_status(
            user_id, contacts_to_notify
        )
        allowed_contacts = await _filter_recipients_by_presence_visibility(
            user_id, allowed_contacts
        )
        await broadcast(
            allowed_contacts,
            {
                "type": "user_status",
                "userId": user_id,
                "online": False,
                "lastSeen": dt_to_epoch_ms(utc_now()),
            },
        )
    return {"ok": True}


@app.get("/users/username-available")
@limiter.limit("100/minute;2000/hour")
async def username_available(
    request: Request,
    username: str = Query(..., min_length=3, max_length=32),
    current_user: dict = Depends(get_current_user),
):
    desired = normalize_username(username)
    if not validate_username(desired):
        return {"available": False}

    my_un = normalize_username(current_user.get("profile", {}).get("username"))
    if my_un and my_un.lower() == desired.lower():
        return {"available": True}

    exists = await cl_users.find_one(
        {
            "profile.username": {"$regex": f"^{re.escape(desired)}$", "$options": "i"},
            "chatId": {"$ne": current_user["chatId"]},
        },
        {"_id": 1},
    )

    return {"available": not bool(exists)}


@app.get("/auth/username-available")
@limiter.limit("100/minute;2000/hour")
async def public_username_available(
    request: Request,
    username: str = Query(..., min_length=3, max_length=32),
):
    """Public endpoint for checking username availability during registration"""
    desired = normalize_username(username)
    if not validate_username(desired):
        return {"available": False}

    exists = await cl_users.find_one(
        {
            "profile.username": {"$regex": f"^{re.escape(desired)}$", "$options": "i"},
        },
        {"_id": 1},
    )

    return {"available": not bool(exists)}


@app.get("/users/search", response_model=List[UserSearchResult])
@limiter.limit("100/minute;2000/hour")
async def search_users(
    request: Request,
    query: str = Query(..., min_length=2),
    current_user: dict = Depends(get_current_user),
):
    q = (query or "").strip()
    if q.startswith("@"):
        q = q.lstrip("@")

    users = (
        await cl_users.find(
            {
                **NOT_PURGING,
                "profile.username": {"$regex": re.escape(q), "$options": "i"},
                "chatId": {"$ne": current_user["chatId"]},
            }
        )
        .limit(10)
        .to_list(10)
    )

    my_id = current_user["chatId"]
    result = []
    for u in users:
        u_blocked_ids = set(_get_blocked_from_user_doc(u))
        blocked_by_other = my_id in u_blocked_ids
        presence = await resolve_user_presence_for_viewer(
            current_user,
            u,
            blocked=bool(blocked_by_other),
        )

        result.append(
            {
                "chatId": u["chatId"],
                "username": u["profile"]["username"],
                "name": u["profile"]["name"],
                "avatar": (
                    u["profile"]["avatar"]
                    if presence.get("avatarVisible") and not blocked_by_other
                    else ""
                ),
                "bio": (
                    decrypt_user_bio(
                        u, str(current_user.get("_session_token") or "")
                    )
                    if presence.get("bioVisible")
                    else ""
                ),
                "online": presence["online"],
                "lastSeen": presence.get("lastSeen"),
                "lastSeenCategory": presence.get("lastSeenCategory"),
                "verified": bool(u.get("verified", False)),
                "registrationDate": u.get("registrationDate"),
            }
        )
    return result


@app.get("/users/by-username/{username}")
@limiter.limit("120/minute;2000/hour")
async def get_user_by_username(
    request: Request,
    username: str,
    current_user: dict = Depends(get_current_user),
):
    uname = (username or "").strip().lstrip("@")
    if not validate_username(uname):
        raise HTTPException(status_code=404, detail="User not found")

    u = await cl_users.find_one(
        {
            **NOT_PURGING,
            "profile.username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"},
        }
    )
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    my_id = current_user["chatId"]
    target_id = u["chatId"]
    my_blocked_ids = set(_get_blocked_from_user_doc(current_user))
    u_blocked_ids = set(_get_blocked_from_user_doc(u))
    blocked_by_me = bool(target_id != my_id and target_id in my_blocked_ids)
    blocked_by_other = bool(target_id != my_id and my_id in u_blocked_ids)
    blocked_relation = blocked_by_me or blocked_by_other

    presence = (
        {
            "online": True,
            "lastSeen": None,
            "lastSeenCategory": None,
            "avatarVisible": True,
            "bioVisible": True,
        }
        if target_id == my_id
        else await resolve_user_presence_for_viewer(
            current_user,
            u,
            blocked=bool(blocked_relation),
        )
    )

    profile = u.get("profile") or {}
    return {
        "chatId": target_id,
        "username": profile.get("username", ""),
        "name": profile.get("name", ""),
        "avatar": (
            profile.get("avatar", "")
            if presence.get("avatarVisible") and not blocked_by_other
            else ""
        ),
        "bio": (
            decrypt_user_bio(u, str(current_user.get("_session_token") or ""))
            if presence.get("bioVisible")
            else ""
        ),
        "online": bool(presence.get("online")),
        "lastSeen": presence.get("lastSeen"),
        "lastSeenCategory": presence.get("lastSeenCategory"),
        "verified": bool(u.get("verified", False)),
        "registrationDate": u.get("registrationDate"),
        "blockedByMe": blocked_by_me,
        "blockedByOther": blocked_by_other,
    }


@app.post("/chats")
@limiter.limit("100/hour")
async def create_or_get_chat(
    request: Request,
    req: ChatCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    my_id = current_user["chatId"]
    target_id = req.targetChatId

    target_user = await cl_users.find_one(
        {"chatId": target_id, "deletion.status": {"$ne": "purging"}}, {"chatId": 1}
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    chat_id = get_chat_id_for_two(my_id, target_id)
    chat = await cl_chats.find_one({"_id": chat_id})

    if chat:
        return {"chatId": chat_id, "participants": chat["participants"]}

    now = utc_now()
    new_chat = {
        "_id": chat_id,
        "participants": sorted([my_id, target_id]),
        "createdAt": now,
        "updatedAt": now,
        "lastMessage": None,
    }

    await cl_chats.insert_one(new_chat)
    return {"chatId": chat_id, "participants": new_chat["participants"]}


@app.post("/groups")
@limiter.limit("20/minute;100/hour")
async def create_group(
    request: Request,
    req: GroupCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    name = (req.name or "").strip()
    if len(name) < 3:
        raise HTTPException(
            status_code=400, detail="Group name must be at least 3 characters"
        )
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="Group name is too long")

    creator_id = current_user["chatId"]
    group_limit = (
        GROUP_CREATE_LIMIT_ADMIN
        if get_admin_level(current_user) is not None
        else GROUP_CREATE_LIMIT_USER
    )
    created_groups = await cl_chats.count_documents(
        {"chatType": "group", "createdBy": creator_id}
    )
    if created_groups >= group_limit:
        raise HTTPException(
            status_code=403,
            detail=f"محدودیت ساخت گروه: حداکثر {group_limit} گروه",
        )

    chat_id = f"grp_{uuid.uuid4().hex[:16]}"
    invite_code = uuid.uuid4().hex[:12]
    now = utc_now()

    new_group = {
        "_id": chat_id,
        "participants": [creator_id],
        "createdAt": now,
        "updatedAt": now,
        "lastMessage": None,
        "chatType": "group",
        "groupName": name,
        "groupAvatar": "",
        "inviteCode": invite_code,
        "createdBy": creator_id,
    }

    await cl_chats.insert_one(new_group)

    return {
        "chatId": chat_id,
        "name": name,
        "inviteCode": invite_code,
        "inviteLink": build_group_invite_link(invite_code),
    }


@app.post("/groups/join")
@limiter.limit("20/minute;100/hour")
async def join_group(
    request: Request,
    req: GroupJoinRequest,
    current_user: dict = Depends(get_current_user),
):
    invite_code = (req.inviteCode or "").strip()
    if not invite_code:
        raise HTTPException(status_code=400, detail="Invite code is required")

    group_chat = await cl_chats.find_one(
        {"inviteCode": invite_code, "chatType": "group"}
    )
    if not group_chat:
        raise HTTPException(status_code=404, detail="Group not found")

    user_id = current_user["chatId"]
    participants = group_chat.get("participants", []) or []
    if user_id not in participants and len(participants) >= MAX_GROUP_MEMBERS:
        raise HTTPException(
            status_code=400,
            detail=f"ظرفیت گروه تکمیل شده است (حداکثر {MAX_GROUP_MEMBERS} عضو)",
        )

    updated = await cl_chats.update_one(
        {
            "_id": group_chat["_id"],
            "$expr": {
                "$lt": [
                    {"$size": {"$ifNull": ["$participants", []]}},
                    MAX_GROUP_MEMBERS,
                ]
            },
        },
        {"$addToSet": {"participants": user_id}, "$set": {"updatedAt": utc_now()}},
    )
    if updated.modified_count == 0:
        refreshed = await cl_chats.find_one(
            {"_id": group_chat["_id"]}, {"participants": 1}
        )
        if user_id not in ((refreshed or {}).get("participants", []) or []):
            raise HTTPException(
                status_code=400,
                detail=f"ظرفیت گروه تکمیل شده است (حداکثر {MAX_GROUP_MEMBERS} عضو)",
            )

    return {
        "chatId": group_chat["_id"],
        "name": group_chat.get("groupName", "گروه بدون نام"),
        "inviteLink": build_group_invite_link(invite_code),
    }


@app.post("/groups/{chat_id}/leave")
@limiter.limit("20/minute;100/hour")
async def leave_group(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    if is_official_channel_chat(chat_id):
        raise HTTPException(status_code=403, detail="Cannot leave official channel")

    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if chat.get("chatType") != "group":
        raise HTTPException(status_code=400, detail="Not a group chat")

    participants = chat.get("participants", [])
    if my_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    await cl_chats.update_one(
        {"_id": chat_id},
        {"$pull": {"participants": my_id}, "$set": {"updatedAt": utc_now()}},
    )

    updated = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
    remaining = (updated or {}).get("participants", []) or []
    if not remaining:
        file_ids: set = set()
        async for msg in cl_messages.find({"chatId": chat_id}, {"file": 1}):
            file_ids |= collect_file_ids(msg)
        await cl_messages.delete_many({"chatId": chat_id})
        await cl_chats.delete_one({"_id": chat_id})
        await release_files(file_ids)
        return {"message": "Group deleted (no members left)"}

    return {"message": "Left group"}


@app.put("/groups/{chat_id}")
@limiter.limit("30/minute;100/hour")
async def update_group(
    request: Request,
    chat_id: str,
    req: GroupUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if chat.get("chatType") != "group":
        raise HTTPException(status_code=400, detail="Not a group chat")

    if not can_manage_group(current_user, chat):
        raise HTTPException(status_code=403, detail="Not allowed")

    update_data = {}

    if req.name is not None:
        name = (req.name or "").strip()
        if len(name) < 3:
            raise HTTPException(
                status_code=400, detail="Group name must be at least 3 characters"
            )
        if len(name) > 64:
            raise HTTPException(status_code=400, detail="Group name is too long")
        update_data["groupName"] = name

    if req.avatar is not None:
        update_data["groupAvatar"] = str(req.avatar).strip()

    if not update_data:
        return {"message": "No changes"}

    update_data["updatedAt"] = utc_now()

    await cl_chats.update_one({"_id": chat_id}, {"$set": update_data})

    return {"message": "Group updated"}


@app.get("/chats")
@limiter.limit("100/minute;2000/hour")
async def get_chat_list(
    request: Request, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    my_blocked_ids = set(_get_blocked_from_user_doc(current_user))
    hidden_pinned_map = (current_user.get("settings") or {}).get(
        "hiddenPinnedMessages"
    ) or {}
    chats = (
        await cl_chats.find({"participants": my_id}).sort("updatedAt", -1).to_list(50)
    )

    saved_chat_id = get_saved_messages_id(my_id)
    saved_count = await cl_messages.count_documents({"chatId": saved_chat_id})

    result = []

    chat_ids = [c["_id"] for c in chats]

    other_ids: List[str] = []
    for c in chats:
        other_id = next(
            (pid for pid in c.get("participants", []) if pid != my_id), None
        )
        if other_id:
            other_ids.append(other_id)

    other_users = await cl_users.find({"chatId": {"$in": other_ids}}).to_list(
        len(other_ids) or 1
    )
    user_by_id = {u["chatId"]: u for u in other_users}

    unread_map: Dict[str, int] = {}
    unread_rows = await cl_messages.aggregate(
        [
            {
                "$match": {
                    "chatId": {"$in": chat_ids},
                    "senderId": {"$ne": my_id},
                    "seenBy": {"$ne": my_id},
                }
            },
            {"$group": {"_id": "$chatId", "count": {"$sum": 1}}},
        ]
    ).to_list(len(chat_ids))

    for r in unread_rows:
        unread_map[str(r.get("_id"))] = int(r.get("count", 0))

    group_chat_ids = [
        c["_id"]
        for c in chats
        if c.get("chatType") == "group" and not is_official_channel_chat(c["_id"])
    ]
    regular_chat_ids = [
        c["_id"]
        for c in chats
        if not is_official_channel_chat(c["_id"]) and c["_id"] != saved_chat_id
    ]

    mention_ids_map: Dict[str, List[str]] = {}
    if group_chat_ids:
        mention_docs = (
            await cl_messages.find(
                {"chatId": {"$in": group_chat_ids}, "unreadMentionUserIds": my_id},
                {"_id": 1, "chatId": 1},
            )
            .sort([("timestamp", 1), ("_id", 1)])
            .to_list(500)
        )
        for doc in mention_docs:
            cid = str(doc.get("chatId") or "")
            mention_ids_map.setdefault(cid, []).append(str(doc["_id"]))

    reaction_ids_map: Dict[str, List[str]] = {}
    if regular_chat_ids:
        reaction_docs = (
            await cl_messages.find(
                {"chatId": {"$in": regular_chat_ids}, "unreadReactionUserIds": my_id},
                {"_id": 1, "chatId": 1},
            )
            .sort([("timestamp", 1), ("_id", 1)])
            .to_list(500)
        )
        for doc in reaction_docs:
            cid = str(doc.get("chatId") or "")
            reaction_ids_map.setdefault(cid, []).append(str(doc["_id"]))

    for chat in chats:
        is_group = chat.get("chatType") == "group"
        other_id = next(
            (pid for pid in chat.get("participants", []) if pid != my_id), None
        )
        other_user = user_by_id.get(other_id) if (other_id and not is_group) else None
        blocked_by_me = bool(other_id and other_id in my_blocked_ids)
        other_blocked_ids = (
            set(_get_blocked_from_user_doc(other_user))
            if (other_user and not is_group)
            else set()
        )
        blocked_by_other = bool(not is_group and my_id in other_blocked_ids)
        blocked_relation = blocked_by_me or blocked_by_other

        last_msg = chat.get("lastMessage")
        if isinstance(last_msg, dict) and last_msg.get("timestamp") is not None:
            chat_scope = f"chat:{chat.get('_id', '')}"
            last_msg = {
                **last_msg,
                "text": decrypt_with_fallback(
                    last_msg.get("text", ""), session_token, chat_scope
                ),
                "timestamp": dt_to_epoch_ms(last_msg.get("timestamp")),
            }

        pinned_msg = chat.get("pinnedMessage")
        hidden_pin_id = hidden_pinned_map.get(chat.get("_id"))
        if (
            isinstance(pinned_msg, dict)
            and pinned_msg.get("id")
            and pinned_msg.get("id") != hidden_pin_id
        ):
            chat_scope = f"chat:{chat.get('_id', '')}"
            pinned_msg = {
                **pinned_msg,
                "text": decrypt_with_fallback(
                    pinned_msg.get("text", ""), session_token, chat_scope
                ),
            }
        else:
            pinned_msg = None

        presence = (
            {"online": False, "lastSeen": None, "lastSeenCategory": None}
            if is_group
            else await resolve_user_presence_for_viewer(
                current_user,
                other_user,
                blocked=bool(blocked_relation),
            )
        )

        result.append(
            {
                "id": chat["_id"],
                "participantIds": chat.get("participants", []),
                "chatType": "group" if is_group else "direct",
                "otherUser": {
                    "chatId": (
                        chat["_id"]
                        if is_group
                        else (
                            other_user.get("chatId") if other_user else (other_id or "")
                        )
                    ),
                    "name": (
                        (chat.get("groupName") or "گروه")
                        if is_group
                        else (
                            other_user["profile"]["name"] if other_user else "Unknown"
                        )
                    ),
                    "avatar": (
                        (chat.get("groupAvatar") or "")
                        if is_group
                        else (
                            other_user["profile"]["avatar"]
                            if other_user
                            and presence.get("avatarVisible")
                            and not blocked_by_other
                            else ""
                        )
                    ),
                    "username": (
                        build_group_invite_link(chat.get("inviteCode", ""))
                        if is_group
                        else (
                            other_user["profile"]["username"]
                            if other_user
                            else (other_id or "")
                        )
                    ),
                    "bio": (
                        "گروه"
                        if is_group
                        else (
                            decrypt_user_bio(other_user, session_token)
                            if other_user and presence.get("bioVisible")
                            else ""
                        )
                    ),
                    "online": presence["online"],
                    "lastSeen": presence.get("lastSeen"),
                    "lastSeenCategory": presence.get("lastSeenCategory"),
                    "blockedByMe": blocked_by_me if not is_group else False,
                    "blockedByOther": blocked_by_other if not is_group else False,
                    "verified": (
                        False
                        if is_group
                        else (
                            bool(other_user.get("verified", False))
                            if other_user
                            else False
                        )
                    ),
                    "registrationDate": (
                        None
                        if is_group
                        else (
                            other_user.get("registrationDate") if other_user else None
                        )
                    ),
                    "isGroup": is_group,
                    "createdBy": chat.get("createdBy") if is_group else None,
                },
                "lastMessage": last_msg,
                "pinnedMessage": pinned_msg,
                "unreadCount": unread_map.get(chat["_id"], 0),
                "unreadMentionIds": (
                    mention_ids_map.get(chat["_id"], [])
                    if is_group and not is_official_channel_chat(chat["_id"])
                    else []
                ),
                "unreadReactionIds": (
                    reaction_ids_map.get(chat["_id"], [])
                    if not is_official_channel_chat(chat["_id"])
                    else []
                ),
            }
        )

    if saved_count > 0:
        saved_msg = (
            await cl_messages.find({"chatId": saved_chat_id})
            .sort("timestamp", -1)
            .limit(1)
            .to_list(1)
        )

        saved_last_msg = None
        if saved_msg:
            doc = saved_msg[0]
            saved_last_msg = {
                "id": str(doc["_id"]),
                "text": decrypt_with_fallback(
                    doc.get("text", ""), session_token, f"chat:{saved_chat_id}"
                ),
                "senderId": doc.get("senderId"),
                "timestamp": dt_to_epoch_ms(doc.get("timestamp")),
                "file": doc.get("file"),
            }

        saved_pinned_raw = current_user.get("settings", {}).get("savedPinnedMessage")
        saved_pinned_msg = None
        if isinstance(saved_pinned_raw, dict) and saved_pinned_raw.get("id"):
            saved_pinned_msg = {
                **saved_pinned_raw,
                "text": decrypt_with_fallback(
                    saved_pinned_raw.get("text", ""), session_token, f"chat:{saved_chat_id}"
                ),
            }

        result.append(
            {
                "id": saved_chat_id,
                "participantIds": [my_id],
                "otherUser": {
                    "chatId": "saved",
                    "name": "پیام‌های ذخیره شده",
                    "avatar": "",
                    "username": "saved",
                    "bio": "",
                    "online": False,
                    "verified": False,
                    "registrationDate": None,
                },
                "lastMessage": saved_last_msg,
                "pinnedMessage": saved_pinned_msg,
                "unreadCount": 0,
                "unreadMentionIds": [],
                "unreadReactionIds": [],
            }
        )

    official_last_msg_doc = (
        await cl_messages.find({"chatId": OFFICIAL_CHANNEL_CHAT_ID})
        .sort("timestamp", -1)
        .limit(1)
        .to_list(1)
    )
    official_last_msg = None
    if official_last_msg_doc:
        doc = official_last_msg_doc[0]
        official_last_msg = {
            "id": str(doc["_id"]),
            "text": decrypt_with_fallback(
                doc.get("text", ""), session_token, f"chat:{OFFICIAL_CHANNEL_CHAT_ID}"
            ),
            "senderId": doc.get("senderId"),
            "timestamp": dt_to_epoch_ms(doc.get("timestamp")),
            "file": doc.get("file"),
        }
    official_unread_count = await cl_messages.count_documents(
        {
            "chatId": OFFICIAL_CHANNEL_CHAT_ID,
            "senderId": {"$ne": my_id},
            "seenBy": {"$ne": my_id},
        }
    )

    result.append(
        {
            "id": OFFICIAL_CHANNEL_CHAT_ID,
            "participantIds": [OFFICIAL_CHANNEL_CHAT_ID],
            "chatType": "group",
            "otherUser": {
                "chatId": OFFICIAL_CHANNEL_CHAT_ID,
                "name": OFFICIAL_CHANNEL_NAME,
                "avatar": OFFICIAL_CHANNEL_AVATAR,
                "username": OFFICIAL_CHANNEL_CHAT_ID,
                "bio": "official_channel",
                "online": False,
                "verified": True,
                "registrationDate": None,
                "isGroup": True,
            },
            "lastMessage": official_last_msg,
            "unreadCount": int(official_unread_count or 0),
            "unreadMentionIds": [],
            "unreadReactionIds": [],
        }
    )

    return result


@app.get("/chats/{chat_id}/stats")
@limiter.limit("100/minute;2000/hour")
async def get_chat_stats(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    if is_official_channel_chat(chat_id):
        total_members = await cl_users.count_documents({})
        return {"totalMembers": int(total_members), "onlineMembers": 0}
    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", [])
    if my_id not in participants:
        raise HTTPException(status_code=403, detail="Forbidden")

    total_members = len(participants)
    online_members = await cl_users.count_documents(
        {"chatId": {"$in": participants}, "online": True}
    )

    return {
        "chatId": chat_id,
        "chatType": chat.get("chatType", "direct"),
        "totalMembers": total_members,
        "onlineMembers": online_members,
    }


@app.get("/chats/{chat_id}/members")
@limiter.limit("100/minute;2000/hour")
async def get_chat_members(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    if is_official_channel_chat(chat_id):
        sender_ids = await cl_messages.distinct(
            "senderId", {"chatId": OFFICIAL_CHANNEL_CHAT_ID}
        )
        unique_sender_ids = [
            str(uid).strip() for uid in sender_ids if str(uid or "").strip()
        ]
        users = await cl_users.find({"chatId": {"$in": unique_sender_ids}}).to_list(
            len(unique_sender_ids) or 1
        )
        users_by_id = {str(u.get("chatId", "")).strip(): u for u in users}
        result = []
        for uid in unique_sender_ids:
            u = users_by_id.get(uid)
            if not u:
                continue

            u_blocked_ids = set(_get_blocked_from_user_doc(u))
            blocked_by_other = my_id in u_blocked_ids
            presence = await resolve_user_presence_for_viewer(
                current_user,
                u,
                blocked=bool(blocked_by_other),
            )

            profile = u.get("profile", {})
            result.append(
                {
                    "chatId": uid,
                    "name": profile.get("name") or profile.get("username") or uid,
                    "username": profile.get("username", ""),
                    "avatar": (
                        profile.get("avatar", "")
                        if presence.get("avatarVisible") and not blocked_by_other
                        else ""
                    ),
                    "bio": (
                        decrypt_user_bio(
                            u, str(current_user.get("_session_token") or "")
                        )
                        if presence.get("bioVisible")
                        else ""
                    ),
                    "verified": bool(u.get("verified", False)),
                    "online": presence["online"],
                    "lastSeen": presence.get("lastSeen"),
                    "lastSeenCategory": presence.get("lastSeenCategory"),
                }
            )
        return result

    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", [])
    if my_id not in participants:
        raise HTTPException(status_code=403, detail="Forbidden")

    users = await cl_users.find({"chatId": {"$in": participants}}).to_list(200)
    result = []
    for u in users:
        u_blocked_ids = set(_get_blocked_from_user_doc(u))
        blocked_by_other = my_id in u_blocked_ids
        presence = await resolve_user_presence_for_viewer(
            current_user,
            u,
            blocked=bool(blocked_by_other),
        )

        profile = u.get("profile", {})
        result.append(
            {
                "chatId": u.get("chatId", ""),
                "name": profile.get("name")
                or profile.get("username")
                or u.get("chatId", ""),
                "username": profile.get("username", ""),
                "avatar": (
                    profile.get("avatar", "")
                    if presence.get("avatarVisible") and not blocked_by_other
                    else ""
                ),
                "bio": (
                    decrypt_user_bio(
                        u, str(current_user.get("_session_token") or "")
                    )
                    if presence.get("bioVisible")
                    else ""
                ),
                "verified": u.get("verified", False),
                "online": presence["online"],
                "lastSeen": presence.get("lastSeen"),
                "lastSeenCategory": presence.get("lastSeenCategory"),
            }
        )
    return result


@app.delete("/chats/{chat_id}")
@limiter.limit("30/minute;100/hour")
async def delete_chat(
    request: Request, chat_id: str, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]

    saved_chat_id = get_saved_messages_id(my_id)
    if chat_id == saved_chat_id:
        raise HTTPException(status_code=403, detail="Cannot delete saved messages")

    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", [])
    if chat.get("chatType") == "group":
        if not can_manage_group(current_user, chat):
            raise HTTPException(status_code=403, detail="Not allowed")
    elif my_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    file_ids: set = set()
    async for msg in cl_messages.find({"chatId": chat_id}, {"file": 1}):
        file_ids |= collect_file_ids(msg)

    await cl_messages.delete_many({"chatId": chat_id})
    await cl_chats.delete_one({"_id": chat_id})
    await release_files(file_ids)
    return {"message": "Chat deleted"}


@app.get("/chats/{chat_id}/messages")
@limiter.limit("100/minute;2000/hour")
async def get_messages(
    request: Request,
    chat_id: str,
    limit: int = 50,
    direction: str = Query("latest", pattern="^(latest|older|newer)$"),
    cursor_ts: Optional[int] = None,
    cursor_id: Optional[str] = None,
    around_id: Optional[str] = None,
    include_meta: bool = False,
    current_user: dict = Depends(get_current_user),
):
    current_user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    chat_scope = f"chat:{chat_id}"

    safe_limit = max(1, min(int(limit or 50), 200))

    def _cursor_filter() -> Optional[Dict[str, Any]]:
        if cursor_ts is None:
            return None
        cursor_dt = datetime.fromtimestamp(cursor_ts / 1000, tz=timezone.utc).replace(
            tzinfo=None
        )
        oid = ObjectId(cursor_id) if ObjectId.is_valid(str(cursor_id or "")) else None
        if direction == "older":
            return (
                {
                    "$or": [
                        {"timestamp": {"$lt": cursor_dt}},
                        {"timestamp": cursor_dt, "_id": {"$lt": oid}},
                    ]
                }
                if oid
                else {"timestamp": {"$lt": cursor_dt}}
            )
        if direction == "newer":
            return (
                {
                    "$or": [
                        {"timestamp": {"$gt": cursor_dt}},
                        {"timestamp": cursor_dt, "_id": {"$gt": oid}},
                    ]
                }
                if oid
                else {"timestamp": {"$gt": cursor_dt}}
            )
        return None

    def _has_more_filter(ts_ms: int, oid: str, op: str) -> Dict[str, Any]:
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).replace(tzinfo=None)
        return {
            "$or": [
                {"timestamp": {op: dt}},
                {"timestamp": dt, "_id": {op: ObjectId(oid)}},
            ]
        }

    saved_chat_id = get_saved_messages_id(current_user_id)
    if chat_id == saved_chat_id:
        if around_id:
            target_oid = await try_object_id(around_id)
            if not target_oid:
                raise HTTPException(status_code=400, detail="Invalid around_id")
            target_msg = await cl_messages.find_one({"_id": target_oid, "chatId": chat_id})
            if not target_msg:
                raise HTTPException(status_code=404, detail="Target message not found")

            target_dt = target_msg.get("timestamp")
            half = max(1, (safe_limit - 1) // 2)

            older_query = {
                "chatId": chat_id,
                "$or": [
                    {"timestamp": {"$lt": target_dt}},
                    {"timestamp": target_dt, "_id": {"$lt": target_oid}},
                ],
            }
            older_msgs = (
                await cl_messages.find(older_query)
                .sort([("timestamp", -1), ("_id", -1)])
                .limit(half)
                .to_list(half)
            )
            older_msgs.reverse()

            newer_query = {
                "chatId": chat_id,
                "$or": [
                    {"timestamp": {"$gt": target_dt}},
                    {"timestamp": target_dt, "_id": {"$gt": target_oid}},
                ],
            }
            newer_msgs = (
                await cl_messages.find(newer_query)
                .sort([("timestamp", 1), ("_id", 1)])
                .limit(half)
                .to_list(half)
            )

            msgs = older_msgs + [target_msg] + newer_msgs
        else:
            query: Dict[str, Any] = {"chatId": chat_id}
            extra = _cursor_filter()
            if extra:
                query = {"$and": [query, extra]}
            order = -1 if direction in ("latest", "older") else 1
            msgs = (
                await cl_messages.find(query)
                .sort([("timestamp", order), ("_id", order)])
                .limit(safe_limit)
                .to_list(safe_limit)
            )
            if direction in ("latest", "older"):
                msgs.reverse()

        payload = [
            {
                "id": str(m["_id"]),
                "chatId": m["chatId"],
                "senderId": m["senderId"],
                "text": decrypt_with_fallback(
                    m.get("text", ""), session_token, chat_scope
                ),
                "timestamp": dt_to_epoch_ms(m.get("timestamp")),
                "seen": True,
                "seenCount": max(1, len(m.get("seenBy", []) or [])),
                "seenBy": list(m.get("seenBy", []) or []),
                "replyTo": (
                    {
                        **m.get("replyTo"),
                        "text": decrypt_with_fallback(
                            (m.get("replyTo") or {}).get("text", ""),
                            session_token,
                            chat_scope,
                        ),
                    }
                    if isinstance(m.get("replyTo"), dict)
                    else None
                ),
                "edited": bool(m.get("editedAt")),
                "reactions": aggregate_reactions(m.get("reactions", [])),
                "forwardedFrom": m.get("forwardedFrom"),
                "file": m.get("file"),
                "reasoningContent": decrypt_with_fallback(
                    m.get("reasoningContent", ""), session_token, chat_scope
                ),
                "reasoningEnabled": bool(m.get("reasoningEnabled", False)),
                "reasoningDurationSec": int(m.get("reasoningDurationSec", 0) or 0),
                "aiModelKey": m.get("aiModelKey"),
                "aiModelName": m.get("aiModelName"),
                "searchEnabled": bool(m.get("searchEnabled", False)),
                "searchStatus": str(m.get("searchStatus") or ""),
                "searchSources": m.get("searchSources") or "",
                "clientId": m.get("clientId"),
            }
            for m in msgs
        ]
        if not include_meta:
            return payload
        if not payload:
            return {
                "messages": [],
                "hasOlder": False,
                "hasNewer": False,
                "oldestCursor": None,
                "newestCursor": None,
                "firstUnreadId": None,
                "unreadCount": 0,
            }
        oldest = payload[0]
        newest = payload[-1]
        return {
            "messages": payload,
            "hasOlder": (
                await cl_messages.count_documents(
                    {
                        "chatId": chat_id,
                        **_has_more_filter(oldest["timestamp"], oldest["id"], "$lt"),
                    },
                    limit=1,
                )
                > 0
            ),
            "hasNewer": (
                await cl_messages.count_documents(
                    {
                        "chatId": chat_id,
                        **_has_more_filter(newest["timestamp"], newest["id"], "$gt"),
                    },
                    limit=1,
                )
                > 0
            ),
            "oldestCursor": {
                "cursorTs": oldest["timestamp"],
                "cursorId": oldest["id"],
            },
            "newestCursor": {
                "cursorTs": newest["timestamp"],
                "cursorId": newest["id"],
            },
            "firstUnreadId": None,
            "unreadCount": 0,
        }

    participants: List[str] = []
    if is_official_channel_chat(chat_id):
        participants = [current_user_id]
    else:
        chat_doc = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
        participants = chat_doc.get("participants", []) if chat_doc else []
        if current_user_id not in participants:
            raise HTTPException(status_code=403, detail="Not allowed")

    if around_id:
        target_oid = await try_object_id(around_id)
        if not target_oid:
            raise HTTPException(status_code=400, detail="Invalid around_id")
        target_msg = await cl_messages.find_one({"_id": target_oid, "chatId": chat_id})
        if not target_msg:
            raise HTTPException(status_code=404, detail="Target message not found")

        target_dt = target_msg.get("timestamp")
        half = max(1, (safe_limit - 1) // 2)

        older_query = {
            "chatId": chat_id,
            "$or": [
                {"timestamp": {"$lt": target_dt}},
                {"timestamp": target_dt, "_id": {"$lt": target_oid}},
            ],
        }
        older_msgs = (
            await cl_messages.find(older_query)
            .sort([("timestamp", -1), ("_id", -1)])
            .limit(half)
            .to_list(half)
        )
        older_msgs.reverse()

        newer_query = {
            "chatId": chat_id,
            "$or": [
                {"timestamp": {"$gt": target_dt}},
                {"timestamp": target_dt, "_id": {"$gt": target_oid}},
            ],
        }
        newer_msgs = (
            await cl_messages.find(newer_query)
            .sort([("timestamp", 1), ("_id", 1)])
            .limit(half)
            .to_list(half)
        )

        msgs = older_msgs + [target_msg] + newer_msgs
    else:
        query: Dict[str, Any] = {"chatId": chat_id}
        extra = _cursor_filter()
        if extra:
            query = {"$and": [query, extra]}
        order = -1 if direction in ("latest", "older") else 1
        msgs = (
            await cl_messages.find(query)
            .sort([("timestamp", order), ("_id", order)])
            .limit(safe_limit)
            .to_list(safe_limit)
        )
        if direction in ("latest", "older"):
            msgs.reverse()

    def compute_seen(m: dict) -> bool:
        seen_by = m.get("seenBy", []) or []
        sender_id = m.get("senderId")

        if sender_id == current_user_id:
            if not participants:
                return False
            other_participants = [p for p in participants if p != sender_id]
            if not other_participants:
                return False
            return any(p in seen_by for p in other_participants)

        return current_user_id in seen_by

    payload = [
        {
            "id": str(m["_id"]),
            "chatId": m["chatId"],
            "senderId": m["senderId"],
            "text": decrypt_with_fallback(m.get("text", ""), session_token, chat_scope),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
            "seen": compute_seen(m),
            "seenCount": max(1, len(m.get("seenBy", []) or [])),
            "seenBy": list(m.get("seenBy", []) or []),
            "replyTo": (
                {
                    **m.get("replyTo"),
                    "text": decrypt_with_fallback(
                        (m.get("replyTo") or {}).get("text", ""),
                        session_token,
                        chat_scope,
                    ),
                }
                if isinstance(m.get("replyTo"), dict)
                else None
            ),
            "edited": bool(m.get("editedAt")),
            "reactions": aggregate_reactions(m.get("reactions", [])),
            "forwardedFrom": m.get("forwardedFrom"),
            "file": m.get("file"),
            "reasoningContent": decrypt_with_fallback(
                m.get("reasoningContent", ""), session_token, chat_scope
            ),
            "reasoningEnabled": bool(m.get("reasoningEnabled", False)),
            "reasoningDurationSec": int(m.get("reasoningDurationSec", 0) or 0),
            "aiModelKey": m.get("aiModelKey"),
            "aiModelName": m.get("aiModelName"),
            "searchEnabled": bool(m.get("searchEnabled", False)),
            "searchStatus": str(m.get("searchStatus") or ""),
            "searchSources": m.get("searchSources") or "",
            "chessInvite": m.get("chessInvite"),
            "clientId": m.get("clientId"),
        }
        for m in msgs
    ]
    if not include_meta:
        return payload
    if not payload:
        return {
            "messages": [],
            "hasOlder": False,
            "hasNewer": False,
            "oldestCursor": None,
            "newestCursor": None,
            "firstUnreadId": None,
            "unreadCount": 0,
        }
    first_unread = await cl_messages.find_one(
        {
            "chatId": chat_id,
            "senderId": {"$ne": current_user_id},
            "seenBy": {"$ne": current_user_id},
        },
        sort=[("timestamp", 1), ("_id", 1)],
        projection={"_id": 1},
    )
    unread_count = await cl_messages.count_documents(
        {
            "chatId": chat_id,
            "senderId": {"$ne": current_user_id},
            "seenBy": {"$ne": current_user_id},
        }
    )
    oldest = payload[0]
    newest = payload[-1]
    return {
        "messages": payload,
        "hasOlder": (
            await cl_messages.count_documents(
                {
                    "chatId": chat_id,
                    **_has_more_filter(oldest["timestamp"], oldest["id"], "$lt"),
                },
                limit=1,
            )
            > 0
        ),
        "hasNewer": (
            await cl_messages.count_documents(
                {
                    "chatId": chat_id,
                    **_has_more_filter(newest["timestamp"], newest["id"], "$gt"),
                },
                limit=1,
            )
            > 0
        ),
        "oldestCursor": {"cursorTs": oldest["timestamp"], "cursorId": oldest["id"]},
        "newestCursor": {"cursorTs": newest["timestamp"], "cursorId": newest["id"]},
        "firstUnreadId": str(first_unread["_id"]) if first_unread else None,
        "unreadCount": unread_count,
    }


@app.post("/files/upload")
@limiter.limit("30/minute;500/hour")
async def upload_file(
    request: Request,
    file: UploadFile = FastAPIFile(...),
    preview: Optional[UploadFile] = FastAPIFile(None),
    duration: Optional[float] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    file_content = await file.read()

    if len(file_content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB",
        )

    try:
        file_metadata = await save_uploaded_file(
            file_content, file.filename or "unnamed"
        )
        file_metadata["uploadedBy"] = current_user["chatId"]
        if duration is not None and duration > 0:
            file_metadata["duration"] = float(duration)
        if preview is not None:
            preview_content = await preview.read()
            if preview_content:
                preview_meta = await save_uploaded_file(
                    preview_content,
                    preview.filename or f"preview-{file.filename or 'image'}.jpg",
                )
                file_metadata["previewFileId"] = preview_meta.get("fileId")
                if preview_meta.get("fileId"):
                    file_metadata["previewUrl"] = f"/files/{preview_meta.get('fileId')}"

        return {"success": True, "file": file_metadata}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"File upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


@app.get("/files/{file_id}")
@limiter.limit("100/minute;2000/hour")
async def download_file(
    file_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if not validate_file_access(file_id):
        raise HTTPException(status_code=404, detail="File not found")

    decrypted = await read_file_content(file_id)
    if decrypted is None:
        raise HTTPException(status_code=404, detail="File not found")
    etag = hashlib.sha256(decrypted).hexdigest()
    incoming_etag = request.headers.get("if-none-match", "").strip('"')
    if incoming_etag and incoming_etag == etag:
        return Response(
            status_code=304,
            headers={
                "Cache-Control": "private, max-age=31536000, immutable",
                "ETag": f'"{etag}"',
                "Vary": "Authorization",
            },
        )

    file_path = get_file_path(file_id)
    last_modified = None
    try:
        if file_path.exists():
            last_modified = datetime.fromtimestamp(
                file_path.stat().st_mtime, tz=timezone.utc
            ).strftime("%a, %d %b %Y %H:%M:%S GMT")
    except Exception:
        last_modified = None

    headers = {
        "Cache-Control": "private, max-age=31536000, immutable",
        "ETag": f'"{etag}"',
        "Vary": "Authorization",
    }
    if last_modified:
        headers["Last-Modified"] = last_modified

    return Response(
        content=decrypted,
        media_type="application/octet-stream",
        headers=headers,
    )


@app.delete("/files/{file_id}")
@limiter.limit("30/minute;500/hour")
async def remove_uploaded_file(
    request: Request,
    file_id: str,
    current_user: dict = Depends(get_current_user),
):
    file_doc = await cl_messages.find_one({"file.fileId": file_id}, {"_id": 1})
    if file_doc:
        raise HTTPException(
            status_code=409, detail="File is already attached to a message"
        )

    if not validate_file_access(file_id):
        raise HTTPException(status_code=404, detail="File not found")

    await release_files({file_id})
    return {"success": True}


@app.get("/static/fonts/{filename}")
@app.get("/fonts/{filename}")
@limiter.limit("60/minute")
async def get_static_font(filename: str, request: Request):
    safe_name = os.path.basename(filename)
    media_type = (
        "font/ttf"
        if safe_name.endswith(".ttf")
        else ("font/woff2" if safe_name.endswith(".woff2") else "application/octet-stream")
    )
    s3_font = await read_static_font(safe_name)
    if s3_font is not None:
        return Response(
            content=s3_font,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*",
            },
        )
    candidates = [
        UPLOAD_DIR / "static" / "fonts" / safe_name,
        Path("uploads/static/fonts") / safe_name,
        Path("back-end/uploads/static/fonts") / safe_name,
        Path(__file__).resolve().parent / "uploads" / "static" / "fonts" / safe_name,
        Path(__file__).resolve().parent.parent / "uploads" / "static" / "fonts" / safe_name,
        Path("/app/back-end/uploads/static/fonts") / safe_name,
        Path("/app/uploads/static/fonts") / safe_name,
    ]
    for path in candidates:
        if path.is_file():
            media_type = (
                "font/ttf"
                if safe_name.endswith(".ttf")
                else ("font/woff2" if safe_name.endswith(".woff2") else "application/octet-stream")
            )
            return FileResponse(
                path=str(path),
                media_type=media_type,
                headers={
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    raise HTTPException(status_code=404, detail="Font not found")


STOCKFISH_MEDIA_TYPES = {
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
}


@app.get("/static/stockfish/{filename}")
@limiter.limit("120/minute")
async def get_static_stockfish(filename: str, request: Request):
    safe_name = os.path.basename(filename)
    media_type = STOCKFISH_MEDIA_TYPES.get(Path(safe_name).suffix, "application/octet-stream")
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
    }
    s3_engine = await read_static_stockfish(safe_name)
    if s3_engine is not None:
        return Response(content=s3_engine, media_type=media_type, headers=headers)
    candidates = [
        UPLOAD_DIR / "static" / "stockfish" / safe_name,
        Path("uploads/static/stockfish") / safe_name,
        Path("back-end/uploads/static/stockfish") / safe_name,
        Path(__file__).resolve().parent / "uploads" / "static" / "stockfish" / safe_name,
        Path("/app/back-end/uploads/static/stockfish") / safe_name,
    ]
    for path in candidates:
        if path.is_file():
            return FileResponse(path=str(path), media_type=media_type, headers=headers)
    raise HTTPException(status_code=404, detail="Engine file not found")


@app.post("/chats/{chat_id}/messages/{message_id}/react")
@limiter.limit("30/minute;500/hour")
async def add_reaction(
    request: Request,
    chat_id: str,
    message_id: str,
    req: ReactionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add or toggle a reaction to a message"""
    user_id = current_user["chatId"]
    emoji = req.emoji

    if emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail="Invalid emoji")

    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = msg.get("reactions", [])
    msg_sender_id = str(msg.get("senderId") or "").strip()

    user_reaction = next((r for r in reactions if r.get("userId") == user_id), None)

    if user_reaction:
        if user_reaction.get("emoji") == emoji:
            reactions = [r for r in reactions if r.get("userId") != user_id]
        else:
            for r in reactions:
                if r.get("userId") == user_id:
                    r["emoji"] = emoji
                    r["seen"] = bool(user_id == msg_sender_id)
    else:
        reactions.append(
            {
                "userId": user_id,
                "emoji": emoji,
                "seen": bool(user_id == msg_sender_id),
            }
        )

    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id
    is_official = is_official_channel_chat(chat_id)

    has_unseen_reaction = (
        not is_saved
        and not is_official
        and bool(msg_sender_id)
        and any(
            r.get("userId") != msg_sender_id and r.get("seen") is False
            for r in reactions
        )
    )
    unread_reaction_user_ids = [msg_sender_id] if has_unseen_reaction else []

    await cl_messages.update_one(
        {"_id": oid},
        {
            "$set": {
                "reactions": reactions,
                "unreadReactionUserIds": unread_reaction_user_ids,
            }
        },
    )

    aggregated_reactions = aggregate_reactions(reactions)

    participants = [user_id] if is_saved else []
    if not is_saved:
        participants_doc = await cl_chats.find_one(
            {"_id": chat_id}, {"participants": 1}
        )
        participants = (
            participants_doc.get("participants", []) if participants_doc else []
        )

    if participants:
        await broadcast(
            participants,
            {
                "type": "reaction_updated",
                "chatId": chat_id,
                "messageId": message_id,
                "reactions": aggregated_reactions,
                "unreadReactionUserIds": unread_reaction_user_ids,
            },
        )

    return {"reactions": aggregated_reactions}


@app.get("/chats/{chat_id}/messages/{message_id}/seen-by")
@limiter.limit("100/minute;2000/hour")
async def get_message_seen_by(
    request: Request,
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]

    chat = await cl_chats.find_one({"_id": chat_id}, {"participants": 1, "chatType": 1})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", []) or []
    if user_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    if chat.get("chatType") != "group":
        raise HTTPException(
            status_code=400, detail="Seen-by is only available in groups"
        )

    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.get("senderId") != user_id:
        raise HTTPException(status_code=403, detail="Only sender can view seen-by")

    seen_by_raw = msg.get("seenBy", []) or []
    seen_by = [sid for sid in seen_by_raw if sid != user_id and sid in participants]
    if not seen_by:
        return {"seenBy": []}

    users = await cl_users.find({"chatId": {"$in": seen_by}}).to_list(len(seen_by))
    users_by_chat_id = {u.get("chatId"): u for u in users}

    result = []
    for sid in seen_by:
        u = users_by_chat_id.get(sid)

        u_blocked_ids = set(_get_blocked_from_user_doc(u))
        blocked_by_other = user_id in u_blocked_ids
        presence = await resolve_user_presence_for_viewer(
            current_user,
            u,
            blocked=bool(blocked_by_other),
        )

        profile = (u or {}).get("profile", {})
        result.append(
            {
                "chatId": sid,
                "name": profile.get("name") or profile.get("username") or sid,
                "username": profile.get("username", ""),
                "avatar": (
                    profile.get("avatar", "")
                    if presence.get("avatarVisible") and not blocked_by_other
                    else ""
                ),
                "verified": bool((u or {}).get("verified", False)),
            }
        )

    return {"seenBy": result}


@app.delete("/chats/{chat_id}/messages/{message_id}/react")
@limiter.limit("30/minute;500/hour")
async def remove_reaction(
    request: Request,
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove user's reaction from a message"""
    user_id = current_user["chatId"]

    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = msg.get("reactions", [])
    msg_sender_id = str(msg.get("senderId") or "").strip()

    reactions = [r for r in reactions if r.get("userId") != user_id]

    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id
    is_official = is_official_channel_chat(chat_id)

    has_unseen_reaction = (
        not is_saved
        and not is_official
        and bool(msg_sender_id)
        and any(
            r.get("userId") != msg_sender_id and r.get("seen") is False
            for r in reactions
        )
    )
    unread_reaction_user_ids = [msg_sender_id] if has_unseen_reaction else []

    await cl_messages.update_one(
        {"_id": oid},
        {
            "$set": {
                "reactions": reactions,
                "unreadReactionUserIds": unread_reaction_user_ids,
            }
        },
    )

    aggregated_reactions = aggregate_reactions(reactions)

    participants = [user_id] if is_saved else []
    if not is_saved:
        participants_doc = await cl_chats.find_one(
            {"_id": chat_id}, {"participants": 1}
        )
        participants = (
            participants_doc.get("participants", []) if participants_doc else []
        )

    if participants:
        await broadcast(
            participants,
            {
                "type": "reaction_updated",
                "chatId": chat_id,
                "messageId": message_id,
                "reactions": aggregated_reactions,
                "unreadReactionUserIds": unread_reaction_user_ids,
            },
        )

    return {"reactions": aggregated_reactions}


@app.post("/chats/{chat_id}/messages/{message_id}/ack-mention")
@limiter.limit("120/minute;2000/hour")
async def ack_message_mention(
    request: Request,
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")
    await cl_messages.update_one(
        {"_id": oid, "chatId": chat_id},
        {"$pull": {"unreadMentionUserIds": user_id}},
    )
    return {"ok": True}


@app.post("/chats/{chat_id}/messages/{message_id}/ack-reaction")
@limiter.limit("120/minute;2000/hour")
async def ack_message_reaction(
    request: Request,
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")
    msg = await cl_messages.find_one(
        {"_id": oid, "chatId": chat_id}, {"reactions": 1, "senderId": 1}
    )
    if not msg:
        return {"ok": True}
    reactions = msg.get("reactions", []) or []
    if str(msg.get("senderId") or "") == user_id:
        for r in reactions:
            r["seen"] = True
    await cl_messages.update_one(
        {"_id": oid, "chatId": chat_id},
        {
            "$pull": {"unreadReactionUserIds": user_id},
            "$set": {"reactions": reactions},
        },
    )
    return {"ok": True}


@app.post("/chats/{chat_id}/pin/{message_id}")
@limiter.limit("30/minute;300/hour")
async def pin_message(
    request: Request,
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    chat_scope = f"chat:{chat_id}"

    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id
    is_official = is_official_channel_chat(chat_id)

    if is_official and not bool(current_user.get("verified", False)):
        raise HTTPException(status_code=403, detail="Forbidden")

    chat_doc = None
    if not is_saved and not is_official:
        chat_doc = await cl_chats.find_one({"_id": chat_id})
        if not chat_doc:
            raise HTTPException(status_code=404, detail="Chat not found")
        if user_id not in (chat_doc.get("participants", []) or []):
            raise HTTPException(status_code=403, detail="Forbidden")
        if chat_doc.get("chatType") == "group" and not can_manage_group(
            current_user, chat_doc
        ):
            raise HTTPException(status_code=403, detail="Forbidden")

    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    sender_doc = await cl_users.find_one({"chatId": msg.get("senderId")}, {"profile.name": 1})
    sender_name = (sender_doc or {}).get("profile", {}).get("name") or "کاربر"

    pinned_doc = {
        "id": str(msg["_id"]),
        "senderId": msg.get("senderId"),
        "senderName": sender_name,
        "text": msg.get("text", ""),
        "timestamp": dt_to_epoch_ms(msg.get("timestamp")),
        "file": msg.get("file"),
        "pinnedBy": user_id,
        "pinnedAt": dt_to_epoch_ms(utc_now()),
    }

    if not is_saved and not is_official:
        await cl_chats.update_one(
            {"_id": chat_id},
            {"$set": {"pinnedMessage": pinned_doc, "updatedAt": utc_now()}},
        )
        await cl_users.update_one(
            {"chatId": user_id},
            {"$unset": {f"settings.hiddenPinnedMessages.{chat_id}": ""}},
        )
    elif is_saved:
        await cl_users.update_one(
            {"chatId": user_id},
            {"$set": {"settings.savedPinnedMessage": pinned_doc}},
        )

    participants = [user_id] if is_saved else []
    if is_official:
        participants = await cl_users.distinct("chatId", {})
    elif not is_saved:
        participants = chat_doc.get("participants", []) if chat_doc else []

    if participants:
        await broadcast(
            participants,
            {
                "type": "message_pinned",
                "chatId": chat_id,
                "pinnedMessage": pinned_doc,
            },
        )

    ret_pinned = {
        **pinned_doc,
        "text": decrypt_with_fallback(pinned_doc.get("text", ""), session_token, chat_scope),
    }
    return {"ok": True, "pinnedMessage": ret_pinned}


@app.delete("/chats/{chat_id}/pin")
@limiter.limit("30/minute;300/hour")
async def unpin_message(
    request: Request,
    chat_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id
    is_official = is_official_channel_chat(chat_id)

    if is_official and not bool(current_user.get("verified", False)):
        raise HTTPException(status_code=403, detail="Forbidden")

    chat_doc = None
    if not is_saved and not is_official:
        chat_doc = await cl_chats.find_one({"_id": chat_id})
        if not chat_doc:
            raise HTTPException(status_code=404, detail="Chat not found")
        if user_id not in (chat_doc.get("participants", []) or []):
            raise HTTPException(status_code=403, detail="Forbidden")

    is_group = bool(chat_doc and chat_doc.get("chatType") == "group")
    if is_group and not can_manage_group(current_user, chat_doc):
        current_pinned = chat_doc.get("pinnedMessage") or {}
        pinned_id = current_pinned.get("id") if isinstance(current_pinned, dict) else None
        if pinned_id:
            await cl_users.update_one(
                {"chatId": user_id},
                {"$set": {f"settings.hiddenPinnedMessages.{chat_id}": pinned_id}},
            )
        return {"ok": True, "personalOnly": True}

    if not is_saved and not is_official:
        await cl_chats.update_one(
            {"_id": chat_id},
            {"$set": {"pinnedMessage": None, "updatedAt": utc_now()}},
        )
    elif is_saved:
        await cl_users.update_one(
            {"chatId": user_id},
            {"$set": {"settings.savedPinnedMessage": None}},
        )

    participants = [user_id] if is_saved else []
    if is_official:
        participants = await cl_users.distinct("chatId", {})
    elif not is_saved:
        participants = chat_doc.get("participants", []) if chat_doc else []

    if participants:
        await broadcast(
            participants,
            {
                "type": "message_unpinned",
                "chatId": chat_id,
            },
        )

    return {"ok": True}


@app.post("/chats/{chat_id}/messages/batch-delete")
@limiter.limit("30/minute;500/hour")
async def batch_delete_messages(
    request: Request,
    chat_id: str,
    req: BatchDeleteMessagesRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    raw_ids = [str(mid or "").strip() for mid in (req.messageIds or []) if str(mid or "").strip()]
    if not raw_ids:
        return {"ok": True, "deletedIds": []}

    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id
    is_official = is_official_channel_chat(chat_id)
    chat_doc = None

    if not is_saved and not is_official:
        chat_doc = await cl_chats.find_one(
            {"_id": chat_id},
            {"participants": 1, "pinnedMessage": 1, "chatType": 1, "createdBy": 1},
        )
        if not chat_doc or user_id not in (chat_doc.get("participants", []) or []):
            raise HTTPException(status_code=403, detail="Forbidden")

    oids = []
    for mid in dict.fromkeys(raw_ids):
        oid = await try_object_id(mid)
        if oid:
            oids.append(oid)

    if not oids:
        return {"ok": True, "deletedIds": []}

    msgs = await cl_messages.find({"_id": {"$in": oids}, "chatId": chat_id}).to_list(len(oids))
    if not msgs:
        return {"ok": True, "deletedIds": []}

    is_group = bool(chat_doc and chat_doc.get("chatType") == "group")
    can_delete_others = (
        can_manage_group(current_user, chat_doc)
        if is_group
        else bool(current_user.get("verified", False))
    )
    authorized_msgs = [
        m for m in msgs if m.get("senderId") == user_id or can_delete_others
    ]
    if not authorized_msgs:
        raise HTTPException(status_code=403, detail="Forbidden")

    authorized_oids = [m["_id"] for m in authorized_msgs]
    deleted_ids = [str(m["_id"]) for m in authorized_msgs]
    deleted_id_set = set(deleted_ids)

    file_ids: set = set()
    for m in authorized_msgs:
        file_ids |= collect_file_ids(m)

    await cl_messages.delete_many({"_id": {"$in": authorized_oids}})
    await release_files(file_ids)

    participants = [user_id] if is_saved else []
    if is_official:
        participants = await cl_users.distinct("chatId", {})
    elif chat_doc:
        participants = chat_doc.get("participants", []) or []

    last_msg = None
    if not is_saved and not is_official:
        last_msg = await build_last_message(chat_id, session_token)
        update_fields = {"lastMessage": last_msg, "updatedAt": utc_now()}
        curr_pinned = (chat_doc.get("pinnedMessage") or {}) if chat_doc else {}
        unpinned = False
        if isinstance(curr_pinned, dict) and curr_pinned.get("id") in deleted_id_set:
            update_fields["pinnedMessage"] = None
            unpinned = True
        await cl_chats.update_one({"_id": chat_id}, {"$set": update_fields})
        if unpinned and participants:
            await broadcast(
                participants,
                {
                    "type": "message_unpinned",
                    "chatId": chat_id,
                },
            )

    out_last = None
    if last_msg:
        out_last = {
            **last_msg,
            "timestamp": dt_to_epoch_ms(last_msg.get("timestamp")),
        }

    if participants:
        await broadcast(
            participants,
            {
                "type": "message_deleted",
                "chatId": chat_id,
                "messageId": deleted_ids[-1],
                "messageIds": deleted_ids,
                "lastMessage": out_last,
            },
        )

    return {"ok": True, "deletedIds": deleted_ids, "lastMessage": out_last}


@app.post("/messages/forward")
@limiter.limit("60/minute;1000/hour")
async def forward_message(
    request: Request,
    req: ForwardMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    target_chat_id = req.targetChatId

    batch_items: List[ForwardBatchItem] = []
    if req.items:
        batch_items = list(req.items)
    elif req.messageId:
        batch_items = [
            ForwardBatchItem(
                messageId=req.messageId,
                encryptedText=req.encryptedText,
                encryptedReasoningContent=req.encryptedReasoningContent,
                encryptedReplyText=req.encryptedReplyText,
                encryptedSearchSources=req.encryptedSearchSources,
                clientId=req.clientId,
            )
        ]
    if not batch_items:
        raise HTTPException(status_code=400, detail="No messages to forward")

    saved_chat_id = get_saved_messages_id(user_id)
    is_target_saved = target_chat_id == saved_chat_id
    is_target_official = is_official_channel_chat(target_chat_id)
    if is_target_official and not bool(current_user.get("verified", False)):
        raise HTTPException(
            status_code=403, detail="Only verified users can send in official channel"
        )
    if not is_target_saved and not is_target_official:
        target_chat = await cl_chats.find_one({"_id": target_chat_id})
        if not target_chat:
            raise HTTPException(status_code=404, detail="Target chat not found")

        target_participants = target_chat.get("participants", [])
        if user_id not in target_participants:
            raise HTTPException(
                status_code=403, detail="Not authorized to send to this chat"
            )
        if target_chat.get("chatType") != "group":
            other_id = next((p for p in target_participants if p != user_id), "")
            if other_id and await _is_direct_blocked_between(user_id, other_id):
                raise HTTPException(
                    status_code=403, detail="Direct chat is blocked between users"
                )

    target_scope = f"chat:{target_chat_id}"
    prepared: List[Dict[str, Any]] = []
    old_id_to_new_id: Dict[str, str] = {}
    old_id_to_plain_text: Dict[str, str] = {}

    for item in batch_items:
        oid = await try_object_id(item.messageId)
        if not oid:
            continue

        original_msg = await cl_messages.find_one({"_id": oid})
        is_ai_message = False
        if not original_msg:
            original_msg = await cl_ai_messages.find_one({"_id": oid})
            is_ai_message = True
        if not original_msg:
            continue

        if is_ai_message:
            if original_msg.get("userId") != user_id:
                continue
        else:
            original_chat_id = original_msg.get("chatId")
            if original_chat_id == saved_chat_id:
                pass
            elif is_official_channel_chat(original_chat_id):
                pass
            else:
                source_chat_doc = await cl_chats.find_one({"_id": original_chat_id})
                if not source_chat_doc:
                    continue
                if user_id not in (source_chat_doc.get("participants", []) or []):
                    continue

        file_data = None
        source_chat_for_file = ""
        if is_ai_message:
            ai_role = str(original_msg.get("role") or "").strip().lower()
            if ai_role == "assistant":
                forwarded_from_info = {
                    "originalSenderId": "ai",
                    "name": "NovaRoom AI",
                    "username": "novaroom_ai",
                }
            else:
                profile = current_user.get("profile", {})
                forwarded_from_info = {
                    "originalSenderId": user_id,
                    "name": profile.get("name") or profile.get("username") or user_id,
                    "username": profile.get("username", ""),
                }
            source_ai_scope = f"ai:{original_msg.get('aiChatId', '')}"
            message_text = decrypt_with_fallback(
                original_msg.get("content", ""), session_token, source_ai_scope
            )
            reasoning_content = decrypt_with_fallback(
                str(original_msg.get("reasoningContent") or ""),
                session_token,
                source_ai_scope,
            )
            reasoning_enabled = bool(original_msg.get("reasoningEnabled", False))
            reasoning_duration_sec = int(
                original_msg.get("reasoningDurationSec", 0) or 0
            )
            ai_model_key = (
                normalize_ai_model_key(original_msg.get("aiModelKey") or "nova-flash")
                if ai_role == "assistant"
                else None
            )
            ai_model_name = (
                ai_model_label_from_key(ai_model_key)
                if ai_role == "assistant"
                else None
            )
            search_enabled = bool(original_msg.get("searchEnabled", False))
            search_status = str(original_msg.get("searchStatus") or "")
            search_sources = (
                _decode_search_sources(
                    original_msg.get("searchSources"), session_token, source_ai_scope
                )
                if search_enabled
                else []
            )
        else:
            existing_forwarded_from = (
                original_msg.get("forwardedFrom")
                or original_msg.get("forwarded_from")
                or original_msg.get("forwardedfrom")
            )
            existing_original_sender_id = ""
            existing_name = "Unknown"
            existing_username = ""
            if isinstance(existing_forwarded_from, dict):
                existing_original_sender_id = str(
                    existing_forwarded_from.get("originalSenderId")
                    or existing_forwarded_from.get("original_sender_id")
                    or ""
                ).strip()
                existing_name = (
                    str(
                        existing_forwarded_from.get("name")
                        or existing_forwarded_from.get("fullName")
                        or "Unknown"
                    ).strip()
                    or "Unknown"
                )
                existing_username = str(
                    existing_forwarded_from.get("username")
                    or existing_forwarded_from.get("userName")
                    or ""
                ).strip()

            if existing_original_sender_id:
                forwarded_from_info = {
                    "originalSenderId": existing_original_sender_id,
                    "name": existing_name,
                    "username": existing_username,
                }
            else:
                original_sender_id = original_msg.get("senderId")
                if is_official_channel_chat(str(original_msg.get("chatId") or "")):
                    forwarded_from_info = {
                        "originalSenderId": OFFICIAL_CHANNEL_CHAT_ID,
                        "name": OFFICIAL_CHANNEL_NAME,
                        "username": OFFICIAL_CHANNEL_CHAT_ID,
                    }
                else:
                    original_sender = await cl_users.find_one(
                        {"chatId": original_sender_id}
                    )
                    forwarded_from_info = {
                        "originalSenderId": original_sender_id,
                        "name": (
                            original_sender["profile"]["name"]
                            if original_sender
                            else "Unknown"
                        ),
                        "username": (
                            original_sender["profile"]["username"]
                            if original_sender
                            else ""
                        ),
                    }
            source_chat_for_file = str(original_msg.get("chatId") or "")
            source_chat_scope = f"chat:{source_chat_for_file}"
            message_text = decrypt_with_fallback(
                original_msg.get("text", ""), session_token, source_chat_scope
            )
            file_data = original_msg.get("file")
            reasoning_content = decrypt_with_fallback(
                str(original_msg.get("reasoningContent") or ""),
                session_token,
                source_chat_scope,
            )
            reasoning_enabled = bool(original_msg.get("reasoningEnabled", False))
            reasoning_duration_sec = int(
                original_msg.get("reasoningDurationSec", 0) or 0
            )
            ai_model_key = (
                normalize_ai_model_key(original_msg.get("aiModelKey") or "")
                if original_msg.get("aiModelKey")
                else None
            )
            ai_model_name = str(original_msg.get("aiModelName") or "").strip() or (
                ai_model_label_from_key(ai_model_key) if ai_model_key else None
            )
            search_enabled = bool(original_msg.get("searchEnabled", False))
            search_status = str(original_msg.get("searchStatus") or "")
            search_sources = (
                _decode_search_sources(
                    original_msg.get("searchSources"), session_token, source_chat_scope
                )
                if search_enabled
                else []
            )

        plain_for_reply = message_text or (
            str((file_data or {}).get("fileName") or "") if file_data else ""
        )
        new_oid = ObjectId()
        old_id_to_new_id[item.messageId] = str(new_oid)
        old_id_to_plain_text[item.messageId] = plain_for_reply

        prepared.append(
            {
                "item": item,
                "new_oid": new_oid,
                "original_msg": original_msg,
                "is_ai_message": is_ai_message,
                "message_text": message_text,
                "reasoning_content": reasoning_content,
                "reasoning_enabled": reasoning_enabled,
                "reasoning_duration_sec": reasoning_duration_sec,
                "ai_model_key": ai_model_key,
                "ai_model_name": ai_model_name,
                "search_enabled": search_enabled,
                "search_status": search_status,
                "search_sources": search_sources,
                "forwarded_from_info": forwarded_from_info,
                "file_data": file_data,
                "source_chat_for_file": source_chat_for_file,
            }
        )

    if not prepared:
        raise HTTPException(status_code=404, detail="Message not found")

    base_now = utc_now()
    forwarded_docs: List[Dict[str, Any]] = []

    for idx, entry in enumerate(prepared):
        item = entry["item"]
        original_msg = entry["original_msg"]
        is_ai_message = entry["is_ai_message"]
        message_text = entry["message_text"]
        provided_encrypted_text = (
            str(item.encryptedText).strip()
            if isinstance(item.encryptedText, str)
            else ""
        )
        provided_encrypted_reasoning = (
            str(item.encryptedReasoningContent).strip()
            if isinstance(item.encryptedReasoningContent, str)
            else ""
        )
        provided_encrypted_search = (
            str(item.encryptedSearchSources).strip()
            if isinstance(item.encryptedSearchSources, str)
            else ""
        )
        encrypted_forward_text = (
            provided_encrypted_text
            if provided_encrypted_text
            else encrypt_scoped_text(message_text, session_token, target_scope)
        )
        encrypted_forward_reasoning = (
            provided_encrypted_reasoning
            if provided_encrypted_reasoning
            else encrypt_scoped_text(
                entry["reasoning_content"], session_token, target_scope
            )
        )

        reply_to_doc = None
        raw_reply = None if is_ai_message else original_msg.get("replyTo")
        orig_reply_id = (
            str(raw_reply.get("id") or "").strip()
            if isinstance(raw_reply, dict)
            else ""
        )
        if orig_reply_id and orig_reply_id in old_id_to_new_id:
            mapped_reply_id = old_id_to_new_id[orig_reply_id]
            provided_enc_reply = (
                str(item.encryptedReplyText).strip()
                if isinstance(item.encryptedReplyText, str)
                else ""
            )
            if not provided_enc_reply:
                provided_enc_reply = encrypt_scoped_text(
                    old_id_to_plain_text.get(orig_reply_id, ""),
                    session_token,
                    target_scope,
                )
            reply_to_doc = {
                "id": mapped_reply_id,
                "senderId": user_id,
                "text": provided_enc_reply,
            }

        forwarded_msg = {
            "_id": entry["new_oid"],
            "chatId": target_chat_id,
            "senderId": user_id,
            "text": encrypted_forward_text,
            "textEncrypted": True,
            "timestamp": base_now + timedelta(milliseconds=idx),
            "seenBy": [user_id],
            "replyTo": reply_to_doc,
            "reactions": [],
            "forwardedFrom": entry["forwarded_from_info"],
            "reasoningContent": encrypted_forward_reasoning,
            "reasoningEnabled": entry["reasoning_enabled"],
            "reasoningDurationSec": entry["reasoning_duration_sec"],
            "aiModelKey": entry["ai_model_key"],
            "aiModelName": entry["ai_model_name"],
            "searchEnabled": entry["search_enabled"],
            "searchStatus": entry["search_status"],
            "searchSources": (
                provided_encrypted_search
                if provided_encrypted_search
                else (
                    encrypt_scoped_text(
                        json.dumps(entry["search_sources"], ensure_ascii=False),
                        session_token,
                        target_scope,
                    )
                    if entry["search_sources"]
                    else ""
                )
            ),
            "clientId": str(item.clientId or "").strip() or None,
        }

        file_data = entry["file_data"]
        if file_data:
            remapped_file = await _remap_forward_file_to_target_chat(
                dict(file_data),
                entry["source_chat_for_file"],
                target_chat_id,
                user_id,
            )
            forwarded_msg["file"] = remapped_file

        forwarded_docs.append(forwarded_msg)

    created_file_ids: set = set()
    for doc in forwarded_docs:
        created_file_ids |= collect_file_ids(doc)
    try:
        await cl_messages.insert_many(forwarded_docs)
    except Exception:
        await release_files(created_file_ids)
        raise

    last_doc = forwarded_docs[-1]
    last_msg = {
        "id": str(last_doc["_id"]),
        "text": last_doc["text"] if prepared[-1]["message_text"] else "[File]",
        "senderId": user_id,
        "timestamp": last_doc["timestamp"],
        "file": last_doc.get("file"),
    }

    if not is_target_saved and not is_target_official:
        await cl_chats.update_one(
            {"_id": target_chat_id},
            {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
        )

    participants_to_notify = [user_id] if is_target_saved else []
    if is_target_official:
        participants_to_notify = await cl_users.distinct("chatId", {})
    elif not is_target_saved:
        target_chat_doc = await cl_chats.find_one(
            {"_id": target_chat_id}, {"participants": 1}
        )
        participants_to_notify = (
            target_chat_doc.get("participants", []) if target_chat_doc else []
        )

    created_ids: List[str] = []
    for entry, forwarded_msg in zip(prepared, forwarded_docs):
        item = entry["item"]
        msg_id = str(forwarded_msg["_id"])
        created_ids.append(msg_id)
        if not participants_to_notify:
            continue
        message_text = entry["message_text"]
        reply_payload = None
        if isinstance(forwarded_msg.get("replyTo"), dict):
            reply_payload = dict(forwarded_msg["replyTo"])
        msg_payload = {
            "type": "new_message",
            "chatId": target_chat_id,
            "message": {
                "id": msg_id,
                "chatId": target_chat_id,
                "senderId": user_id,
                "text": forwarded_msg["text"] if message_text else "",
                "timestamp": dt_to_epoch_ms(forwarded_msg["timestamp"]),
                "seen": False,
                "replyTo": reply_payload,
                "edited": False,
                "reactions": [],
                "forwardedFrom": entry["forwarded_from_info"],
                "file": forwarded_msg.get("file"),
                "reasoningContent": forwarded_msg["reasoningContent"],
                "reasoningEnabled": entry["reasoning_enabled"],
                "reasoningDurationSec": entry["reasoning_duration_sec"],
                "aiModelKey": entry["ai_model_key"],
                "aiModelName": entry["ai_model_name"],
                "searchEnabled": entry["search_enabled"],
                "searchStatus": entry["search_status"],
                "searchSources": entry["search_sources"],
                "clientId": str(item.clientId or "").strip() or None,
            },
        }
        await broadcast(participants_to_notify, msg_payload)

    if not is_target_saved:
        target_chat_meta = await cl_chats.find_one(
            {"_id": target_chat_id}, {"chatType": 1}
        )
        schedule_push(
            notify_chat_message(
                target_chat_id,
                user_id,
                participants_to_notify,
                bool(target_chat_meta and target_chat_meta.get("chatType") == "group"),
                is_target_official,
                [],
            )
        )

    return {
        "success": True,
        "messageId": created_ids[-1],
        "messageIds": created_ids,
        "chatId": target_chat_id,
    }


async def safe_send(user_id: str, message: dict):
    conns = list(active_connections.get(user_id, []))
    if not conns:
        return

    results = await asyncio.gather(
        *(ws.send_json(message) for ws in conns), return_exceptions=True
    )

    dead_connections: List[WebSocket] = []
    for ws, r in zip(conns, results):
        if isinstance(r, Exception):
            dead_connections.append(ws)

    if dead_connections:
        for dead_ws in dead_connections:
            if dead_ws in active_connections.get(user_id, []):
                active_connections[user_id].remove(dead_ws)

        if not active_connections.get(user_id):
            active_connections.pop(user_id, None)


async def broadcast(user_ids: Iterable[str], payload: dict):
    await asyncio.gather(
        *(safe_send(uid, payload) for uid in set(user_ids)), return_exceptions=True
    )


def _notif_settings(user_doc) -> dict:
    raw = ((user_doc or {}).get("settings") or {}).get("notifications") or {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "enabled": bool(raw.get("enabled", True)),
        "sound": bool(raw.get("sound", True)),
    }


def _chat_notify_modes(user_doc) -> dict:
    raw = ((user_doc or {}).get("settings") or {}).get("chatNotifyModes") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(key): value for key, value in raw.items() if value in ("muted", "mentions")}


def _notification_prefs(user_doc) -> dict:
    settings = _notif_settings(user_doc)
    return {
        "enabled": settings["enabled"],
        "sound": settings["sound"],
        "chatModes": _chat_notify_modes(user_doc),
    }


def _send_webpush_sync(sub: dict, payload: dict) -> Optional[int]:
    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=86400,
            headers={"Urgency": "high"},
        )
        return None
    except WebPushException as error:
        response = getattr(error, "response", None)
        return response.status_code if response is not None else 0
    except Exception:
        return 0


_push_tasks: set = set()


def schedule_push(coro) -> None:
    task = asyncio.create_task(coro)
    _push_tasks.add(task)
    task.add_done_callback(_push_tasks.discard)


async def push_to_users(user_ids: Iterable[str], payload_for_user) -> None:
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        return
    ids = sorted({str(uid) for uid in user_ids if uid})
    if not ids:
        return
    try:
        users = await cl_users.find(
            {"chatId": {"$in": ids}, **NOT_PURGING},
            {"chatId": 1, "settings": 1, "login.sessions": 1},
        ).to_list(len(ids))
        for user in users:
            settings = _notif_settings(user)
            if not settings["enabled"]:
                continue
            payload = payload_for_user(user)
            if payload is None:
                continue
            payload = dict(payload)
            payload["silent"] = not settings["sound"]
            uid = user.get("chatId")
            valid_hashes = {
                session.get("tokenHash") for session in _normalize_session_list(user)
            }
            subscriptions = await cl_push_subscriptions.find({"userId": uid}).to_list(
                None
            )
            if not subscriptions:
                continue
            active = [
                sub for sub in subscriptions if sub.get("tokenHash") in valid_hashes
            ]
            stale_ids = [
                sub["_id"]
                for sub in subscriptions
                if sub.get("tokenHash") not in valid_hashes
            ]
            statuses = await asyncio.gather(
                *(
                    asyncio.to_thread(_send_webpush_sync, sub, payload)
                    for sub in active
                )
            )
            stale_ids.extend(
                sub["_id"]
                for sub, status in zip(active, statuses)
                if status in (404, 410)
            )
            if stale_ids:
                await cl_push_subscriptions.delete_many(
                    {"_id": {"$in": stale_ids}}
                )
    except Exception:
        traceback.print_exc()


async def notify_chat_message(
    chat_id_target: str,
    sender_id: str,
    participants: List[str],
    is_group: bool,
    is_official: bool,
    mention_user_ids: List[str],
) -> None:
    recipients = [p for p in set(participants or []) if p and p != sender_id]
    if not recipients:
        return
    sender = await cl_users.find_one(
        {"chatId": sender_id}, {"profile.name": 1, "profile.username": 1}
    )
    sender_profile = (sender or {}).get("profile") or {}
    sender_name = str(
        sender_profile.get("name") or sender_profile.get("username") or "کاربر"
    )
    chat_title = sender_name
    if is_official:
        chat_title = "کانال رسمی"
    elif is_group:
        chat = await cl_chats.find_one({"_id": chat_id_target}, {"groupName": 1})
        chat_title = str((chat or {}).get("groupName") or sender_name)
    base = {
        "kind": "chat",
        "chatId": chat_id_target,
        "chatType": "official" if is_official else ("group" if is_group else "direct"),
        "senderName": sender_name,
        "chatTitle": chat_title,
        "url": f"/chat/{urllib.parse.quote(chat_id_target, safe='')}",
        "icon": "/logo/icon-192.png",
    }
    mentioned_ids = {str(uid) for uid in (mention_user_ids or []) if uid}

    def payload_for_user(user_doc) -> Optional[dict]:
        uid = str(user_doc.get("chatId") or "")
        mode = _chat_notify_modes(user_doc).get(chat_id_target, "all")
        if mode == "muted":
            return None
        mentioned = uid in mentioned_ids
        if mode == "mentions" and not (is_group and mentioned):
            return None
        payload = dict(base)
        payload["mentioned"] = mentioned
        return payload

    await push_to_users(recipients, payload_for_user)


def _is_in_chess_room(game_id: str, user_id: str) -> bool:
    return any(
        ws.client_state == WebSocketState.CONNECTED
        for ws in chess_rooms.get(game_id, {}).get(user_id, [])
    )


async def notify_chess_joined(game: dict, joiner_id: str) -> None:
    creator = game.get("creatorId")
    if not creator or chess_service.is_guest_id(creator):
        return
    if _is_in_chess_room(game["_id"], creator):
        return
    if chess_service.is_guest_id(joiner_id):
        joiner_name = "مهمان"
    else:
        joiner = await cl_users.find_one(
            {"chatId": joiner_id}, {"profile.name": 1, "profile.username": 1}
        )
        joiner_profile = (joiner or {}).get("profile") or {}
        joiner_name = str(
            joiner_profile.get("name") or joiner_profile.get("username") or "کاربر"
        )
    payload = {
        "kind": "chess",
        "gameId": game["_id"],
        "senderName": joiner_name,
        "url": f"/chess/game/{game['_id']}",
        "icon": "/logo/icon-192.png",
    }
    await push_to_users([creator], lambda user_doc: dict(payload))


def chess_online(game_id: str, game: dict) -> dict:
    room = chess_rooms.get(game_id, {})
    return {
        "white": bool(room.get(game["players"]["white"] or "")),
        "black": bool(room.get(game["players"]["black"] or "")),
    }


async def chess_send_all(game_id: str, game: dict, event: Optional[dict]):
    view = chess_service.public_view(game, now_ms(), chess_online(game_id, game))
    view["playerInfo"] = await chess_player_info(game)
    payload = {
        "type": "game_state",
        "game": view,
        "event": event,
    }
    sockets = [ws for conns in chess_rooms.get(game_id, {}).values() for ws in conns]
    await asyncio.gather(*(ws.send_json(payload) for ws in sockets), return_exceptions=True)


async def chess_send_latency(game_id: str):
    payload = {"type": "latency", "latency": chess_latency.get(game_id, {})}
    sockets = [ws for conns in chess_rooms.get(game_id, {}).values() for ws in conns]
    await asyncio.gather(*(ws.send_json(payload) for ws in sockets), return_exceptions=True)


async def chess_ping_loop(websocket: WebSocket):
    try:
        while True:
            await websocket.send_json({"type": "ping", "ts": now_ms()})
            await asyncio.sleep(3)
    except Exception:
        return


def chess_schedule(game: dict):
    game_id = game["_id"]
    handle = chess_timers.pop(game_id, None)
    if handle:
        handle.cancel()
    if game["status"] == "waiting":
        deadline = game["createdAt"] + chess_service.WAITING_TTL_MS
        delay = max(0.0, (deadline - now_ms()) / 1000) + 0.05
        chess_timers[game_id] = asyncio.get_running_loop().call_later(
            delay, lambda: asyncio.create_task(chess_expire_waiting(game_id))
        )
        return
    deadline = chess_service.deadline_ms(game)
    if deadline is None:
        return
    delay = max(0.0, (deadline - now_ms()) / 1000) + 0.05
    chess_timers[game_id] = asyncio.get_running_loop().call_later(
        delay, lambda: asyncio.create_task(chess_on_deadline(game_id))
    )


async def chess_expire_waiting(game_id: str):
    lock = chess_locks.setdefault(game_id, asyncio.Lock())
    sockets = []
    async with lock:
        game = await cl_chess_games.find_one({"_id": game_id})
        if not game or game.get("status") != "waiting":
            return
        if now_ms() - game.get("createdAt", 0) < chess_service.WAITING_TTL_MS:
            chess_schedule(game)
            return
        await cl_chess_games.delete_one({"_id": game_id})
        handle = chess_timers.pop(game_id, None)
        if handle:
            handle.cancel()
        room = chess_rooms.pop(game_id, {})
        sockets = [ws for conns in room.values() for ws in conns]
    chess_locks.pop(game_id, None)
    for ws in sockets:
        try:
            await ws.send_json({"type": "error", "code": "forbidden"})
            await ws.close()
        except Exception:
            pass


async def chess_apply_elo_if_needed(game: dict) -> bool:
    if game.get("status") != "finished" or game.get("eloProcessed"):
        return False
    if game.get("reason") in chess_service.UNRATED_REASONS or game.get("result") not in ("1-0", "0-1", "1/2-1/2"):
        game["rated"] = False
        game["eloProcessed"] = True
        return True
    w_id = game.get("players", {}).get("white")
    b_id = game.get("players", {}).get("black")
    if not w_id or not b_id or chess_service.is_guest_id(w_id) or chess_service.is_guest_id(b_id):
        game["rated"] = False
        game["eloProcessed"] = True
        return True
    w_doc = await cl_users.find_one({"chatId": w_id}, {"chessStats": 1})
    b_doc = await cl_users.find_one({"chatId": b_id}, {"chessStats": 1})
    if not w_doc or not b_doc:
        game["eloProcessed"] = True
        return True
    w_stats = w_doc.get("chessStats") or {}
    b_stats = b_doc.get("chessStats") or {}
    changes = chess_service.compute_elo_changes(
        int(w_stats.get("elo", 1200)),
        int(w_stats.get("gamesPlayed", 0)),
        int(b_stats.get("elo", 1200)),
        int(b_stats.get("gamesPlayed", 0)),
        game["result"],
    )
    if not changes:
        game["eloProcessed"] = True
        return True
    game["rated"] = True
    game["eloProcessed"] = True
    game["ratingChanges"] = changes
    now = now_ms()
    w_inc = {"chessStats.gamesPlayed": 1}
    b_inc = {"chessStats.gamesPlayed": 1}
    if game["result"] == "1-0":
        w_inc["chessStats.wins"] = 1
        b_inc["chessStats.losses"] = 1
    elif game["result"] == "0-1":
        w_inc["chessStats.losses"] = 1
        b_inc["chessStats.wins"] = 1
    else:
        w_inc["chessStats.draws"] = 1
        b_inc["chessStats.draws"] = 1
    await cl_users.update_one(
        {"chatId": w_id},
        {"$set": {"chessStats.elo": changes["white"]["after"], "chessStats.updatedAt": now}, "$inc": w_inc},
    )
    await cl_users.update_one(
        {"chatId": b_id},
        {"$set": {"chessStats.elo": changes["black"]["after"], "chessStats.updatedAt": now}, "$inc": b_inc},
    )
    return True


async def chess_backfill_stats():
    try:
        async for game in cl_chess_games.find({"status": "finished", "eloProcessed": {"$ne": True}}):
            game_id = game["_id"]
            lock = chess_locks.setdefault(game_id, asyncio.Lock())
            try:
                async with lock:
                    fresh = await cl_chess_games.find_one({"_id": game_id})
                    if not fresh or fresh.get("eloProcessed"):
                        continue
                    if await chess_apply_elo_if_needed(fresh):
                        await cl_chess_games.update_one(
                            {"_id": game_id},
                            {"$set": {
                                "eloProcessed": True,
                                "rated": bool(fresh.get("rated")),
                                "ratingChanges": fresh.get("ratingChanges"),
                            }},
                        )
            except Exception:
                continue
    except Exception as e:
        print(f"Chess backfill warning: {e}")


async def chess_run(game_id: str, action):
    lock = chess_locks.setdefault(game_id, asyncio.Lock())
    async with lock:
        game = await cl_chess_games.find_one({"_id": game_id})
        if not game:
            raise ChessError("not_found")
        now = now_ms()
        event = chess_service.check_deadline(game, now)
        if event is None:
            event = action(game, now)
        if game.get("status") == "finished" and not game.get("eloProcessed"):
            await chess_apply_elo_if_needed(game)
        await cl_chess_games.replace_one({"_id": game_id}, game)
        chess_schedule(game)
    await chess_send_all(game_id, game, event)
    return game, event


async def chess_on_deadline(game_id: str):
    try:
        await chess_run(game_id, lambda game, now: None)
    except ChessError:
        pass


async def chess_abandon_after(game_id: str, user_id: str):
    await asyncio.sleep(chess_service.DISCONNECT_GRACE_MS / 1000)
    if chess_rooms.get(game_id, {}).get(user_id):
        return
    try:
        await chess_run(
            game_id,
            lambda game, now: chess_service.abandon(game, chess_service.color_of(game, user_id), now),
        )
    except ChessError:
        pass


async def chess_find_blocking_game(user_id: str, now: int, only_active: bool = False):
    await cl_chess_games.delete_many(
        {"status": "waiting", "createdAt": {"$lte": now - chess_service.WAITING_TTL_MS}}
    )
    statuses = ["active"] if only_active else ["active", "waiting"]
    query = {
        "status": {"$in": statuses},
        "$or": [{"players.white": user_id}, {"players.black": user_id}, {"creatorId": user_id}],
    }
    async for g in cl_chess_games.find(query):
        if g.get("status") == "active":
            dl = chess_service.deadline_ms(g)
            if dl is not None and now >= dl:
                await chess_on_deadline(g["_id"])
                continue
        return g
    return None


async def chess_player_info(game: dict) -> dict:
    ids = [i for i in (game["players"]["white"], game["players"]["black"], game["invitedChatId"]) if i]
    reg_ids = [i for i in ids if not chess_service.is_guest_id(i)]
    rows = await cl_users.find(
        {"chatId": {"$in": reg_ids}},
        {"chatId": 1, "profile": 1, "chessStats": 1, "verified": 1},
    ).to_list(len(reg_ids)) if reg_ids else []
    info = {
        str(r["chatId"]): {
            "chatId": str(r["chatId"]),
            "name": (r.get("profile") or {}).get("name", ""),
            "avatar": (r.get("profile") or {}).get("avatar", ""),
            "elo": int((r.get("chessStats") or {}).get("elo", 1200)),
            "verified": bool(r.get("verified", False)),
            "isGuest": False,
        }
        for r in rows
    }
    for i in ids:
        if chess_service.is_guest_id(i):
            info[i] = {
                "chatId": i,
                "name": "مهمان",
                "avatar": "",
                "elo": None,
                "verified": False,
                "isGuest": True,
            }
        elif i not in info:
            info[i] = {
                "chatId": i,
                "name": "حساب حذف‌شده",
                "avatar": "",
                "elo": None,
                "verified": False,
                "isGuest": False,
            }
    return info


async def chess_response(game: dict) -> dict:
    view = chess_service.public_view(game, now_ms(), chess_online(game["_id"], game))
    view["playerInfo"] = await chess_player_info(game)
    return view


def chess_http_error(error: ChessError) -> HTTPException:
    status = {"not_found": 404, "forbidden": 403}.get(error.code, 400)
    return HTTPException(status_code=status, detail=error.code)



async def safe_send_ai(user_id: str, message: dict):
    conns: List[WebSocket] = []
    seen_ws: set[int] = set()
    for ws in [
        *active_ai_connections.get(user_id, []),
        *active_connections.get(user_id, []),
    ]:
        ws_id = id(ws)
        if ws_id in seen_ws:
            continue
        seen_ws.add(ws_id)
        conns.append(ws)
    if not conns:
        return

    results = await asyncio.gather(
        *(ws.send_json(message) for ws in conns), return_exceptions=True
    )

    dead_connections: List[WebSocket] = []
    for ws, r in zip(conns, results):
        if isinstance(r, Exception):
            dead_connections.append(ws)

    if dead_connections:
        for dead_ws in dead_connections:
            if dead_ws in active_ai_connections.get(user_id, []):
                active_ai_connections[user_id].remove(dead_ws)
            if dead_ws in active_connections.get(user_id, []):
                active_connections[user_id].remove(dead_ws)

        if not active_ai_connections.get(user_id):
            active_ai_connections.pop(user_id, None)
        if not active_connections.get(user_id):
            active_connections.pop(user_id, None)


async def try_object_id(value: Any) -> Optional[ObjectId]:
    try:
        if not value or not isinstance(value, str):
            return None
        return ObjectId(value)
    except Exception:
        return None


async def build_last_message(chat_id: str, session_token: str = "") -> Optional[dict]:
    m = (
        await cl_messages.find({"chatId": chat_id})
        .sort("timestamp", -1)
        .limit(1)
        .to_list(1)
    )
    if not m:
        return None

    doc = m[0]
    return {
        "id": str(doc["_id"]),
        "text": decrypt_with_fallback(
            doc.get("text", ""), session_token, f"chat:{chat_id}"
        ),
        "senderId": doc.get("senderId"),
        "timestamp": doc.get("timestamp"),
        "file": doc.get("file"),
    }


async def _build_ai_history(
    user_id: str,
    session_token: str,
    ai_chat_id: str,
) -> List[Dict[str, str]]:
    docs = (
        await cl_ai_messages.find({"userId": user_id, "aiChatId": ai_chat_id})
        .sort("timestamp", -1)
        .limit(AI_HISTORY_MESSAGE_LIMIT)
        .to_list(AI_HISTORY_MESSAGE_LIMIT)
    )
    docs.reverse()
    messages: List[Dict[str, str]] = []
    budget = AI_HISTORY_CHAR_BUDGET
    trimmed: List[Dict[str, str]] = []
    for doc in docs:
        content = decrypt_with_fallback(
            doc.get("content", ""), session_token, f"ai:{ai_chat_id}"
        )
        attachment_context = decrypt_with_fallback(
            doc.get("extractedContext", ""), session_token, f"ai:{ai_chat_id}"
        )
        if attachment_context:
            content = f"{content}\n\n{attachment_context}".strip()
        if not content.strip():
            continue
        trimmed.append({"role": doc.get("role", "user"), "content": content})
    for item in reversed(trimmed):
        remaining = budget - sum(len(m["content"]) for m in messages)
        if remaining <= 0:
            break
        messages.insert(0, {"role": item["role"], "content": item["content"][-remaining:]})
    return messages


async def _prepare_ai_attachment(
    user_id: str,
    attachment: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    oid = await try_object_id(str(attachment.get("tempFileId") or ""))
    if not oid:
        return None
    row = await cl_ai_temp_files.find_one({"_id": oid, "userId": user_id})
    if not row:
        return None
    file_path = Path(str(row.get("filePath") or ""))
    if not file_path.exists():
        temp_bytes = await read_ai_temp_file(file_path.name)
        if temp_bytes is not None:
            file_path = UPLOAD_DIR / "ai_temp" / file_path.name
        else:
            alt_path = Path(__file__).resolve().parent / file_path
            if alt_path.exists():
                file_path = alt_path
            else:
                await cl_ai_temp_files.delete_one({"_id": oid})
                return None
    is_image = bool(row.get("isImage"))
    mime_type = str(row.get("mimeType") or "application/octet-stream")
    file_name = str(row.get("fileName") or "")
    image_data_url = ""
    extracted_context = ""
    try:
        if is_image:
            data = await asyncio.to_thread(file_path.read_bytes)
            image_data_url = f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
            extracted_context = f"[تصویر پیوست‌شده: {file_name}]"
        elif file_path.suffix.lower() == ".pdf":
            text = await asyncio.to_thread(_extract_pdf_text, file_path)
            extracted_context = f"[فایل پیوست‌شده: {file_name}]\n{text[:AI_MAX_FILE_CONTEXT_CHARS]}"
        else:
            raw = await asyncio.to_thread(file_path.read_bytes)
            text = raw.decode("utf-8", errors="replace")
            extracted_context = f"[فایل پیوست‌شده: {file_name}]\n{text[:AI_MAX_FILE_CONTEXT_CHARS]}"
    except Exception:
        return None
    return {
        "meta": {
            "fileName": file_name,
            "fileSize": int(row.get("fileSize") or 0),
            "mimeType": mime_type,
            "isImage": is_image,
        },
        "image_data_url": image_data_url,
        "extracted_context": extracted_context,
        "file_path": file_path,
        "file_oid": oid,
    }


def _extract_pdf_text(file_path: Path) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(file_path))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
            if sum(len(part) for part in parts) >= AI_MAX_FILE_CONTEXT_CHARS:
                break
        return "\n".join(parts)[:AI_MAX_FILE_CONTEXT_CHARS]
    except Exception as e:
        print(f"PDF extraction error: {e}")
        return ""


async def _cleanup_ai_temp_attachment(prepared: Dict[str, Any]) -> None:
    try:
        await asyncio.to_thread(prepared["file_path"].unlink, True)
    except Exception:
        pass
    try:
        await cl_ai_temp_files.delete_one({"_id": prepared["file_oid"]})
    except Exception:
        pass


async def run_post_turn_memory(
    user_id: str,
    ai_chat_id: str,
    history_messages: List[Dict[str, str]],
    assistant_text: str,
    previous_summary: str,
    event_queue: Optional[asyncio.Queue] = None,
) -> None:
    if not assistant_text.strip():
        return
    try:
        existing = await get_user_memories(user_id)
        result = await process_post_turn_memory_and_summary(
            [*history_messages, {"role": "assistant", "content": assistant_text}],
            previous_summary=previous_summary,
            existing_memories=[{"id": item["id"], "text": item["content"]} for item in existing],
        )
        summary = str(result.get("summary") or "")
        if summary:
            await cl_ai_chats.update_one(
                {"_id": await try_object_id(ai_chat_id), "userId": user_id},
                {
                    "$set": {
                        "summary": encrypt_scoped_text(
                            summary, "", f"ai-chat-meta:{ai_chat_id}"
                        ),
                        "summaryEncrypted": True,
                    }
                },
            )
        action = result.get("memory_action")
        memory_text = str(result.get("memory_text") or "")
        memory_changed = False
        if action == "add" and len(existing) < MAX_AI_USER_MEMORIES and memory_text:
            now = utc_now()
            await cl_ai_memories.insert_one(
                {
                    "userId": user_id,
                    "content": encrypt_scoped_text(
                        memory_text, "", ai_memory_scope(user_id)
                    ),
                    "contentEncrypted": True,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
            memory_changed = True
        elif action == "replace" and memory_text:
            replace_oid = await try_object_id(str(result.get("replace_id") or ""))
            if replace_oid:
                update = await cl_ai_memories.update_one(
                    {"_id": replace_oid, "userId": user_id},
                    {
                        "$set": {
                            "content": encrypt_scoped_text(
                                memory_text, "", ai_memory_scope(user_id)
                            ),
                            "updatedAt": utc_now(),
                        }
                    },
                )
                memory_changed = update.modified_count > 0
        if memory_changed:
            if event_queue is not None:
                await event_queue.put({"type": "ai_memories_updated"})
            await safe_send_ai(user_id, {"type": "ai_memories_updated"})
    except Exception as e:
        print(f"Post-turn memory error: {e}")


async def stream_ai_reply(
    user_id: str,
    session_token: str,
    user_name: str,
    username: str,
    user_bio: str,
    ai_chat_id: str,
    prompt_messages: List[Dict[str, str]],
    memory_summary: str,
    model_name: str,
    model_key: str,
    reasoning_mode: bool,
    should_generate_title: bool = False,
    first_user_message: str = "",
    is_temporary_chat: bool = False,
    user_memories: Optional[List[str]] = None,
    search_query: str = "",
    search_enabled: bool = False,
    detected_urls: Optional[List[str]] = None,
    image_data_url: str = "",
    user_text: str = "",
    prepared_attachment: Optional[Dict[str, Any]] = None,
    event_queue: Optional[asyncio.Queue] = None,
):
    async def emit(payload: Dict[str, Any]):
        if event_queue is not None:
            await event_queue.put(payload)
        else:
            await safe_send_ai(user_id, payload)

    ai_scope = f"ai:{ai_chat_id}"
    sources: List[Dict[str, Any]] = []
    urls_to_fetch = list(detected_urls or []) if search_enabled else []
    effective_search = bool(search_enabled)
    analyzing_attachment = bool(prepared_attachment)
    ai_message_doc = {
        "userId": user_id,
        "aiChatId": ai_chat_id,
        "role": "assistant",
        "content": encrypt_scoped_text("", session_token, ai_scope),
        "contentEncrypted": True,
        "reasoningContent": encrypt_scoped_text("", session_token, ai_scope),
        "reasoningEnabled": bool(reasoning_mode),
        "streamCompleted": False,
        "searchEnabled": effective_search,
        "searchStatus": "searching" if effective_search else "",
        "searchSources": "",
        "analyzingAttachment": analyzing_attachment,
        "aiModelKey": normalize_ai_model_key(model_key),
        "aiModelName": ai_model_label_from_key(model_key),
        "timestamp": utc_now(),
    }
    if prepared_attachment:
        ai_message_doc["attachmentMeta"] = prepared_attachment["meta"]
    result = await cl_ai_messages.insert_one(ai_message_doc)
    ai_msg_id = str(result.inserted_id)
    message_ts_ms = dt_to_epoch_ms(ai_message_doc["timestamp"])

    await emit(
        {
            "type": "ai_response_start",
            "message": {
                "id": ai_msg_id,
                "aiChatId": ai_chat_id,
                "senderId": "ai",
                "text": "",
                "reasoningContent": "",
                "reasoningEnabled": bool(reasoning_mode),
                "isStreaming": True,
                "streamCompleted": False,
                "searchEnabled": effective_search,
                "searchStatus": "searching" if effective_search else "",
                "searchSources": sources,
                "analyzingAttachment": analyzing_attachment,
                "aiModelKey": normalize_ai_model_key(model_key),
                "aiModelName": ai_model_label_from_key(model_key),
                "timestamp": message_ts_ms,
            },
        },
    )

    if effective_search:
        fetched_sources: List[Dict[str, Any]] = []
        web_sources: List[Dict[str, Any]] = []
        if urls_to_fetch:
            fetched_sources = await perform_deepseek_url_fetch(urls_to_fetch)
        if search_enabled:
            web_sources = await perform_deepseek_web_search(search_query, search_query)
        merged: List[Dict[str, Any]] = []
        seen_urls = set()
        for item in [*fetched_sources, *web_sources]:
            u = str(item.get("url") or "").strip()
            if not u or u in seen_urls:
                continue
            seen_urls.add(u)
            merged.append({**item, "index": len(merged) + 1})
        sources = merged
        stored_sources = [
            {k: v for k, v in item.items() if k != "content"}
            for item in sources
        ]
        if stored_sources:
            await cl_ai_messages.update_one(
                {"_id": result.inserted_id},
                {
                    "$set": {
                        "searchSources": encrypt_scoped_text(
                            json.dumps(stored_sources, ensure_ascii=False), "", ai_scope
                        )
                    }
                },
            )
        await emit(
            {
                "type": "ai_search_results",
                "aiChatId": ai_chat_id,
                "messageId": ai_msg_id,
                "status": "completed",
                "searchStatus": "completed",
                "searchSources": stored_sources,
            },
        )

    stopped = False
    full_ai_response = ""
    full_reasoning_content = ""
    raw_usage_tokens = 0
    stream_started_at = time.time()
    first_main_content_at: Optional[float] = None
    try:
        async for chunk in generate_ai_response_stream(
            prompt_messages,
            user_name=user_name,
            username=username,
            chat_id=user_id,
            bio=user_bio,
            conversation_summary=memory_summary,
            model=model_name,
            reasoning_mode=reasoning_mode,
            user_memories=user_memories,
            search_results=sources,
            image_data_url=image_data_url,
            image_prompt=user_text,
        ):
            text_chunk = ""
            reasoning_chunk = ""
            if isinstance(chunk, dict):
                text_chunk = str(chunk.get("content") or "")
                reasoning_chunk = str(chunk.get("reasoning_content") or "")
                usage = chunk.get("usage")
                if isinstance(usage, dict):
                    raw_usage_tokens = int(usage.get("total_tokens") or 0) or raw_usage_tokens
            elif isinstance(chunk, str):
                text_chunk = chunk

            if text_chunk:
                full_ai_response += text_chunk
                if first_main_content_at is None:
                    first_main_content_at = time.time()
            if reasoning_chunk and reasoning_mode:
                full_reasoning_content += reasoning_chunk
            if not text_chunk and not (reasoning_chunk and reasoning_mode):
                continue

            await cl_ai_messages.update_one(
                {"_id": result.inserted_id},
                {
                    "$set": {
                        "content": encrypt_scoped_text(
                            full_ai_response, session_token, ai_scope
                        ),
                        "reasoningContent": encrypt_scoped_text(
                            full_reasoning_content, session_token, ai_scope
                        ),
                        "streamCompleted": False,
                    }
                },
            )
            await emit(
                {
                    "type": "ai_response_chunk",
                    "aiChatId": ai_chat_id,
                    "messageId": ai_msg_id,
                    "chunk": text_chunk,
                    "reasoningChunk": reasoning_chunk,
                    "text": full_ai_response,
                    "reasoningContent": full_reasoning_content,
                    "hasMainContent": bool(full_ai_response),
                },
            )
    except asyncio.CancelledError:
        stopped = True
        raise
    finally:
        reasoning_duration_sec = int(
            max(
                0,
                round((first_main_content_at or time.time()) - stream_started_at),
            )
        )
        if raw_usage_tokens <= 0:
            prompt_chars = sum(len(str(m.get("content") or "")) for m in prompt_messages)
            raw_usage_tokens = max(
                1, (prompt_chars + len(full_ai_response) + len(full_reasoning_content)) // 3
            )
        usage_status = await record_token_usage(user_id, raw_usage_tokens, model_key)
        if prepared_attachment:
            await _cleanup_ai_temp_attachment(prepared_attachment)
        await cl_ai_messages.update_one(
            {"_id": result.inserted_id},
            {
                "$set": {
                    "content": encrypt_scoped_text(
                        full_ai_response, session_token, ai_scope
                    ),
                    "reasoningContent": encrypt_scoped_text(
                        full_reasoning_content, session_token, ai_scope
                    ),
                    "streamCompleted": True,
                    "reasoningDurationSec": reasoning_duration_sec,
                    "searchStatus": "completed" if effective_search else "",
                }
            },
        )
        generated_title = ""
        chat_update: Dict[str, Any] = {"updatedAt": utc_now()}
        if is_temporary_chat:
            chat_update["title"] = encrypt_scoped_text(
                "گفتگوی موقت", "", f"ai-chat-meta:{ai_chat_id}"
            )
            chat_update["titleEncrypted"] = True
        elif should_generate_title and not stopped:
            candidate_title = await generate_chat_title(first_user_message)
            if (
                isinstance(candidate_title, str)
                and candidate_title.strip()
                and candidate_title.strip() != "گفتگوی جدید"
            ):
                generated_title = candidate_title.strip()[:56]
                chat_update["title"] = encrypt_scoped_text(
                    generated_title, "", f"ai-chat-meta:{ai_chat_id}"
                )
                chat_update["titleEncrypted"] = True
        await cl_ai_chats.update_one(
            {"_id": await try_object_id(ai_chat_id), "userId": user_id},
            {"$set": chat_update},
        )

        done_sources = [
            {k: v for k, v in item.items() if k != "content"}
            for item in sources
        ]
        await emit(
            {
                "type": "ai_response_done",
                "stopped": stopped,
                "title": generated_title,
                "usage": usage_status,
                "message": {
                    "id": ai_msg_id,
                    "aiChatId": ai_chat_id,
                    "senderId": "ai",
                    "text": full_ai_response,
                    "reasoningContent": full_reasoning_content,
                    "reasoningEnabled": bool(reasoning_mode),
                    "isStreaming": False,
                    "streamCompleted": True,
                    "reasoningDurationSec": reasoning_duration_sec,
                    "searchEnabled": effective_search,
                    "searchStatus": "completed" if effective_search else "",
                    "searchSources": done_sources,
                    "analyzingAttachment": False,
                    "aiModelKey": normalize_ai_model_key(model_key),
                    "aiModelName": ai_model_label_from_key(model_key),
                    "timestamp": message_ts_ms,
                },
            },
        )
        if not is_temporary_chat and not stopped and full_ai_response.strip():
            if event_queue is not None:
                await run_post_turn_memory(
                    user_id,
                    ai_chat_id,
                    prompt_messages,
                    full_ai_response,
                    memory_summary,
                    event_queue=event_queue,
                )
            else:
                asyncio.create_task(
                    run_post_turn_memory(
                        user_id,
                        ai_chat_id,
                        prompt_messages,
                        full_ai_response,
                        memory_summary,
                    )
                )
        if event_queue is not None:
            await event_queue.put(None)


async def handle_ai_message(
    user_id: str,
    session_token: str,
    user_name: str,
    username: str,
    user_bio: str,
    data: Dict[str, Any],
    event_queue: Optional[asyncio.Queue] = None,
) -> None:
    async def emit(payload: Dict[str, Any]):
        if event_queue is not None:
            await event_queue.put(payload)
        else:
            await safe_send_ai(user_id, payload)

    async def finish_error(payload: Dict[str, Any]):
        await emit(payload)
        if event_queue is not None:
            await event_queue.put(None)

    text = data.get("text")
    client_id = data.get("clientId")
    ai_chat_id = str(data.get("aiChatId") or "").strip()
    use_reasoner = bool(data.get("useReasoner"))
    use_web_search = bool(data.get("useWebSearch"))
    attachment = data.get("attachment") if isinstance(data.get("attachment"), dict) else None
    model_key = normalize_ai_model_key(data.get("modelKey") or "nova-flash")
    model_name = ai_model_name_from_key(model_key, use_reasoner)

    if not isinstance(text, str):
        if event_queue is not None:
            await event_queue.put(None)
        return
    if len(text) > MAX_AI_MESSAGE_LENGTH:
        if event_queue is not None:
            await event_queue.put(None)
        return
    if not text.strip() and not attachment:
        if event_queue is not None:
            await event_queue.put(None)
        return

    usage = await get_usage_status(user_id)
    if not usage.get("aiEnabled", True):
        await finish_error(
            {
                "type": "ai_error",
                "code": "ai_disabled",
                "clientId": client_id if isinstance(client_id, str) else None,
                "aiChatId": ai_chat_id,
                "message": usage.get("aiDisabledMessage") or AI_DISABLED_DEFAULT_MESSAGE,
                "usage": usage,
            }
        )
        return

    if usage["tokens"]["exhausted"]:
        await finish_error(
            {
                "type": "ai_error",
                "code": "ai_daily_limit_reached",
                "clientId": client_id if isinstance(client_id, str) else None,
                "aiChatId": ai_chat_id,
                "message": "سهمیه توکن امروز شما تکمیل شده است. لطفاً تا ۰۰:۰۰ به وقت تهران صبر کنید.",
                "usage": usage,
            }
        )
        return

    try:
        ai_chat = await ensure_ai_chat(user_id, ai_chat_id)
    except HTTPException:
        await asyncio.sleep(0.12)
        try:
            ai_chat = await ensure_ai_chat(user_id, ai_chat_id)
        except HTTPException:
            await finish_error(
                {
                    "type": "ai_error",
                    "clientId": client_id if isinstance(client_id, str) else None,
                    "aiChatId": ai_chat_id,
                    "message": "گفتگوی انتخاب‌شده معتبر نیست.",
                }
            )
            return

    is_temporary_chat = bool(ai_chat.get("isTemporary", False))
    user_msg_count = await cl_ai_messages.count_documents(
        {"userId": user_id, "aiChatId": ai_chat_id, "role": "user"}
    )
    if user_msg_count >= MAX_AI_MESSAGES_PER_CHAT:
        await finish_error(
            {
                "type": "ai_error",
                "clientId": client_id if isinstance(client_id, str) else None,
                "aiChatId": ai_chat_id,
                "message": "حداکثر ۶۰ پیام در هر گفتگو مجاز است. لطفاً گفتگوی جدید باز کنید.",
            }
        )
        return

    prepared_attachment: Optional[Dict[str, Any]] = None
    if attachment:
        prepared_attachment = await _prepare_ai_attachment(user_id, attachment)
        if not prepared_attachment:
            await finish_error(
                {
                    "type": "ai_error",
                    "clientId": client_id if isinstance(client_id, str) else None,
                    "aiChatId": ai_chat_id,
                    "message": "فایل پیوست معتبر نیست یا منقضی شده است.",
                }
            )
            return
        if not await consume_file_quota(user_id, usage["files"]["limit"]):
            await _cleanup_ai_temp_attachment(prepared_attachment)
            await finish_error(
                {
                    "type": "ai_error",
                    "clientId": client_id if isinstance(client_id, str) else None,
                    "aiChatId": ai_chat_id,
                    "message": f"سقف {usage['files']['limit']} فایل روزانه شما تکمیل شده است.",
                    "usage": await get_usage_status(user_id),
                }
            )
            return

    detected_urls = extract_urls_from_text(text) if use_web_search else []
    if use_web_search and not await consume_search_quota(user_id, usage["search"]["limit"]):
        if prepared_attachment:
            await _cleanup_ai_temp_attachment(prepared_attachment)
        await finish_error(
            {
                "type": "ai_error",
                "clientId": client_id if isinstance(client_id, str) else None,
                "aiChatId": ai_chat_id,
                "message": f"سقف {usage['search']['limit']} جستجوی روزانه شما تکمیل شده است.",
                "usage": await get_usage_status(user_id),
            }
        )
        return

    user_message_doc: Dict[str, Any] = {
        "userId": user_id,
        "aiChatId": ai_chat_id,
        "role": "user",
        "content": encrypt_scoped_text(text, session_token, f"ai:{ai_chat_id}"),
        "contentEncrypted": True,
        "timestamp": utc_now(),
    }
    if prepared_attachment:
        user_message_doc["attachmentMeta"] = prepared_attachment["meta"]
        user_message_doc["extractedContext"] = encrypt_scoped_text(
            prepared_attachment["extracted_context"],
            session_token,
            f"ai:{ai_chat_id}",
        )
    user_insert = await cl_ai_messages.insert_one(user_message_doc)

    await emit(
        {
            "type": "ai_user_message_saved",
            "title": "",
            "clientId": client_id if isinstance(client_id, str) else None,
            "message": {
                "id": str(user_insert.inserted_id),
                "aiChatId": ai_chat_id,
                "senderId": user_id,
                "text": text,
                "timestamp": dt_to_epoch_ms(user_message_doc["timestamp"]),
                "aiAttachment": prepared_attachment["meta"] if prepared_attachment else None,
            },
        }
    )

    memory_summary = ""
    if isinstance(ai_chat.get("summary"), str):
        memory_summary = decrypt_with_fallback(
            ai_chat.get("summary", ""),
            session_token,
            f"ai-chat-meta:{ai_chat_id}",
        ).strip()

    existing_chat_title = decrypt_with_fallback(
        ai_chat.get("title") or "",
        session_token,
        f"ai-chat-meta:{ai_chat_id}",
    ).strip()
    needs_chat_title = (not is_temporary_chat) and (
        user_msg_count == 0 or not existing_chat_title or existing_chat_title == "گفتگوی جدید"
    )
    title_source_text = (
        text.strip()
        or (prepared_attachment["meta"]["fileName"] if prepared_attachment else "")
        or "گفتگوی جدید"
    )

    messages = await _build_ai_history(user_id, session_token, ai_chat_id)
    user_memories: List[str] = []
    if not is_temporary_chat:
        user_memories = [item["content"] for item in await get_user_memories(user_id)]

    current_stream_task = active_ai_stream_tasks.get(user_id)
    if current_stream_task and not current_stream_task.done():
        current_stream_task.cancel()
        try:
            await current_stream_task
        except asyncio.CancelledError:
            pass

    new_stream_task = asyncio.create_task(
        stream_ai_reply(
            user_id,
            session_token,
            user_name,
            username,
            user_bio,
            ai_chat_id,
            messages,
            memory_summary,
            model_name,
            model_key,
            use_reasoner,
            should_generate_title=needs_chat_title,
            first_user_message=title_source_text,
            is_temporary_chat=is_temporary_chat,
            user_memories=user_memories,
            search_query=text or (prepared_attachment["meta"]["fileName"] if prepared_attachment else ""),
            search_enabled=use_web_search,
            detected_urls=detected_urls,
            image_data_url=prepared_attachment["image_data_url"] if prepared_attachment else "",
            user_text=text,
            prepared_attachment=prepared_attachment,
            event_queue=event_queue,
        )
    )
    active_ai_stream_tasks[user_id] = new_stream_task


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()
    chat_id: Optional[str] = None

    try:
        user = await get_user_from_session_token(token)
        if not user:
            await websocket.close(code=1008)
            return
        chat_id = user.get("chatId")

        active_connections.setdefault(chat_id, []).append(websocket)
        became_online = await mark_user_connected(chat_id)
        profile = (
            user.get("profile", {}) if isinstance(user.get("profile"), dict) else {}
        )
        user_name = profile.get("name", "")
        username = profile.get("username", "")
        user_bio = decrypt_user_bio(user, token)

        if became_online:
            user_chats = await cl_chats.find({"participants": chat_id}).to_list(None)
            contacts_to_notify = set()
            for chat in user_chats:
                for p in chat.get("participants", []):
                    if p != chat_id:
                        contacts_to_notify.add(p)

            allowed_contacts = await _filter_recipients_by_block_status(
                chat_id, contacts_to_notify
            )
            allowed_contacts = await _filter_recipients_by_presence_visibility(
                chat_id, allowed_contacts
            )
            if allowed_contacts:
                await broadcast(
                    allowed_contacts,
                    {"type": "user_status", "userId": chat_id, "online": True},
                )

        last_client_activity = time.time()
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=70)
                last_client_activity = time.time()
            except asyncio.TimeoutError:
                if (time.time() - last_client_activity) >= WS_IDLE_TIMEOUT_SEC:
                    try:
                        await websocket.close(code=1001)
                    except Exception:
                        pass
                    break
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
                continue
            except ValueError:
                continue

            if data.get("type") == "message":
                chat_id_target = data.get("chatId")
                text = data.get("text", "")
                reply_to_id = data.get("replyToId")
                client_id = data.get("clientId")
                file_data = data.get("file")
                if isinstance(file_data, dict):
                    for key in ("width", "height"):
                        try:
                            value = int(file_data.get(key))
                        except (TypeError, ValueError):
                            file_data.pop(key, None)
                            continue
                        if 1 <= value <= 20000:
                            file_data[key] = value
                        else:
                            file_data.pop(key, None)
                    file_data.pop("localUrl", None)
                    file_data.pop("upload", None)
                if not isinstance(text, str):
                    continue
                if len(text) > MAX_CHAT_MESSAGE_LENGTH:
                    continue

                if not chat_id_target or (not text.strip() and not file_data):
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                is_official = is_official_channel_chat(chat_id_target)

                if is_official and not bool(user.get("verified", False)):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": "Only verified users can send in official channel",
                        }
                    )
                    continue

                is_group_chat = False
                chat_participants: List[str] = []
                if not is_saved and not is_official:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1, "chatType": 1}
                    )
                    participants = chat_doc.get("participants", []) if chat_doc else []
                    chat_participants = participants
                    is_group_chat = bool(chat_doc and chat_doc.get("chatType") == "group")
                    if chat_id not in participants:
                        continue
                    if chat_doc and chat_doc.get("chatType") != "group":
                        other_id = next((p for p in participants if p != chat_id), "")
                        if other_id and await _is_direct_blocked_between(
                            chat_id, other_id
                        ):
                            await websocket.send_json(
                                {
                                    "type": "error",
                                    "error": "Direct chat is blocked between users",
                                }
                            )
                            continue

                reply_to = None
                chat_scope = f"chat:{chat_id_target}"
                if reply_to_id:
                    oid = await try_object_id(reply_to_id)
                    if oid:
                        base = await cl_messages.find_one(
                            {"_id": oid, "chatId": chat_id_target}
                        )
                        if base:
                            reply_to = {
                                "id": str(base["_id"]),
                                "senderId": base.get("senderId"),
                                "text": decrypt_with_fallback(
                                    base.get("text", ""), token, chat_scope
                                ),
                            }

                plain_message_text = decrypt_client_chat_text(text, token, chat_scope)
                unread_mention_user_ids = (
                    await resolve_group_unread_mention_user_ids(
                        plain_message_text,
                        chat_id,
                        chat_participants,
                        reply_to,
                    )
                    if (not is_saved and not is_official and is_group_chat)
                    else []
                )

                encrypted_text = encrypt_scoped_text(text, token, chat_scope)
                message_doc = {
                    "chatId": chat_id_target,
                    "senderId": chat_id,
                    "text": encrypted_text,
                    "textEncrypted": True,
                    "timestamp": utc_now(),
                    "seenBy": [chat_id],
                    "replyTo": reply_to,
                    "reactions": [],
                    "unreadMentionUserIds": unread_mention_user_ids,
                    "unreadReactionUserIds": [],
                }
                if reply_to and isinstance(reply_to.get("text"), str):
                    message_doc["replyTo"]["text"] = encrypt_scoped_text(
                        reply_to.get("text", ""), token, chat_scope
                    )

                if file_data:
                    message_doc["file"] = file_data

                result = await cl_messages.insert_one(message_doc)
                msg_id = str(result.inserted_id)

                last_msg = {
                    "id": msg_id,
                    "text": encrypted_text if text else "[File]",
                    "senderId": chat_id,
                    "timestamp": message_doc["timestamp"],
                    "file": file_data,
                }

                if not is_saved and not is_official:
                    await cl_chats.update_one(
                        {"_id": chat_id_target},
                        {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
                    )

                participants = [chat_id] if is_saved else []
                if is_official:
                    participants = await cl_users.distinct("chatId", {})
                if not is_saved and not is_official:
                    participants_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    participants = (
                        participants_doc.get("participants", [])
                        if participants_doc
                        else []
                    )

                if participants:
                    msg_payload = {
                        "type": "new_message",
                        "chatId": chat_id_target,
                        "message": {
                            "id": msg_id,
                            "chatId": chat_id_target,
                            "senderId": chat_id,
                            "text": text,
                            "timestamp": dt_to_epoch_ms(message_doc.get("timestamp")),
                            "seen": False,
                            "replyTo": reply_to,
                            "edited": False,
                            "reactions": [],
                            "unreadMentionUserIds": unread_mention_user_ids,
                            "file": file_data,
                            "clientId": (
                                client_id if isinstance(client_id, str) else None
                            ),
                        },
                    }

                    await broadcast(participants, msg_payload)
                    if not is_saved:
                        schedule_push(
                            notify_chat_message(
                                chat_id_target,
                                chat_id,
                                participants,
                                is_group_chat,
                                is_official,
                                unread_mention_user_ids,
                            )
                        )

            elif data.get("type") == "edit_message":
                chat_id_target = data.get("chatId")
                message_id = data.get("messageId")
                new_text = data.get("text")

                if (
                    not chat_id_target
                    or not message_id
                    or not isinstance(new_text, str)
                    or not new_text.strip()
                ):
                    continue
                if len(new_text) > MAX_CHAT_MESSAGE_LENGTH:
                    continue

                oid = await try_object_id(message_id)
                if not oid:
                    continue

                msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id_target})
                if not msg or msg.get("senderId") != chat_id:
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                is_official = is_official_channel_chat(chat_id_target)
                if is_official and not bool(user.get("verified", False)):
                    continue
                is_group_chat = False
                edited_mention_user_ids: List[str] = []
                if not is_saved and not is_official:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1, "chatType": 1}
                    )
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue
                    is_group_chat = chat_doc.get("chatType") == "group"
                    if is_group_chat:
                        plain_edited_text = decrypt_client_chat_text(
                            new_text, token, f"chat:{chat_id_target}"
                        )
                        newly_mentioned = await resolve_group_unread_mention_user_ids(
                            plain_edited_text,
                            chat_id,
                            chat_doc.get("participants", []),
                            msg.get("replyTo"),
                        )
                        existing_mentions = list(
                            msg.get("unreadMentionUserIds") or []
                        )
                        edited_mention_user_ids = sorted(
                            set(existing_mentions) | set(newly_mentioned)
                        )

                edit_set = {
                    "text": encrypt_scoped_text(
                        new_text, token, f"chat:{chat_id_target}"
                    ),
                    "textEncrypted": True,
                    "editedAt": utc_now(),
                }
                if is_group_chat:
                    edit_set["unreadMentionUserIds"] = edited_mention_user_ids

                await cl_messages.update_one(
                    {"_id": oid},
                    {"$set": edit_set},
                )

                if not is_saved and not is_official:
                    await cl_chats.update_one(
                        {"_id": chat_id_target, "lastMessage.id": message_id},
                        {
                            "$set": {
                                "lastMessage.text": encrypt_scoped_text(
                                    new_text, token, f"chat:{chat_id_target}"
                                ),
                                "updatedAt": utc_now(),
                            }
                        },
                    )
                    curr_chat = await cl_chats.find_one({"_id": chat_id_target}, {"pinnedMessage": 1})
                    if curr_chat and (curr_chat.get("pinnedMessage") or {}).get("id") == message_id:
                        await cl_chats.update_one(
                            {"_id": chat_id_target},
                            {
                                "$set": {
                                    "pinnedMessage.text": encrypt_scoped_text(
                                        new_text, token, f"chat:{chat_id_target}"
                                    ),
                                    "updatedAt": utc_now(),
                                }
                            },
                        )
                        updated_chat = await cl_chats.find_one({"_id": chat_id_target}, {"pinnedMessage": 1})
                        if participants:
                            await broadcast(
                                participants,
                                {
                                    "type": "message_pinned",
                                    "chatId": chat_id_target,
                                    "pinnedMessage": updated_chat.get("pinnedMessage"),
                                },
                            )

                participants = [chat_id] if is_saved else []
                if is_official:
                    participants = await cl_users.distinct("chatId", {})
                if not is_saved and not is_official:
                    participants_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    participants = (
                        participants_doc.get("participants", [])
                        if participants_doc
                        else []
                    )

                payload = {
                    "type": "message_edited",
                    "chatId": chat_id_target,
                    "message": {
                        "id": message_id,
                        "chatId": chat_id_target,
                        "senderId": chat_id,
                        "text": new_text,
                        "timestamp": dt_to_epoch_ms(msg.get("timestamp")),
                        "seen": False,
                        "replyTo": (
                            {
                                **msg.get("replyTo"),
                                "text": decrypt_with_fallback(
                                    (msg.get("replyTo") or {}).get("text", ""),
                                    token,
                                    f"chat:{chat_id_target}",
                                ),
                            }
                            if isinstance(msg.get("replyTo"), dict)
                            else None
                        ),
                        "edited": True,
                        "reactions": aggregate_reactions(msg.get("reactions", [])),
                        "unreadMentionUserIds": (
                            edited_mention_user_ids if is_group_chat else []
                        ),
                        "file": msg.get("file"),
                    },
                }

                if participants:
                    await broadcast(participants, payload)

            elif data.get("type") == "delete_message":
                chat_id_target = data.get("chatId")
                message_id = data.get("messageId")

                if not chat_id_target or not message_id:
                    continue

                oid = await try_object_id(message_id)
                if not oid:
                    continue

                msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id_target})
                if not msg:
                    continue

                if msg.get("senderId") != chat_id:
                    requester = await cl_users.find_one(
                        {"chatId": chat_id},
                        {"verified": 1, "adminLevel": 1, "profile.username": 1},
                    )
                    if not requester:
                        continue
                    permission_chat = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"chatType": 1, "createdBy": 1}
                    )
                    if permission_chat and permission_chat.get("chatType") == "group":
                        if not can_manage_group(requester, permission_chat):
                            continue
                    elif not bool(requester.get("verified", False)):
                        continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                is_official = is_official_channel_chat(chat_id_target)
                if not is_saved and not is_official:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                file_ids = collect_file_ids(msg)
                await cl_messages.delete_one({"_id": oid})
                await release_files(file_ids)

                last_msg = None
                if not is_saved and not is_official:
                    last_msg = await build_last_message(chat_id_target, token)
                    await cl_chats.update_one(
                        {"_id": chat_id_target},
                        {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
                    )
                    curr_chat = await cl_chats.find_one({"_id": chat_id_target}, {"pinnedMessage": 1})
                    if curr_chat and (curr_chat.get("pinnedMessage") or {}).get("id") == message_id:
                        await cl_chats.update_one(
                            {"_id": chat_id_target},
                            {"$set": {"pinnedMessage": None, "updatedAt": utc_now()}},
                        )
                        if participants:
                            await broadcast(
                                participants,
                                {
                                    "type": "message_unpinned",
                                    "chatId": chat_id_target,
                                },
                            )

                participants = [chat_id] if is_saved else []
                if is_official:
                    participants = await cl_users.distinct("chatId", {})
                if not is_saved and not is_official:
                    participants_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    participants = (
                        participants_doc.get("participants", [])
                        if participants_doc
                        else []
                    )

                out_last = None
                if last_msg:
                    out_last = {
                        **last_msg,
                        "timestamp": dt_to_epoch_ms(last_msg.get("timestamp")),
                    }

                payload = {
                    "type": "message_deleted",
                    "chatId": chat_id_target,
                    "messageId": message_id,
                    "lastMessage": out_last,
                }

                if participants:
                    await broadcast(participants, payload)

            elif data.get("type") == "seen":
                chat_id_target = data.get("chatId")
                max_id = data.get("maxMessageId")
                if not chat_id_target or not isinstance(max_id, str) or not max_id:
                    continue
                max_oid = await try_object_id(max_id)
                if not max_oid:
                    continue
                saved_chat_id = get_saved_messages_id(chat_id)
                if chat_id_target == saved_chat_id:
                    continue

                max_msg = await cl_messages.find_one(
                    {"_id": max_oid, "chatId": chat_id_target}, {"timestamp": 1}
                )
                if not max_msg:
                    continue

                seen_filter = {
                    "chatId": chat_id_target,
                    "senderId": {"$ne": chat_id},
                    "seenBy": {"$ne": chat_id},
                    "$or": [
                        {"timestamp": {"$lt": max_msg.get("timestamp")}},
                        {
                            "timestamp": max_msg.get("timestamp"),
                            "_id": {"$lte": max_oid},
                        },
                    ],
                }

                if is_official_channel_chat(chat_id_target):
                    result = await cl_messages.update_many(
                        seen_filter,
                        {"$addToSet": {"seenBy": chat_id}},
                    )
                    if result.modified_count > 0:
                        user_ids = await cl_users.distinct(
                            "chatId", {"chatId": {"$ne": chat_id}}
                        )
                        if user_ids:
                            await broadcast(
                                user_ids,
                                {
                                    "type": "messages_seen",
                                    "chatId": chat_id_target,
                                    "byUserId": chat_id,
                                    "maxMessageId": max_id,
                                },
                            )
                    continue

                chat_doc = await cl_chats.find_one(
                    {"_id": chat_id_target}, {"participants": 1}
                )
                if not chat_doc or chat_id not in chat_doc.get("participants", []):
                    continue

                result = await cl_messages.update_many(
                    seen_filter,
                    {"$addToSet": {"seenBy": chat_id}},
                )

                if result.modified_count > 0:
                    participants = chat_doc.get("participants", [])
                    await broadcast(
                        [p for p in participants if p != chat_id],
                        {
                            "type": "messages_seen",
                            "chatId": chat_id_target,
                            "byUserId": chat_id,
                            "maxMessageId": max_id,
                        },
                    )

            elif data.get("type") == "typing":
                chat_id_target = data.get("chatId")
                is_typing = bool(data.get("isTyping"))
                if not chat_id_target:
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                if chat_id_target == saved_chat_id or is_official_channel_chat(
                    chat_id_target
                ):
                    continue

                chat_doc = await cl_chats.find_one(
                    {"_id": chat_id_target}, {"participants": 1, "chatType": 1}
                )
                participants = chat_doc.get("participants", []) if chat_doc else []
                if chat_id not in participants:
                    continue
                if chat_doc and chat_doc.get("chatType") != "group":
                    other_id = next((p for p in participants if p != chat_id), "")
                    if other_id and await _is_direct_blocked_between(chat_id, other_id):
                        continue

                await broadcast(
                    [p for p in participants if p != chat_id],
                    {
                        "type": "typing",
                        "chatId": chat_id_target,
                        "userId": chat_id,
                        "isTyping": is_typing,
                    },
                )

            elif data.get("type") == "upload_status":
                chat_id_target = data.get("chatId")
                is_uploading = bool(data.get("isUploading"))
                if not chat_id_target:
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                if chat_id_target == saved_chat_id or is_official_channel_chat(
                    chat_id_target
                ):
                    continue

                chat_doc = await cl_chats.find_one(
                    {"_id": chat_id_target}, {"participants": 1, "chatType": 1}
                )
                participants = chat_doc.get("participants", []) if chat_doc else []
                if chat_id not in participants:
                    continue
                if chat_doc and chat_doc.get("chatType") != "group":
                    other_id = next((p for p in participants if p != chat_id), "")
                    if other_id and await _is_direct_blocked_between(chat_id, other_id):
                        continue

                await broadcast(
                    [p for p in participants if p != chat_id],
                    {
                        "type": "upload_status",
                        "chatId": chat_id_target,
                        "userId": chat_id,
                        "isUploading": is_uploading,
                    },
                )

            elif data.get("type") == "get_chats":
                request_id = data.get("requestId")
                try:
                    chats_data = await get_chat_list(current_user=user)
                    await websocket.send_json(
                        {
                            "type": "chats",
                            "requestId": request_id,
                            "chats": chats_data,
                        }
                    )
                except HTTPException as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": str(e.detail),
                        }
                    )

            elif data.get("type") == "get_messages":
                request_id = data.get("requestId")
                chat_id_target = data.get("chatId")
                raw_limit = data.get("limit", 100)
                try:
                    limit = int(raw_limit)
                except Exception:
                    limit = 100
                limit = max(1, min(limit, 200))

                if not chat_id_target or not isinstance(chat_id_target, str):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": "chatId is required",
                        }
                    )
                    continue

                try:
                    msgs = await get_messages(
                        chat_id=chat_id_target,
                        limit=limit,
                        current_user=user,
                    )
                    await websocket.send_json(
                        {
                            "type": "messages",
                            "requestId": request_id,
                            "chatId": chat_id_target,
                            "messages": msgs,
                        }
                    )
                except HTTPException as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": str(e.detail),
                        }
                    )

            elif data.get("type") == "react_message":
                request_id = data.get("requestId")
                chat_id_target = data.get("chatId")
                message_id = data.get("messageId")
                emoji = data.get("emoji")
                try:
                    result = await add_reaction(
                        chat_id=chat_id_target,
                        message_id=message_id,
                        req=ReactionRequest(emoji=str(emoji or "")),
                        current_user=user,
                    )
                    await websocket.send_json(
                        {"type": "react_message_ack", "requestId": request_id, **result}
                    )
                except HTTPException as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": str(e.detail),
                        }
                    )

            elif data.get("type") == "unreact_message":
                request_id = data.get("requestId")
                chat_id_target = data.get("chatId")
                message_id = data.get("messageId")
                try:
                    result = await remove_reaction(
                        chat_id=chat_id_target,
                        message_id=message_id,
                        current_user=user,
                    )
                    await websocket.send_json(
                        {
                            "type": "unreact_message_ack",
                            "requestId": request_id,
                            **result,
                        }
                    )
                except HTTPException as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": str(e.detail),
                        }
                    )

            elif data.get("type") == "forward_message":
                request_id = data.get("requestId")
                message_id = data.get("messageId")
                target_chat_id = data.get("targetChatId")
                try:
                    result = await forward_message(
                        req=ForwardMessageRequest(
                            messageId=str(message_id or ""),
                            targetChatId=str(target_chat_id or ""),
                        ),
                        current_user=user,
                    )
                    await websocket.send_json(
                        {
                            "type": "forward_message_ack",
                            "requestId": request_id,
                            **result,
                        }
                    )
                except HTTPException as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": str(e.detail),
                        }
                    )
            elif data.get("type") == "ai_message":
                await handle_ai_message(
                    chat_id, token, user_name, username, user_bio, data
                )
            elif data.get("type") == "ai_stop":
                current_stream_task = active_ai_stream_tasks.get(chat_id)
                if current_stream_task and not current_stream_task.done():
                    current_stream_task.cancel()
                    try:
                        await current_stream_task
                    except asyncio.CancelledError:
                        pass
                active_ai_stream_tasks.pop(chat_id, None)

            elif data.get("type") == "ping":
                last_client_activity = time.time()
                await websocket.send_json({"type": "pong"})

            elif data.get("type") == "pong":
                last_client_activity = time.time()

    except WebSocketDisconnect:
        pass
    except Exception:
        print(f"WebSocket Error for {chat_id}: {traceback.format_exc()}")
    finally:
        if chat_id and chat_id in active_ai_connections:
            if websocket in active_ai_connections[chat_id]:
                active_ai_connections[chat_id].remove(websocket)
            if not active_ai_connections[chat_id]:
                del active_ai_connections[chat_id]

        if chat_id and chat_id in active_connections:
            if websocket in active_connections[chat_id]:
                active_connections[chat_id].remove(websocket)

            alive_connections = [
                ws
                for ws in active_connections.get(chat_id, [])
                if ws.client_state == WebSocketState.CONNECTED
            ]
            active_connections[chat_id] = alive_connections

            if not active_connections[chat_id]:
                del active_connections[chat_id]

            became_offline = await mark_user_disconnected(chat_id)
            if became_offline:
                now_epoch = dt_to_epoch_ms(utc_now())
                user_chats = await cl_chats.find({"participants": chat_id}).to_list(
                    None
                )
                contacts_to_notify = set()
                for chat in user_chats:
                    for p in chat.get("participants", []):
                        if p != chat_id:
                            contacts_to_notify.add(p)

                allowed_contacts = await _filter_recipients_by_block_status(
                    chat_id, contacts_to_notify
                )
                allowed_contacts = await _filter_recipients_by_presence_visibility(
                    chat_id, allowed_contacts
                )
                await broadcast(
                    allowed_contacts,
                    {"type": "user_status", "userId": chat_id, "online": False, "lastSeen": now_epoch},
                )


async def ensure_ai_chat(user_id: str, ai_chat_id: str) -> dict:
    oid = await try_object_id(ai_chat_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid AI chat ID")
    chat = await cl_ai_chats.find_one({"_id": oid, "userId": user_id})
    if not chat:
        raise HTTPException(status_code=404, detail="AI chat not found")
    return chat




def tehran_day_key(now: Optional[datetime] = None) -> str:
    base = now or datetime.now(TEHRAN_TZ)
    return base.astimezone(TEHRAN_TZ).strftime("%Y-%m-%d")


async def get_usage_status(user_id: str, user_doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    day_key = tehran_day_key()
    if user_doc is None:
        user_doc = await cl_users.find_one(
            {"chatId": user_id},
            {"aiLimits": 1, "adminLevel": 1, "profile.username": 1},
        )
    global_settings = await get_ai_settings()
    limits = resolve_user_ai_limits(user_doc, global_settings)
    token_limit = limits["dailyTokenLimit"]
    file_limit = limits["dailyFileLimit"]
    search_limit = limits["dailySearchLimit"]
    ai_enabled = await is_ai_enabled_for_user(user_doc, global_settings)

    row = await cl_ai_usage.find_one({"userId": user_id, "dateKey": day_key})
    tokens_used = max(0, int(row.get("tokensUsed", 0))) if isinstance(row, dict) else 0
    file_used = max(0, int(row.get("fileCount", 0))) if isinstance(row, dict) else 0
    search_used = max(0, int(row.get("searchCount", 0))) if isinstance(row, dict) else 0
    used_percent = min(100, round((tokens_used / token_limit) * 100)) if token_limit > 0 else 100
    return {
        "dateKey": day_key,
        "resetTimezone": "Asia/Tehran",
        "aiEnabled": ai_enabled,
        "aiDisabledMessage": global_settings["disabledMessage"],
        "tokens": {
            "used": tokens_used,
            "remaining": max(0, token_limit - tokens_used),
            "limit": token_limit,
            "usedPercent": used_percent,
            "remainingPercent": max(0, 100 - used_percent),
            "exhausted": tokens_used >= token_limit,
        },
        "files": {
            "used": file_used,
            "remaining": max(0, file_limit - file_used),
            "limit": file_limit,
        },
        "search": {
            "used": search_used,
            "remaining": max(0, search_limit - search_used),
            "limit": search_limit,
        },
    }


async def record_token_usage(user_id: str, raw_tokens: int, model_key: str) -> Dict[str, Any]:
    effective_tokens = max(0, int(raw_tokens or 0))
    if normalize_ai_model_key(model_key) == "nova-pro":
        effective_tokens *= 2
    await cl_ai_usage.update_one(
        {"userId": user_id, "dateKey": tehran_day_key()},
        {
            "$inc": {"tokensUsed": effective_tokens},
            "$set": {"updatedAt": utc_now()},
            "$setOnInsert": {"createdAt": utc_now()},
        },
        upsert=True,
    )
    return await get_usage_status(user_id)


async def consume_daily_quota(user_id: str, field: str, limit: int) -> bool:
    day_key = tehran_day_key()
    row = await cl_ai_usage.find_one({"userId": user_id, "dateKey": day_key})
    used = max(0, int(row.get(field, 0))) if isinstance(row, dict) else 0
    if used >= limit:
        return False
    await cl_ai_usage.update_one(
        {"userId": user_id, "dateKey": day_key},
        {
            "$inc": {field: 1},
            "$set": {"updatedAt": utc_now()},
            "$setOnInsert": {"createdAt": utc_now()},
        },
        upsert=True,
    )
    return True


async def consume_file_quota(user_id: str, limit: Optional[int] = None) -> bool:
    if limit is None:
        user_doc = await cl_users.find_one({"chatId": user_id}, {"aiLimits": 1})
        limits = resolve_user_ai_limits(user_doc, await get_ai_settings())
        limit = limits["dailyFileLimit"]
    return await consume_daily_quota(user_id, "fileCount", limit)


async def consume_search_quota(user_id: str, limit: Optional[int] = None) -> bool:
    if limit is None:
        user_doc = await cl_users.find_one({"chatId": user_id}, {"aiLimits": 1})
        limits = resolve_user_ai_limits(user_doc, await get_ai_settings())
        limit = limits["dailySearchLimit"]
    return await consume_daily_quota(user_id, "searchCount", limit)


def ai_memory_scope(user_id: str) -> str:
    return f"ai-memory:{user_id}"


async def get_user_memories(user_id: str) -> List[Dict[str, str]]:
    rows = (
        await cl_ai_memories.find({"userId": user_id})
        .sort("updatedAt", -1)
        .limit(MAX_AI_USER_MEMORIES)
        .to_list(MAX_AI_USER_MEMORIES)
    )
    return [
        {
            "id": str(row["_id"]),
            "content": decrypt_with_fallback(
                row.get("content") or "", "", ai_memory_scope(user_id)
            ),
            "updatedAt": dt_to_epoch_ms(row.get("updatedAt")),
        }
        for row in rows
    ]


async def sweep_ai_temp_files(max_age_sec: int = AI_TEMP_FILE_TTL_SEC) -> None:
    AI_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - max_age_sec
    for entry in AI_TEMP_DIR.iterdir():
        try:
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                entry.unlink(missing_ok=True)
        except Exception:
            continue
    cutoff_dt = utc_now() - timedelta(seconds=max_age_sec)
    stale = await cl_ai_temp_files.find({"createdAt": {"$lt": cutoff_dt}}).to_list(None)
    for row in stale:
        try:
            file_name = Path(str(row.get("filePath") or "")).name
            await delete_ai_temp_file(file_name)
        except Exception:
            pass
    await cl_ai_temp_files.delete_many({"createdAt": {"$lt": cutoff_dt}})
    await cl_ai_usage.delete_many({"dateKey": {"$ne": tehran_day_key()}})


async def sweep_ai_temp_files_task() -> None:
    while True:
        try:
            await sweep_ai_temp_files()
        except Exception as e:
            print(f"AI temp sweep warning: {e}")
        await asyncio.sleep(600)


@app.get("/ai/usage-status")
@app.get("/ai/pro-usage-status")
@limiter.limit("100/minute;2000/hour")
async def get_ai_usage_status(
    request: Request, current_user: dict = Depends(get_current_user)
):
    status = await get_usage_status(current_user["chatId"], current_user)
    return {
        **status,
        "limit": status["tokens"]["limit"],
        "used": status["tokens"]["used"],
        "remaining": status["tokens"]["remaining"],
    }


class AIMemoryCreateRequest(BaseModel):
    content: str


@app.get("/ai/memories")
@limiter.limit("100/minute;2000/hour")
async def list_ai_memories(
    request: Request, current_user: dict = Depends(get_current_user)
):
    return await get_user_memories(current_user["chatId"])


@app.post("/ai/memories")
@limiter.limit("30/minute;300/hour")
async def add_ai_memory(
    request: Request,
    body: AIMemoryCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    content = re.sub(r"\s+", " ", str(body.content or "")).strip()[:200]
    if not content:
        raise HTTPException(status_code=400, detail="متن حافظه نمی‌تواند خالی باشد.")
    count = await cl_ai_memories.count_documents({"userId": user_id})
    if count >= MAX_AI_USER_MEMORIES:
        raise HTTPException(
            status_code=400, detail="حداکثر ۱۰ حافظه قابل ذخیره‌سازی است."
        )
    now = utc_now()
    inserted = await cl_ai_memories.insert_one(
        {
            "userId": user_id,
            "content": encrypt_scoped_text(content, "", ai_memory_scope(user_id)),
            "contentEncrypted": True,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    await safe_send_ai(user_id, {"type": "ai_memories_updated"})
    return {"id": str(inserted.inserted_id), "content": content, "updatedAt": dt_to_epoch_ms(now)}


@app.delete("/ai/memories/{memory_id}")
@limiter.limit("30/minute;300/hour")
async def delete_ai_memory(
    request: Request,
    memory_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    oid = await try_object_id(memory_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid memory ID")
    result = await cl_ai_memories.delete_one({"_id": oid, "userId": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Memory not found")
    await safe_send_ai(user_id, {"type": "ai_memories_updated"})
    return {"success": True}



@app.post("/ai/files/upload")
@limiter.limit("30/minute;300/hour")
async def upload_ai_file(
    request: Request,
    file: UploadFile = FastAPIFile(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    usage = await get_usage_status(user_id, current_user)
    if not usage.get("aiEnabled", True):
        raise HTTPException(status_code=403, detail=usage.get("aiDisabledMessage") or AI_DISABLED_DEFAULT_MESSAGE)
    if usage["tokens"]["exhausted"]:
        raise HTTPException(status_code=400, detail="سهمیه توکن امروز شما تکمیل شده است.")
    if usage["files"]["remaining"] <= 0:
        raise HTTPException(status_code=400, detail=f"سقف {usage['files']['limit']} فایل روزانه شما تکمیل شده است.")

    original_name = Path(str(file.filename or "")).name
    extension = Path(original_name).suffix.lower()
    if extension not in AI_ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="فرمت فایل پشتیبانی نمی‌شود.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="فایل خالی است.")
    if len(data) > AI_MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="حجم فایل بیشتر از ۱۰ مگابایت است.")

    unique_name = f"{uuid.uuid4().hex}{extension}"
    file_path = await save_ai_temp_file(data, unique_name)
    is_image = extension in AI_IMAGE_EXTENSIONS
    mime_type = (
        file.content_type
        or ("image/" + extension.lstrip(".").replace("jpg", "jpeg") if is_image else "application/octet-stream")
    )
    now = utc_now()
    inserted = await cl_ai_temp_files.insert_one(
        {
            "userId": user_id,
            "tempFileId": file_path.stem,
            "filePath": str(file_path),
            "fileName": original_name,
            "mimeType": mime_type,
            "fileSize": len(data),
            "isImage": is_image,
            "createdAt": now,
        }
    )
    return {
        "tempFileId": str(inserted.inserted_id),
        "fileName": original_name,
        "fileSize": len(data),
        "mimeType": mime_type,
        "isImage": is_image,
    }


@app.delete("/ai/files/{temp_file_id}")
@limiter.limit("60/minute;600/hour")
async def delete_ai_file(
    request: Request,
    temp_file_id: str,
    current_user: dict = Depends(get_current_user),
):
    oid = await try_object_id(temp_file_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid temp file ID")
    row = await cl_ai_temp_files.find_one(
        {"_id": oid, "userId": current_user["chatId"]}
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        file_name = Path(str(row.get("filePath") or "")).name
        await delete_ai_temp_file(file_name)
    except Exception:
        pass
    await cl_ai_temp_files.delete_one({"_id": oid})
    return {"success": True}


@app.get("/ai/chats")
@limiter.limit("100/minute;2000/hour")
async def get_ai_chats(
    request: Request, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    rows = (
        await cl_ai_chats.find(
            {
                "userId": user_id,
                "$or": [{"isTemporary": {"$exists": False}}, {"isTemporary": False}],
            }
        )
        .sort("updatedAt", -1)
        .to_list(200)
    )
    return [
        {
            "id": str(row["_id"]),
            "title": (
                decrypt_with_fallback(
                    row.get("title") or "",
                    session_token,
                    f"ai-chat-meta:{str(row['_id'])}",
                )
                or "گفتگوی جدید"
            ),
            "summary": decrypt_with_fallback(
                row.get("summary") or "",
                session_token,
                f"ai-chat-meta:{str(row['_id'])}",
            ),
            "updatedAt": dt_to_epoch_ms(row.get("updatedAt")),
        }
        for row in rows
    ]


class AICreateChatRequest(BaseModel):
    temporary: bool = False


@app.post("/ai/chats")
@limiter.limit("30/minute;100/hour")
async def create_ai_chat(
    request: Request,
    body: Optional[AICreateChatRequest] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    is_temporary = bool(body.temporary) if body else False
    now = utc_now()
    chat_doc = {
        "userId": user_id,
        "title": "",
        "summary": "",
        "titleEncrypted": True,
        "summaryEncrypted": True,
        "createdAt": now,
        "updatedAt": now,
        "isTemporary": is_temporary,
    }
    inserted = await cl_ai_chats.insert_one(chat_doc)
    scope = f"ai-chat-meta:{str(inserted.inserted_id)}"
    plain_title = "گفتگوی موقت" if is_temporary else "گفتگوی جدید"
    await cl_ai_chats.update_one(
        {"_id": inserted.inserted_id},
        {
            "$set": {
                "title": encrypt_scoped_text(plain_title, "", scope),
                "summary": encrypt_scoped_text("", "", scope),
            }
        },
    )
    return {
        "id": str(inserted.inserted_id),
        "title": plain_title,
        "summary": "",
        "updatedAt": dt_to_epoch_ms(now),
        "isTemporary": is_temporary,
    }


class AIChatRenameRequest(BaseModel):
    title: str


@app.patch("/ai/chats/{ai_chat_id}")
@limiter.limit("30/minute;100/hour")
async def rename_ai_chat(
    request: Request,
    ai_chat_id: str,
    body: AIChatRenameRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    chat = await ensure_ai_chat(user_id, ai_chat_id)
    next_title = str(body.title or "").strip()[:56]
    if not next_title:
        raise HTTPException(status_code=400, detail="Title is required")

    await cl_ai_chats.update_one(
        {"_id": chat["_id"]},
        {
            "$set": {
                "title": encrypt_scoped_text(
                    next_title, "", f"ai-chat-meta:{str(chat['_id'])}"
                ),
                "titleEncrypted": True,
            }
        },
    )
    return {
        "id": ai_chat_id,
        "title": next_title,
        "summary": decrypt_with_fallback(
            chat.get("summary") or "",
            str(current_user.get("_session_token") or ""),
            f"ai-chat-meta:{str(chat['_id'])}",
        ),
        "updatedAt": dt_to_epoch_ms(chat.get("updatedAt")),
    }


@app.delete("/ai/chats/{ai_chat_id}")
@limiter.limit("30/minute;100/hour")
async def delete_ai_chat(
    request: Request, ai_chat_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    chat = await ensure_ai_chat(user_id, ai_chat_id)
    await cl_ai_messages.delete_many({"userId": user_id, "aiChatId": ai_chat_id})
    await cl_ai_chats.delete_one({"_id": chat["_id"]})
    return {"success": True}


class AIStreamRequest(BaseModel):
    text: str = ""
    aiChatId: str
    clientId: Optional[str] = None
    useReasoner: bool = False
    modelKey: str = "nova-flash"
    useWebSearch: bool = False
    attachment: Optional[Dict[str, Any]] = None


@app.post("/ai/stream")
@limiter.limit("30/minute;300/hour")
async def stream_ai_message_sse(
    request: Request,
    body: AIStreamRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    profile = (
        current_user.get("profile", {})
        if isinstance(current_user.get("profile"), dict)
        else {}
    )
    user_name = profile.get("name", "")
    username = profile.get("username", "")
    user_bio = decrypt_user_bio(current_user, session_token)
    event_queue: asyncio.Queue = asyncio.Queue()

    async def event_generator():
        await handle_ai_message(
            user_id,
            session_token,
            user_name,
            username,
            user_bio,
            body.model_dump(),
            event_queue=event_queue,
        )
        try:
            while True:
                item = await event_queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            current_stream_task = active_ai_stream_tasks.get(user_id)
            if current_stream_task and not current_stream_task.done():
                current_stream_task.cancel()
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/ai/stop")
@limiter.limit("60/minute;500/hour")
async def stop_ai_message_stream(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    current_stream_task = active_ai_stream_tasks.get(user_id)
    if current_stream_task and not current_stream_task.done():
        current_stream_task.cancel()
        try:
            await current_stream_task
        except asyncio.CancelledError:
            pass
    active_ai_stream_tasks.pop(user_id, None)
    return {"success": True}


def _decode_search_sources(value: Any, token: str, scope: str) -> List[Dict[str, Any]]:
    if not value:
        return []
    raw = decrypt_with_fallback(value, token, scope)
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


@app.get("/ai/messages")
@limiter.limit("100/minute;2000/hour")
async def get_ai_messages(
    request: Request,
    chatId: str = Query(...),
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    ai_scope = f"ai:{chatId}"
    await ensure_ai_chat(user_id, chatId)

    msgs = (
        await cl_ai_messages.find({"userId": user_id, "aiChatId": chatId})
        .sort("timestamp", -1)
        .limit(limit)
        .to_list(limit)
    )
    msgs.reverse()

    active_task = active_ai_stream_tasks.get(user_id)
    has_live_stream = bool(active_task and not active_task.done())
    stale_ids = [
        m["_id"]
        for m in msgs
        if m.get("role") == "assistant"
        and not bool(m.get("streamCompleted", True))
        and not has_live_stream
    ]
    if stale_ids:
        await cl_ai_messages.update_many(
            {"_id": {"$in": stale_ids}},
            {"$set": {"streamCompleted": True}},
        )

    return [
        {
            "id": str(m["_id"]),
            "aiChatId": chatId,
            "senderId": "ai" if m["role"] == "assistant" else user_id,
            "text": decrypt_with_fallback(
                m.get("content", ""), session_token, ai_scope
            ),
            "reasoningContent": decrypt_with_fallback(
                m.get("reasoningContent", ""), session_token, ai_scope
            ),
            "reasoningEnabled": bool(m.get("reasoningEnabled", False)),
            "isStreaming": bool(
                has_live_stream
                and m["role"] == "assistant"
                and not bool(m.get("streamCompleted", True))
            ),
            "streamCompleted": bool(
                m.get("streamCompleted", True) or not has_live_stream
            ),
            "reasoningDurationSec": int(m.get("reasoningDurationSec", 0) or 0),
            "searchEnabled": bool(m.get("searchEnabled", False)),
            "searchStatus": (
                "completed"
                if (m.get("searchEnabled") and not has_live_stream)
                else str(m.get("searchStatus") or "")
            ),
            "searchSources": _decode_search_sources(
                m.get("searchSources"), session_token, ai_scope
            ),
            "analyzingAttachment": bool(
                has_live_stream
                and m.get("analyzingAttachment", False)
                and not bool(m.get("streamCompleted", True))
            ),
            "aiAttachment": m.get("attachmentMeta"),
            "aiModelKey": m.get("aiModelKey"),
            "aiModelName": m.get("aiModelName"),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
        }
        for m in msgs
    ]


@app.delete("/ai/messages/{message_id}")
@limiter.limit("30/minute;100/hour")
async def delete_ai_message(
    request: Request, message_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_ai_messages.find_one({"_id": oid, "userId": user_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    await cl_ai_messages.delete_one({"_id": oid})
    return {"success": True, "message": "Message deleted successfully"}


class ChessCreateGameRequest(BaseModel):
    timeControl: str
    color: str = "random"


class ChessInviteRequest(BaseModel):
    targetChatId: str


class ChessLinkJoinRequest(BaseModel):
    guestToken: Optional[str] = None


@app.post("/chess/games")
@limiter.limit("20/minute")
async def create_chess_game(
    request: Request,
    body: ChessCreateGameRequest,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    now = now_ms()
    blocking = await chess_find_blocking_game(me, now)
    if blocking:
        raise HTTPException(status_code=409, detail="already_in_game")
    try:
        game = chess_service.new_game(me, body.color, body.timeControl, now)
    except ChessError as error:
        raise chess_http_error(error)
    game["_id"] = uuid.uuid4().hex
    await cl_chess_games.insert_one(game)
    chess_schedule(game)
    return {"game": await chess_response(game)}


@app.get("/chess/games/current")
@limiter.limit("60/minute")
async def get_current_chess_game(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    now = now_ms()
    game = await chess_find_blocking_game(me, now)
    if not game:
        return {"game": None}
    return {"game": await chess_response(game)}


@app.get("/chess/games/history")
@limiter.limit("60/minute")
async def get_chess_history(
    request: Request,
    userId: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
):
    target_id = str(userId or "").strip() or current_user["chatId"]
    query = {
        "status": "finished",
        "reason": {"$nin": list(chess_service.ABORTED_REASONS)},
        "result": {"$ne": "*"},
        "$or": [{"players.white": target_id}, {"players.black": target_id}],
    }
    docs = (
        await cl_chess_games.find(query)
        .sort([("finishedAt", -1), ("createdAt", -1), ("_id", -1)])
        .skip(skip)
        .limit(limit + 1)
        .to_list(limit + 1)
    )
    has_more = len(docs) > limit
    page = docs[:limit]
    games = [await chess_response(g) for g in page]
    return {"games": games, "hasMore": has_more}


@app.get("/chess/games/{game_id}")
@limiter.limit("120/minute")
async def get_chess_game(
    request: Request,
    game_id: str,
    guestToken: Optional[str] = Query(None),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    game = await cl_chess_games.find_one({"_id": game_id})
    if not game:
        raise HTTPException(status_code=404, detail="not_found")
    if game.get("status") == "waiting" and now_ms() - game.get("createdAt", 0) >= chess_service.WAITING_TTL_MS:
        await chess_expire_waiting(game_id)
        raise HTTPException(status_code=404, detail="not_found")
    me = current_user["chatId"] if current_user else None
    if not me and guestToken and game.get("guestToken") and game.get("guestToken") == guestToken:
        me = game.get("guestId")
    if not me:
        raise HTTPException(status_code=401, detail="unauthorized")
    color = chess_service.color_of(game, me)
    if color is None and game.get("invitedChatId") != me and game.get("status") != "finished":
        raise HTTPException(status_code=403, detail="forbidden")
    view = await chess_response(game)
    view["me"] = color
    return view


@app.post("/chess/games/{game_id}/invite")
@limiter.limit("30/minute")
async def invite_to_chess_game(
    request: Request,
    game_id: str,
    body: ChessInviteRequest,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    target_id = str(body.targetChatId or "").strip()
    if not target_id or target_id == me:
        raise HTTPException(status_code=400, detail="bad_request")
    target_user = await cl_users.find_one(
        {"chatId": target_id, "deletion.status": {"$ne": "purging"}}, {"chatId": 1}
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="not_found")
    if await _is_direct_blocked_between(me, target_id):
        raise HTTPException(status_code=403, detail="forbidden")
    lock = chess_locks.setdefault(game_id, asyncio.Lock())
    async with lock:
        game = await cl_chess_games.find_one({"_id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="not_found")
        try:
            chess_service.set_invitee(game, me, target_id)
        except ChessError as error:
            raise chess_http_error(error)
        await cl_chess_games.replace_one({"_id": game_id}, game)
    chat_id = get_chat_id_for_two(me, target_id)
    chat_doc = await cl_chats.find_one({"_id": chat_id})
    now_dt = utc_now()
    if not chat_doc:
        await cl_chats.insert_one(
            {
                "_id": chat_id,
                "participants": sorted([me, target_id]),
                "createdAt": now_dt,
                "updatedAt": now_dt,
                "lastMessage": None,
            }
        )
    message_doc = {
        "chatId": chat_id,
        "senderId": me,
        "text": CHESS_INVITE_TEXT,
        "textEncrypted": True,
        "timestamp": now_dt,
        "seenBy": [me],
        "replyTo": None,
        "reactions": [],
        "chessInvite": {"gameId": game_id, "timeControl": game["timeControl"]},
    }
    inserted = await cl_messages.insert_one(message_doc)
    msg_id = str(inserted.inserted_id)
    last_msg = {
        "id": msg_id,
        "text": CHESS_INVITE_TEXT,
        "senderId": me,
        "timestamp": now_dt,
        "file": None,
    }
    await cl_chats.update_one(
        {"_id": chat_id},
        {"$set": {"lastMessage": last_msg, "updatedAt": now_dt}},
    )
    await broadcast(
        [me, target_id],
        {
            "type": "new_message",
            "chatId": chat_id,
            "message": {
                "id": msg_id,
                "chatId": chat_id,
                "senderId": me,
                "text": CHESS_INVITE_TEXT,
                "timestamp": dt_to_epoch_ms(now_dt),
                "seen": False,
                "replyTo": None,
                "edited": False,
                "reactions": [],
                "file": None,
                "clientId": None,
                "chessInvite": message_doc["chessInvite"],
            },
        },
    )
    schedule_push(
        notify_chat_message(chat_id, me, [me, target_id], False, False, [])
    )
    return {"ok": True}


@app.post("/chess/games/{game_id}/share")
@limiter.limit("30/minute")
async def share_chess_game(
    request: Request,
    game_id: str,
    body: ChessInviteRequest,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    target_id = str(body.targetChatId or "").strip()
    if not target_id or target_id == me:
        raise HTTPException(status_code=400, detail="bad_request")
    game = await cl_chess_games.find_one({"_id": game_id})
    if not game or game.get("status") != "finished":
        raise HTTPException(status_code=404, detail="not_found")
    if chess_service.color_of(game, me) is None:
        raise HTTPException(status_code=403, detail="forbidden")

    chat_doc = await cl_chats.find_one({"_id": target_id})
    now_dt = utc_now()
    if chat_doc:
        participants = chat_doc.get("participants", []) or []
        if me not in participants:
            raise HTTPException(status_code=403, detail="forbidden")
        if chat_doc.get("chatType") != "group":
            other_id = next((p for p in participants if p != me), "")
            if other_id and await _is_direct_blocked_between(me, other_id):
                raise HTTPException(status_code=403, detail="forbidden")
        chat_id = target_id
    else:
        target_user = await cl_users.find_one(
            {"chatId": target_id, "deletion.status": {"$ne": "purging"}}, {"chatId": 1}
        )
        if not target_user:
            raise HTTPException(status_code=404, detail="not_found")
        if await _is_direct_blocked_between(me, target_id):
            raise HTTPException(status_code=403, detail="forbidden")
        chat_id = get_chat_id_for_two(me, target_id)
        existing_chat = await cl_chats.find_one({"_id": chat_id})
        if not existing_chat:
            await cl_chats.insert_one(
                {
                    "_id": chat_id,
                    "participants": sorted([me, target_id]),
                    "createdAt": now_dt,
                    "updatedAt": now_dt,
                    "lastMessage": None,
                }
            )
        participants = sorted([me, target_id])

    message_doc = {
        "chatId": chat_id,
        "senderId": me,
        "text": CHESS_SHARE_TEXT,
        "textEncrypted": True,
        "timestamp": now_dt,
        "seenBy": [me],
        "replyTo": None,
        "reactions": [],
        "chessInvite": {"gameId": game_id, "timeControl": game["timeControl"], "shared": True},
    }
    inserted = await cl_messages.insert_one(message_doc)
    msg_id = str(inserted.inserted_id)
    last_msg = {
        "id": msg_id,
        "text": CHESS_SHARE_TEXT,
        "senderId": me,
        "timestamp": now_dt,
        "file": None,
    }
    await cl_chats.update_one(
        {"_id": chat_id},
        {"$set": {"lastMessage": last_msg, "updatedAt": now_dt}},
    )
    await broadcast(
        participants,
        {
            "type": "new_message",
            "chatId": chat_id,
            "message": {
                "id": msg_id,
                "chatId": chat_id,
                "senderId": me,
                "text": CHESS_SHARE_TEXT,
                "timestamp": dt_to_epoch_ms(now_dt),
                "seen": False,
                "replyTo": None,
                "edited": False,
                "reactions": [],
                "file": None,
                "clientId": None,
                "chessInvite": message_doc["chessInvite"],
            },
        },
    )
    schedule_push(
        notify_chat_message(
            chat_id,
            me,
            participants,
            bool(chat_doc and chat_doc.get("chatType") == "group"),
            False,
            [],
        )
    )
    return {"ok": True}


@app.post("/chess/games/{game_id}/accept")
@limiter.limit("30/minute")
async def accept_chess_game(
    request: Request,
    game_id: str,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    game = await cl_chess_games.find_one({"_id": game_id})
    if not game:
        raise HTTPException(status_code=404, detail="not_found")
    if game.get("status") == "waiting" and now_ms() - game.get("createdAt", 0) >= chess_service.WAITING_TTL_MS:
        await chess_expire_waiting(game_id)
        raise HTTPException(status_code=404, detail="not_found")
    if game.get("invitedChatId") != me:
        raise HTTPException(status_code=403, detail="forbidden")
    now = now_ms()
    my_active = await chess_find_blocking_game(me, now, only_active=True)
    if my_active and my_active["_id"] != game_id:
        raise HTTPException(status_code=409, detail="already_in_game")
    creator_active = await chess_find_blocking_game(game["creatorId"], now, only_active=True)
    if creator_active and creator_active["_id"] != game_id:
        raise HTTPException(status_code=409, detail="already_in_game")
    try:
        game, _ = await chess_run(game_id, lambda g, n: chess_service.join(g, me, n))
    except ChessError as error:
        raise chess_http_error(error)
    schedule_push(notify_chess_joined(game, me))
    return {"game": await chess_response(game)}


@app.get("/chess/join/{invite_token}")
@limiter.limit("60/minute")
async def inspect_chess_invite(request: Request, invite_token: str):
    game = await cl_chess_games.find_one({"inviteToken": invite_token})
    if not game:
        raise HTTPException(status_code=404, detail="not_found")
    if game.get("status") == "waiting" and now_ms() - game.get("createdAt", 0) >= chess_service.WAITING_TTL_MS:
        raise HTTPException(status_code=404, detail="not_found")
    return {"game": await chess_response(game)}


@app.post("/chess/join/{invite_token}")
@limiter.limit("20/minute")
async def join_chess_by_link(
    request: Request,
    invite_token: str,
    body: Optional[ChessLinkJoinRequest] = None,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    game = await cl_chess_games.find_one({"inviteToken": invite_token})
    if not game:
        raise HTTPException(status_code=404, detail="not_found")
    game_id = game["_id"]
    if game.get("status") == "waiting" and now_ms() - game.get("createdAt", 0) >= chess_service.WAITING_TTL_MS:
        raise HTTPException(status_code=404, detail="not_found")
    now = now_ms()

    if not current_user and request.headers.get("authorization"):
        raise HTTPException(status_code=401, detail="unauthorized")

    if current_user:
        me = current_user["chatId"]
        if me == game["creatorId"]:
            raise HTTPException(status_code=409, detail="own_game")
        if chess_service.color_of(game, me) is not None:
            return {"game": await chess_response(game), "mode": "user"}
        if game.get("status") != "waiting":
            raise HTTPException(status_code=409, detail="not_joinable")
        my_active = await chess_find_blocking_game(me, now, only_active=True)
        if my_active and my_active["_id"] != game_id:
            raise HTTPException(status_code=409, detail="already_in_game")
        creator_active = await chess_find_blocking_game(game["creatorId"], now, only_active=True)
        if creator_active and creator_active["_id"] != game_id:
            raise HTTPException(status_code=409, detail="already_in_game")
        try:
            game, _ = await chess_run(game_id, lambda g, n: chess_service.join_by_link(g, me, n))
        except ChessError as error:
            raise chess_http_error(error)
        schedule_push(notify_chess_joined(game, me))
        return {"game": await chess_response(game), "mode": "user"}

    guest_token = (body.guestToken if body else None) or ""
    if guest_token and game.get("guestToken") == guest_token and game.get("guestId"):
        return {
            "game": await chess_response(game),
            "mode": "guest",
            "guestId": game["guestId"],
            "guestToken": game["guestToken"],
        }
    if game.get("status") != "waiting":
        raise HTTPException(status_code=400, detail="not_joinable")
    creator_active = await chess_find_blocking_game(game["creatorId"], now, only_active=True)
    if creator_active and creator_active["_id"] != game_id:
        raise HTTPException(status_code=409, detail="already_in_game")
    guest_id = f"guest_{uuid.uuid4().hex[:12]}"
    guest_token = secrets.token_urlsafe(24)
    try:
        game, _ = await chess_run(
            game_id,
            lambda g, n: chess_service.join_by_link(g, guest_id, n, guest_token=guest_token),
        )
    except ChessError as error:
        raise chess_http_error(error)
    schedule_push(notify_chess_joined(game, guest_id))
    return {
        "game": await chess_response(game),
        "mode": "guest",
        "guestId": guest_id,
        "guestToken": guest_token,
    }


@app.get("/chess/leaderboard")
@limiter.limit("60/minute")
async def get_chess_leaderboard(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    my_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    my_blocked_ids = set(_get_blocked_from_user_doc(current_user))
    cursor = (
        cl_users.find(
            {
                **NOT_PURGING,
                "chatId": {"$not": {"$regex": "^guest_"}},
                "chessStats.gamesPlayed": {"$gt": 0},
            }
        )
        .sort([("chessStats.elo", -1), ("chessStats.wins", -1), ("chessStats.gamesPlayed", -1), ("chatId", 1)])
        .limit(100)
    )
    users = await cursor.to_list(100)
    leaderboard = []
    for idx, u in enumerate(users):
        u_id = u["chatId"]
        u_blocked_ids = set(_get_blocked_from_user_doc(u))
        blocked_by_me = u_id in my_blocked_ids
        blocked_by_other = my_id in u_blocked_ids
        blocked_relation = blocked_by_me or blocked_by_other
        presence = await resolve_user_presence_for_viewer(current_user, u, blocked=blocked_relation)
        stats = u.get("chessStats") or {}
        profile = u.get("profile") or {}
        wins = int(stats.get("wins", 0))
        losses = int(stats.get("losses", 0))
        draws = int(stats.get("draws", 0))
        leaderboard.append({
            "rank": idx + 1,
            "elo": int(stats.get("elo", 1200)),
            "wins": wins,
            "losses": losses,
            "draws": draws,
            "gamesPlayed": int(stats.get("gamesPlayed", wins + losses + draws)),
            "user": {
                "chatId": u_id,
                "username": profile.get("username", ""),
                "name": profile.get("name", ""),
                "avatar": (
                    profile.get("avatar", "")
                    if presence.get("avatarVisible") and not blocked_by_other
                    else ""
                ),
                "bio": (
                    decrypt_user_bio(u, session_token)
                    if presence.get("bioVisible")
                    else ""
                ),
                "online": presence["online"],
                "lastSeen": presence.get("lastSeen"),
                "lastSeenCategory": presence.get("lastSeenCategory"),
                "verified": bool(u.get("verified", False)),
                "registrationDate": u.get("registrationDate"),
                "blockedByMe": blocked_by_me,
                "blockedByOther": blocked_by_other,
            },
        })
    my_stats = current_user.get("chessStats") or {}
    my_elo = int(my_stats.get("elo", 1200))
    my_wins = int(my_stats.get("wins", 0))
    my_games = int(my_stats.get("gamesPlayed", 0))
    my_rank = None
    if my_games > 0:
        better = await cl_users.count_documents(
            {
                **NOT_PURGING,
                "chatId": {"$not": {"$regex": "^guest_"}},
                "chessStats.gamesPlayed": {"$gt": 0},
                "$or": [
                    {"chessStats.elo": {"$gt": my_elo}},
                    {"chessStats.elo": my_elo, "chessStats.wins": {"$gt": my_wins}},
                    {
                        "chessStats.elo": my_elo,
                        "chessStats.wins": my_wins,
                        "chessStats.gamesPlayed": {"$gt": my_games},
                    },
                    {
                        "chessStats.elo": my_elo,
                        "chessStats.wins": my_wins,
                        "chessStats.gamesPlayed": my_games,
                        "chatId": {"$lt": my_id},
                    },
                ],
            }
        )
        my_rank = better + 1
    return {
        "entries": leaderboard,
        "myStats": {
            "rank": my_rank,
            "elo": my_elo,
            "wins": my_wins,
            "losses": int(my_stats.get("losses", 0)),
            "draws": int(my_stats.get("draws", 0)),
            "gamesPlayed": my_games,
        },
    }


@app.delete("/chess/games/{game_id}")
@limiter.limit("30/minute")
async def delete_chess_game(
    request: Request,
    game_id: str,
    current_user: dict = Depends(get_current_user),
):
    me = current_user["chatId"]
    lock = chess_locks.setdefault(game_id, asyncio.Lock())
    async with lock:
        game = await cl_chess_games.find_one({"_id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="not_found")
        if game.get("creatorId") != me or game.get("status") != "waiting":
            raise HTTPException(status_code=403, detail="forbidden")
        await cl_chess_games.delete_one({"_id": game_id})
        handle = chess_timers.pop(game_id, None)
        if handle:
            handle.cancel()
    chess_locks.pop(game_id, None)
    return {"ok": True}


@app.websocket("/ws/chess")
async def chess_websocket(
    websocket: WebSocket,
    gameId: str = Query(...),
    token: Optional[str] = Query(None),
    guestToken: Optional[str] = Query(None),
):
    await websocket.accept()
    game = await cl_chess_games.find_one({"_id": gameId})
    user_id = None
    if token:
        user = await get_user_from_session_token(token)
        user_id = user.get("chatId") if user else None
    if not user_id and guestToken and game and game.get("guestToken") == guestToken:
        user_id = game.get("guestId")
    if not game or chess_service.color_of(game, user_id) is None:
        await websocket.close(code=1008)
        return
    room = chess_rooms.setdefault(gameId, {})
    room.setdefault(user_id, []).append(websocket)
    pending = chess_abandon_tasks.pop(f"{gameId}:{user_id}", None)
    if pending:
        pending.cancel()
    try:
        game, _ = await chess_run(
            gameId,
            lambda g, n: chess_service.set_connected(g, user_id, True, n),
        )
    except ChessError:
        await websocket.close(code=1008)
        return
    ping_task = asyncio.create_task(chess_ping_loop(websocket))
    stamps = []
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=95)
            except asyncio.TimeoutError:
                break
            except ValueError:
                continue
            now = time.time()
            stamps = [t for t in stamps if now - t < 10] + [now]
            if len(stamps) > 100:
                await websocket.close(code=1008)
                break
            kind = data.get("type") if isinstance(data, dict) else None
            if kind == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if kind == "pong":
                sent_at = data.get("ts")
                if isinstance(sent_at, (int, float)):
                    chess_latency.setdefault(gameId, {})[user_id] = max(0, now_ms() - int(sent_at))
                    await chess_send_latency(gameId)
                continue
            if kind == "emote":
                emote = str(data.get("emote") or "")
                color = chess_service.color_of(game, user_id)
                if emote in ("cry", "laugh", "mad", "nice", "cunning", "trol") and color in ("white", "black"):
                    payload = {"type": "emote", "by": color, "emote": emote}
                    sockets = [ws for conns in chess_rooms.get(gameId, {}).values() for ws in conns]
                    await asyncio.gather(*(ws.send_json(payload) for ws in sockets), return_exceptions=True)
                continue
            actions = {
                "move": lambda g, n: chess_service.apply_move(g, user_id, data.get("uci"), n),
                "resign": lambda g, n: chess_service.resign(g, user_id, n),
                "abort": lambda g, n: chess_service.abort(g, user_id, n),
                "draw_offer": lambda g, n: chess_service.offer_draw(g, user_id, n),
                "draw_accept": lambda g, n: chess_service.accept_draw(g, user_id, n),
                "draw_decline": lambda g, n: chess_service.decline_draw(g, user_id, n),
            }
            action = actions.get(kind)
            if not action:
                await websocket.send_json({"type": "error", "code": "bad_request"})
                continue
            try:
                await chess_run(gameId, action)
            except ChessError as error:
                await websocket.send_json({"type": "error", "code": error.code})
    except WebSocketDisconnect:
        pass
    finally:
        ping_task.cancel()
        conns = chess_rooms.get(gameId, {}).get(user_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            chess_rooms.get(gameId, {}).pop(user_id, None)
            chess_latency.get(gameId, {}).pop(user_id, None)
            if not chess_rooms.get(gameId):
                chess_rooms.pop(gameId, None)
                chess_latency.pop(gameId, None)
            try:
                await chess_run(
                    gameId,
                    lambda g, n: chess_service.set_connected(g, user_id, False, n),
                )
            except ChessError:
                pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
