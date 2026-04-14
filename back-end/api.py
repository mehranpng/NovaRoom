from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Depends,
    HTTPException,
    Query,
    UploadFile,
    File as FastAPIFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from typing import List, Dict, Optional, Any, Iterable
import traceback
import asyncio
import time
import hashlib
import secrets
import base64
import hmac
from bson import ObjectId
import re
import uuid
import jdatetime
from ai_service import (
    generate_ai_response_stream,
    generate_conversation_summary,
    generate_chat_title,
)
from email_service import (
    send_verification_email,
    verify_code,
    send_password_reset_email,
    verify_reset_code,
    clear_reset_code,
)
from api_reaction_helper import aggregate_reactions
from file_service import (
    save_uploaded_file,
    delete_file,
    validate_file_access,
    read_file_content,
    encrypt_existing_uploads,
    MAX_FILE_SIZE,
)

load_dotenv()

app = FastAPI(title="NovaRoom API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure HS256 secret is at least 32 bytes to avoid PyJWT InsecureKeyLengthWarning.
_raw_secret = os.getenv("SECRET_KEY", "")
if not _raw_secret:
    _raw_secret = "dev-secret-change-me"
if len(_raw_secret.encode("utf-8")) < 32:
    SECRET_KEY = hashlib.sha256(_raw_secret.encode("utf-8")).hexdigest()
else:
    SECRET_KEY = _raw_secret

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30
MAX_ACTIVE_SESSIONS = 10

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client["Messenger"]
cl_users = db["users"]
cl_chats = db["chats"]
cl_messages = db["messages"]
cl_ai_messages = db["ai_messages"]
cl_ai_chats = db["ai_chats"]

# Store active connections (multiple tabs/devices per user)
active_connections: Dict[str, List[WebSocket]] = {}
active_ai_connections: Dict[str, List[WebSocket]] = {}
active_ai_stream_tasks: Dict[str, asyncio.Task] = {}

security = HTTPBearer()

# Valid emojis for reactions
VALID_REACTIONS = [
    "👍",
    "👎",
    "🤣",
    "😢",
    "❤️",
    "💔",
    "😐",
    "😍",
    "🤔",
    "✅️",
    "❌️",
    "💩",
    "😡",
    "😰",
]

# Pin settings
MAX_PINNED_CHATS = 20
MAX_CHAT_MESSAGE_LENGTH = 6000
MAX_AI_MESSAGE_LENGTH = 3000
MAX_AI_MESSAGES_PER_CHAT = 30
ENC_PREFIX = "enc:v1:"
ENC_NONCE_SIZE = 16
ENC_TAG_SIZE = 16
LEGACY_BOOTSTRAP_TOKEN = "__bootstrap_migration__"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _derive_enc_key(token: str, scope: str) -> bytes:
    material = f"{SECRET_KEY}|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_shared(scope: str) -> bytes:
    material = f"{SECRET_KEY}|shared|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_scoped_tokenhash(token: str, scope: str) -> bytes:
    token_hint = hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()[:16]
    material = f"{SECRET_KEY}|{scope}|{token_hint}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _derive_enc_key_legacy_token_raw(token: str, scope: str) -> bytes:
    material = f"{SECRET_KEY}|{token}|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()




def _is_server_managed_scope(scope: str) -> bool:
    value = str(scope or "")
    return value.startswith("ai:") or value.startswith("ai-chat:") or value.startswith("ai-chat-meta:")

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
            _derive_enc_key_legacy_shared(scope),
            _derive_enc_key_legacy_scoped_tokenhash(token, scope),
            _derive_enc_key_legacy_token_raw(token, scope),
        ]
        for key in candidate_keys:
            expected = hmac.new(key, nonce + body, hashlib.sha256).digest()[:ENC_TAG_SIZE]
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
        # Compatibility path for legacy non-AI records encrypted server-side
        # before client-side E2EE rollout.
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
    # Prevent empty UI bubbles when decrypt fails for unknown legacy formats.
    return "🔐"


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
        # support ms/seconds
        v = float(dt)
        if v < 1_000_000_000_000:
            v *= 1000
        return int(v)

    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            # Mongo returns naive datetimes; we store them as UTC.
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)

    try:
        return int(float(dt))
    except Exception:
        return int(utc_now().timestamp() * 1000)


def normalize_username(value: Optional[str]) -> str:
    return (value or "").strip()


def validate_username(value: str) -> bool:
    if not value:
        return False
    if len(value) > 32:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9_]+", value))


def should_delete_file_with_message(message_doc: Dict[str, Any]) -> bool:
    file_data = message_doc.get("file") or {}
    file_id = str(file_data.get("fileId") or "").strip()
    if not file_id:
        return False
    # Forwarded messages share source fileId and must not remove file from server.
    return not bool(message_doc.get("forwardedFrom"))


async def jwt_encode_async(payload: dict) -> str:
    # Offload JWT crypto to a worker thread.
    return await asyncio.to_thread(jwt.encode, payload, SECRET_KEY, algorithm=ALGORITHM)


async def jwt_decode_async(token: str) -> dict:
    # Offload JWT crypto to a worker thread.
    return await asyncio.to_thread(
        jwt.decode, token, SECRET_KEY, algorithms=[ALGORITHM]
    )


async def bcrypt_checkpw_async(password: str, stored_hash: str) -> bool:
    # bcrypt is CPU-bound; run it off the event loop.
    pw = password.encode("utf-8")
    sh = stored_hash.encode("utf-8")
    return await asyncio.to_thread(bcrypt.checkpw, pw, sh)


class LoginRequest(BaseModel):
    email: str
    password: str


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


class RegisterEmailRequest(BaseModel):
    email: str


class VerifyCodeRequest(BaseModel):
    email: str
    code: str


class CompleteRegistrationRequest(BaseModel):
    email: str
    name: str
    username: str
    password: str


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetVerifyRequest(BaseModel):
    email: str
    code: str
    new_password: str


class ReactionRequest(BaseModel):
    emoji: str


class ForwardMessageRequest(BaseModel):
    messageId: str
    targetChatId: str
    encryptedText: Optional[str] = None
    encryptedReasoningContent: Optional[str] = None
    clientId: Optional[str] = None


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


def _normalize_session_list(user_doc: dict) -> List[dict]:
    login = (user_doc or {}).get("login") or {}
    sessions = login.get("sessions") or []
    if not isinstance(sessions, list):
        sessions = []
    now = utc_now()
    valid_sessions: List[dict] = []
    for item in sessions:
        if not isinstance(item, dict):
            continue
        token_hash = str(item.get("tokenHash") or "").strip()
        if not token_hash:
            continue
        expires_at = item.get("expiresAt")
        if isinstance(expires_at, datetime):
            exp_dt = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            if exp_dt <= now:
                continue
        valid_sessions.append(
            {
                "tokenHash": token_hash,
                "createdAt": item.get("createdAt") or now,
                "lastUsedAt": item.get("lastUsedAt") or now,
                "expiresAt": expires_at,
            }
        )
    valid_sessions.sort(key=lambda s: dt_to_epoch_ms(s.get("createdAt")), reverse=True)
    return valid_sessions[:MAX_ACTIVE_SESSIONS]


async def attach_session_to_user(chat_id: str, token: str):
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
    sessions.insert(
        0,
        {
            "tokenHash": hash_access_token(token),
            "createdAt": utc_now(),
            "lastUsedAt": utc_now(),
            "expiresAt": expires_at,
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
    await cl_users.update_one(
        {"chatId": chat_id},
        {"$set": {"login.sessions": deduped}, "$unset": {"login.token": ""}},
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

    raw_sessions = ((user.get("login") or {}).get("sessions") or [])
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
    user["online"] = bool(active_connections.get(user.get("chatId", "")))
    return user


@app.post("/auth/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
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

    await cl_users.update_one({"chatId": user_id}, {"$set": {"online": False}})
    user_chats = await cl_chats.find({"participants": user_id}).to_list(None)
    contacts_to_notify = set()
    for chat in user_chats:
        for p in chat.get("participants", []):
            if p != user_id:
                contacts_to_notify.add(p)
    allowed_contacts = await _filter_recipients_by_block_status(user_id, contacts_to_notify)
    await broadcast(
        allowed_contacts,
        {"type": "user_status", "userId": user_id, "online": False},
    )
    return {"message": "Logged out"}


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


def _user_can_pin_chat(user_id: str, chat_id: str) -> bool:
    # Allow pin for saved messages.
    if chat_id == get_saved_messages_id(user_id):
        return True
    # Allow only real chat ids.
    return isinstance(chat_id, str) and (
        chat_id.startswith("chat_") or chat_id.startswith("grp_")
    )


@app.on_event("startup")
async def startup_db():
    await cl_users.create_index("chatId", unique=True)
    await cl_users.create_index("login.email", unique=True)
    await cl_users.create_index("login.sessions.tokenHash")
    await cl_users.create_index("profile.username", unique=True)
    await cl_chats.create_index([("participants", 1)])
    await cl_chats.create_index([("updatedAt", -1)])
    await cl_messages.create_index("chatId")
    await cl_messages.create_index([("chatId", 1), ("timestamp", -1)])
    await cl_ai_messages.create_index("userId")
    await cl_ai_messages.create_index(
        [("userId", 1), ("aiChatId", 1), ("timestamp", -1)]
    )
    await cl_ai_chats.create_index([("userId", 1), ("updatedAt", -1)])
    await cl_users.update_many({}, {"$set": {"online": False}})
    await migrate_unencrypted_messages()
    await encrypt_existing_uploads()


async def migrate_unencrypted_messages():
    async for u in cl_users.find(
        {
            "$or": [
                {"profile.bioEncrypted": {"$ne": True}},
                {"profile.bio": {"$not": {"$regex": f"^{ENC_PREFIX}"}}},
            ]
        }
    ):
        chat_id = str(u.get("chatId") or "")
        if not chat_id:
            continue
        bio = str(((u.get("profile") or {}).get("bio")) or "")
        encrypted_bio = (
            encrypt_scoped_text(bio, LEGACY_BOOTSTRAP_TOKEN, user_bio_scope(chat_id))
            if bio and not is_ciphertext(bio)
            else bio
        )
        await cl_users.update_one(
            {"_id": u["_id"]},
            {
                "$set": {
                    "profile.bio": encrypted_bio,
                    "profile.bioEncrypted": True,
                }
            },
        )

    async for m in cl_messages.find(
        {"$or": [{"textEncrypted": {"$ne": True}}, {"text": {"$not": {"$regex": f"^{ENC_PREFIX}"}}}]}
    ):
        chat_scope = f"chat:{m.get('chatId', '')}"
        updates: Dict[str, Any] = {"textEncrypted": True}
        txt = str(m.get("text") or "")
        if txt and not is_ciphertext(txt):
            updates["text"] = encrypt_scoped_text(txt, LEGACY_BOOTSTRAP_TOKEN, chat_scope)
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
        {"$or": [{"contentEncrypted": {"$ne": True}}, {"content": {"$not": {"$regex": f"^{ENC_PREFIX}"}}}]}
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
            updates["title"] = encrypt_scoped_text(
                title, LEGACY_BOOTSTRAP_TOKEN, scope
            )
        if summary and not is_ciphertext(summary):
            updates["summary"] = encrypt_scoped_text(
                summary, LEGACY_BOOTSTRAP_TOKEN, scope
            )
        if updates:
            await cl_ai_chats.update_one({"_id": c["_id"]}, {"$set": updates})


@app.get("/profile/me/pins")
async def get_my_pins(current_user: dict = Depends(get_current_user)):
    return {"pinnedChatIds": _get_pinned_from_user_doc(current_user)}


@app.post("/profile/me/pins/{chat_id}")
async def pin_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["chatId"]

    if not _user_can_pin_chat(user_id, chat_id):
        raise HTTPException(status_code=400, detail="Invalid chatId")

    # Ensure user can access chat (except saved messages)
    if chat_id != get_saved_messages_id(user_id):
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
async def unpin_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
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
async def get_my_blocks(current_user: dict = Depends(get_current_user)):
    return {"blockedChatIds": _get_blocked_from_user_doc(current_user)}


@app.post("/profile/me/blocks/{target_chat_id}")
async def block_user(
    target_chat_id: str, current_user: dict = Depends(get_current_user)
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
async def unblock_user(
    target_chat_id: str, current_user: dict = Depends(get_current_user)
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


@app.post("/auth/register/email")
async def register_email(req: RegisterEmailRequest):
    """Step 1: Send verification code to email"""
    # Check if email already exists
    existing_user = await cl_users.find_one({"login.email": req.email})
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Send verification email
    code = await send_verification_email(req.email)
    if not code:
        raise HTTPException(status_code=500, detail="Failed to send verification email")

    return {"message": "Verification code sent to email", "email": req.email}


@app.post("/auth/register/verify")
async def verify_registration_code(req: VerifyCodeRequest):
    """Step 2: Verify the code sent to email"""
    # Verify the code
    is_valid = await verify_code(req.email, req.code)
    if not is_valid:
        raise HTTPException(
            status_code=400, detail="Invalid or expired verification code"
        )

    return {"message": "Code verified successfully", "email": req.email}


@app.post("/auth/register/complete", response_model=TokenResponse)
async def complete_registration(req: CompleteRegistrationRequest):
    """Step 3: Complete registration with name, username and password"""
    # Check if email already exists
    existing_user = await cl_users.find_one({"login.email": req.email})
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Validate username
    desired_username = normalize_username(req.username)
    if not validate_username(desired_username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    # Check if username is taken
    existing_username = await cl_users.find_one(
        {
            "profile.username": {
                "$regex": f"^{re.escape(desired_username)}$",
                "$options": "i",
            }
        }
    )
    if existing_username:
        raise HTTPException(status_code=409, detail="Username already taken")

    # Generate unique chatId
    chat_id = f"user_{uuid.uuid4().hex[:16]}"

    # Hash password
    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    hashed_password = await asyncio.to_thread(_hash_password, req.password)

    # Get current Jalali date
    now_jalali = jdatetime.datetime.now()
    registration_date = f"{now_jalali.year}/{now_jalali.month}/{now_jalali.day}"

    # Create user document
    user_doc = {
        "chatId": chat_id,
        "login": {"email": req.email, "password": hashed_password, "sessions": []},
        "profile": {
            "name": req.name,
            "username": desired_username,
            "bio": encrypt_scoped_text("", "", user_bio_scope(chat_id)),
            "bioEncrypted": True,
            "avatar": "",
        },
        "online": False,
        "verified": False,
        "registrationDate": registration_date,
        "createdAt": utc_now(),
    }

    try:
        await cl_users.insert_one(user_doc)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to create user")

    # Generate token
    token = await create_access_token({"chatId": chat_id})

    # Save hashed token session in database
    await attach_session_to_user(chat_id, token)

    return {
        "token": token,
        "user": {
            "chatId": chat_id,
            "username": desired_username,
            "name": req.name,
            "bio": "",
            "avatar": "",
            "online": False,
            "verified": False,
            "registrationDate": registration_date,
        },
    }


@app.post("/auth/password-reset/request")
async def request_password_reset(req: PasswordResetRequest):
    """Request password reset - sends code to email"""
    # Check if email exists
    user = await cl_users.find_one({"login.email": req.email})
    if not user:
        # Don't reveal if email exists or not for security
        return {"message": "If the email exists, a reset code has been sent"}

    # Send reset code
    code = await send_password_reset_email(req.email)
    if not code:
        raise HTTPException(status_code=500, detail="Failed to send reset email")

    return {"message": "Password reset code sent to email"}


@app.post("/auth/password-reset/verify")
async def verify_and_reset_password(req: PasswordResetVerifyRequest):
    """Verify reset code and change password"""
    # Verify the code
    is_valid = await verify_reset_code(req.email, req.code)
    if not is_valid:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")

    # Check if user exists
    user = await cl_users.find_one({"login.email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Hash new password
    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    hashed_password = await asyncio.to_thread(_hash_password, req.new_password)

    # Update password
    await cl_users.update_one(
        {"login.email": req.email},
        {
            "$set": {"login.password": hashed_password, "login.sessions": []},
            "$unset": {"login.token": ""},
        },
    )

    # Clear the reset code
    await clear_reset_code(req.email)

    return {"message": "Password reset successful"}


@app.post("/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = await cl_users.find_one({"login.email": req.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    stored_hash = user.get("login", {}).get("password")
    if not stored_hash or not isinstance(stored_hash, str):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    ok = await bcrypt_checkpw_async(req.password, stored_hash)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = await create_access_token({"chatId": user["chatId"]})

    await attach_session_to_user(user["chatId"], token)

    return {
        "token": token,
        "user": {
            "chatId": user["chatId"],
            "username": user["profile"]["username"],
            "name": user["profile"]["name"],
            "bio": decrypt_user_bio(user, token),
            "avatar": user["profile"]["avatar"],
            "online": bool(active_connections.get(user["chatId"])),
            "verified": bool(user.get("verified", False)),
            "registrationDate": user.get("registrationDate"),
        },
    }


@app.get("/profile/me")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return {
        "chatId": current_user["chatId"],
        "username": current_user["profile"]["username"],
        "name": current_user["profile"]["name"],
        "bio": current_user["profile"]["bio"],
        "avatar": current_user["profile"]["avatar"],
        "online": current_user.get("online", False),
        "verified": bool(current_user.get("verified", False)),
        "registrationDate": current_user.get("registrationDate"),
    }


@app.patch("/profile/me")
async def update_profile(
    updates: ProfileUpdate, current_user: dict = Depends(get_current_user)
):
    update_data = {}
    if updates.name:
        update_data["profile.name"] = updates.name

    if updates.username:
        desired = normalize_username(updates.username)
        if not validate_username(desired):
            raise HTTPException(status_code=400, detail="Invalid username")

        my_un = normalize_username(current_user.get("profile", {}).get("username"))
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
        update_data["profile.bio"] = encrypt_scoped_text(
            updates.bio, "", user_bio_scope(current_user["chatId"])
        )
        update_data["profile.bioEncrypted"] = True

    if updates.avatar is not None:
        avatar_value = str(updates.avatar).strip()
        update_data["profile.avatar"] = avatar_value

    if update_data:
        await cl_users.update_one(
            {"chatId": current_user["chatId"]}, {"$set": update_data}
        )
    return {"message": "Profile updated"}


@app.get("/profile/groups")
async def get_profile_groups(current_user: dict = Depends(get_current_user)):
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


@app.get("/users/username-available")
async def username_available(
    username: str = Query(..., min_length=1, max_length=32),
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
async def public_username_available(
    username: str = Query(..., min_length=1, max_length=32),
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
async def search_users(
    query: str = Query(..., min_length=2),
    current_user: dict = Depends(get_current_user),
):
    q = (query or "").strip()
    if q.startswith("@"):
        q = q.lstrip("@")

    users = (
        await cl_users.find(
            {
                "profile.username": {"$regex": re.escape(q), "$options": "i"},
                "chatId": {"$ne": current_user["chatId"]},
            }
        )
        .limit(10)
        .to_list(10)
    )

    return [
        {
            "chatId": u["chatId"],
            "username": u["profile"]["username"],
            "name": u["profile"]["name"],
            "avatar": u["profile"]["avatar"],
            "bio": decrypt_user_bio(u, str(current_user.get("_session_token") or "")),
            "online": bool(active_connections.get(u["chatId"])),
            "verified": bool(u.get("verified", False)),
            "registrationDate": u.get("registrationDate"),
        }
        for u in users
    ]


@app.post("/chats")
async def create_or_get_chat(
    req: ChatCreateRequest, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    target_id = req.targetChatId

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
async def create_group(
    req: GroupCreateRequest, current_user: dict = Depends(get_current_user)
):
    if not bool(current_user.get("verified", False)):
        raise HTTPException(
            status_code=403, detail="Only verified users can create groups"
        )

    name = (req.name or "").strip()
    if len(name) < 3:
        raise HTTPException(
            status_code=400, detail="Group name must be at least 3 characters"
        )
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="Group name is too long")

    creator_id = current_user["chatId"]
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
async def join_group(
    req: GroupJoinRequest, current_user: dict = Depends(get_current_user)
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
    await cl_chats.update_one(
        {"_id": group_chat["_id"]},
        {"$addToSet": {"participants": user_id}, "$set": {"updatedAt": utc_now()}},
    )

    return {
        "chatId": group_chat["_id"],
        "name": group_chat.get("groupName", "گروه بدون نام"),
        "inviteLink": build_group_invite_link(invite_code),
    }


@app.post("/groups/{chat_id}/leave")
async def leave_group(chat_id: str, current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]

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

    # If no members left, clean up the group.
    updated = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
    remaining = (updated or {}).get("participants", []) or []
    if not remaining:
        messages = await cl_messages.find({"chatId": chat_id}).to_list(None)
        for msg in messages:
            if should_delete_file_with_message(msg):
                file_data = msg.get("file") or {}
                await delete_file(file_data["fileId"])

        await cl_messages.delete_many({"chatId": chat_id})
        await cl_chats.delete_one({"_id": chat_id})
        return {"message": "Group deleted (no members left)"}

    return {"message": "Left group"}


@app.put("/groups/{chat_id}")
async def update_group(
    chat_id: str,
    req: GroupUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    if not bool(current_user.get("verified", False)):
        raise HTTPException(
            status_code=403, detail="Only verified users can update groups"
        )

    my_id = current_user["chatId"]

    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if chat.get("chatType") != "group":
        raise HTTPException(status_code=400, detail="Not a group chat")

    if my_id not in (chat.get("participants", []) or []):
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
async def get_chat_list(current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    my_blocked_ids = set(_get_blocked_from_user_doc(current_user))
    chats = (
        await cl_chats.find({"participants": my_id}).sort("updatedAt", -1).to_list(50)
    )

    # Check if user has saved messages
    saved_chat_id = get_saved_messages_id(my_id)
    saved_count = await cl_messages.count_documents({"chatId": saved_chat_id})

    result = []

    if not chats and saved_count == 0:
        return result

    chat_ids = [c["_id"] for c in chats]

    # Resolve other users in one query (avoid N+1 queries)
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

    # Compute unread counts in one aggregation (avoid N count_documents)
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
                        else (other_user["profile"]["avatar"] if other_user else "")
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
                            if other_user
                            else ""
                        )
                    ),
                    "online": (
                        False
                        if is_group
                        else (
                            False if blocked_relation else (
                                bool(active_connections.get(other_user.get("chatId", "")))
                                if other_user
                                else False
                            )
                        )
                    ),
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
                },
                "lastMessage": last_msg,
                "unreadCount": unread_map.get(chat["_id"], 0),
            }
        )

    # Add saved messages chat if it has messages
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
                "unreadCount": 0,
            }
        )

    return result


@app.get("/chats/{chat_id}/stats")
async def get_chat_stats(chat_id: str, current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]
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
async def get_chat_members(
    chat_id: str, current_user: dict = Depends(get_current_user)
):
    my_id = current_user["chatId"]
    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", [])
    if my_id not in participants:
        raise HTTPException(status_code=403, detail="Forbidden")

    users = await cl_users.find({"chatId": {"$in": participants}}).to_list(200)
    result = []
    for u in users:
        profile = u.get("profile", {})
        result.append(
            {
                "chatId": u.get("chatId", ""),
                "name": profile.get("name")
                or profile.get("username")
                or u.get("chatId", ""),
                "username": profile.get("username", ""),
                "avatar": profile.get("avatar", ""),
                "bio": decrypt_user_bio(
                    u, str(current_user.get("_session_token") or "")
                ),
                "verified": u.get("verified", False),
                "online": bool(active_connections.get(u.get("chatId", ""))),
            }
        )
    return result


@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]

    # Prevent deleting saved messages via normal delete endpoint
    saved_chat_id = get_saved_messages_id(my_id)
    if chat_id == saved_chat_id:
        raise HTTPException(status_code=403, detail="Cannot delete saved messages")

    chat = await cl_chats.find_one({"_id": chat_id})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    participants = chat.get("participants", [])
    if my_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    # For groups, only verified users can delete the whole group.
    if chat.get("chatType") == "group" and not bool(
        current_user.get("verified", False)
    ):
        raise HTTPException(
            status_code=403, detail="Only verified users can delete groups"
        )

    # Delete associated files
    messages = await cl_messages.find({"chatId": chat_id}).to_list(None)
    for msg in messages:
        if should_delete_file_with_message(msg):
            file_data = msg.get("file") or {}
            await delete_file(file_data["fileId"])

    await cl_messages.delete_many({"chatId": chat_id})
    await cl_chats.delete_one({"_id": chat_id})
    return {"message": "Chat deleted"}


@app.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str,
    limit: int = 50,
    direction: str = Query("latest", pattern="^(latest|older|newer)$"),
    cursor_ts: Optional[int] = None,
    cursor_id: Optional[str] = None,
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

    # Check if this is saved messages
    saved_chat_id = get_saved_messages_id(current_user_id)
    if chat_id == saved_chat_id:
        # For saved messages, don't mark as seen (no seenBy logic needed)
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
            }
        oldest = payload[0]
        newest = payload[-1]
        return {
            "messages": payload,
            "hasOlder": (
                await cl_messages.count_documents(
                    {"chatId": chat_id, **_has_more_filter(oldest["timestamp"], oldest["id"], "$lt")},
                    limit=1,
                )
                > 0
            ),
            "hasNewer": (
                await cl_messages.count_documents(
                    {"chatId": chat_id, **_has_more_filter(newest["timestamp"], newest["id"], "$gt")},
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
        }

    chat_doc = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
    participants: List[str] = chat_doc.get("participants", []) if chat_doc else []
    if current_user_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    # Mark messages as seen by the current user.
    await cl_messages.update_many(
        {"chatId": chat_id, "seenBy": {"$ne": current_user_id}},
        {"$addToSet": {"seenBy": current_user_id}},
    )

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

        # For my outgoing messages, "seen" should mean the other participant(s) saw it,
        # not that I (the sender) saw my own message.
        if sender_id == current_user_id:
            if not participants:
                return False
            other_participants = [p for p in participants if p != sender_id]
            if not other_participants:
                return False
            return any(p in seen_by for p in other_participants)

        # For incoming messages (only used by UI as theirs), keep it consistent.
        return current_user_id in seen_by

    payload = [
        {
            "id": str(m["_id"]),
            "chatId": m["chatId"],
            "senderId": m["senderId"],
            "text": decrypt_with_fallback(m.get("text", ""), session_token, chat_scope),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
            "seen": compute_seen(m),
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
        }
    oldest = payload[0]
    newest = payload[-1]
    return {
        "messages": payload,
        "hasOlder": (
            await cl_messages.count_documents(
                {"chatId": chat_id, **_has_more_filter(oldest["timestamp"], oldest["id"], "$lt")},
                limit=1,
            )
            > 0
        ),
        "hasNewer": (
            await cl_messages.count_documents(
                {"chatId": chat_id, **_has_more_filter(newest["timestamp"], newest["id"], "$gt")},
                limit=1,
            )
            > 0
        ),
        "oldestCursor": {"cursorTs": oldest["timestamp"], "cursorId": oldest["id"]},
        "newestCursor": {"cursorTs": newest["timestamp"], "cursorId": newest["id"]},
    }


# File upload endpoint
@app.post("/files/upload")
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    current_user: dict = Depends(get_current_user),
):
    file_content = await file.read()

    # Validate size
    if len(file_content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024*1024)}MB",
        )

    try:
        # Save file and get metadata
        file_metadata = await save_uploaded_file(
            file_content, file.filename or "unnamed"
        )
        file_metadata["uploadedBy"] = current_user["chatId"]

        return {"success": True, "file": file_metadata}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"File upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


# File download endpoint
@app.get("/files/{file_id}")
async def download_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
):
    # Validate file exists
    if not validate_file_access(file_id):
        raise HTTPException(status_code=404, detail="File not found")

    decrypted = await read_file_content(file_id)
    if decrypted is None:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=decrypted, media_type="application/octet-stream")


@app.delete("/files/{file_id}")
async def remove_uploaded_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
):
    file_doc = await cl_messages.find_one({"file.fileId": file_id}, {"_id": 1})
    if file_doc:
        raise HTTPException(
            status_code=409, detail="File is already attached to a message"
        )

    deleted = await delete_file(file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}


@app.post("/chats/{chat_id}/messages/{message_id}/react")
async def add_reaction(
    chat_id: str,
    message_id: str,
    req: ReactionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add or toggle a reaction to a message"""
    user_id = current_user["chatId"]
    emoji = req.emoji

    # Validate emoji
    if emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail="Invalid emoji")

    # Get message
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = msg.get("reactions", [])

    # Find user's existing reaction
    user_reaction = next((r for r in reactions if r.get("userId") == user_id), None)

    if user_reaction:
        if user_reaction.get("emoji") == emoji:
            # Same emoji - remove it (toggle off)
            reactions = [r for r in reactions if r.get("userId") != user_id]
        else:
            # Different emoji - replace it
            for r in reactions:
                if r.get("userId") == user_id:
                    r["emoji"] = emoji
    else:
        # Add new reaction
        reactions.append({"userId": user_id, "emoji": emoji})

    # Update message with raw reactions
    await cl_messages.update_one({"_id": oid}, {"$set": {"reactions": reactions}})

    # Aggregate for broadcast
    aggregated_reactions = aggregate_reactions(reactions)

    # Broadcast to participants
    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id

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
            },
        )

    return {"reactions": aggregated_reactions}


@app.get("/chats/{chat_id}/messages/{message_id}/seen-by")
async def get_message_seen_by(
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
        profile = (u or {}).get("profile", {})
        result.append(
            {
                "chatId": sid,
                "name": profile.get("name") or profile.get("username") or sid,
                "username": profile.get("username", ""),
                "avatar": profile.get("avatar", ""),
                "verified": bool((u or {}).get("verified", False)),
            }
        )

    return {"seenBy": result}


@app.delete("/chats/{chat_id}/messages/{message_id}/react")
async def remove_reaction(
    chat_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove user's reaction from a message"""
    user_id = current_user["chatId"]

    # Get message
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = msg.get("reactions", [])

    # Remove user's reaction
    reactions = [r for r in reactions if r.get("userId") != user_id]

    # Update message
    await cl_messages.update_one({"_id": oid}, {"$set": {"reactions": reactions}})

    # Aggregate for broadcast
    aggregated_reactions = aggregate_reactions(reactions)

    # Broadcast to participants
    saved_chat_id = get_saved_messages_id(user_id)
    is_saved = chat_id == saved_chat_id

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
            },
        )

    return {"reactions": aggregated_reactions}


@app.post("/messages/forward")
async def forward_message(
    req: ForwardMessageRequest, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    message_id = req.messageId
    target_chat_id = req.targetChatId

    # Get original message - check all collections
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    # Try to find in regular messages first
    original_msg = await cl_messages.find_one({"_id": oid})
    is_ai_message = False

    # If not found, try AI messages
    if not original_msg:
        original_msg = await cl_ai_messages.find_one({"_id": oid})
        is_ai_message = True

    if not original_msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check if user has access to the original message
    if is_ai_message:
        # For AI messages, check if it belongs to the user
        if original_msg.get("userId") != user_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    else:
        original_chat_id = original_msg.get("chatId")
        saved_chat_id = get_saved_messages_id(user_id)

        # For saved messages, only the owner can forward
        if original_chat_id == saved_chat_id:
            pass  # User can forward their own saved messages
        else:
            # For regular chats, check if user is a participant
            chat_doc = await cl_chats.find_one({"_id": original_chat_id})
            if not chat_doc:
                raise HTTPException(status_code=404, detail="Original chat not found")

            participants = chat_doc.get("participants", [])
            if user_id not in participants:
                raise HTTPException(status_code=403, detail="Not authorized")

    # Check if target chat exists or is saved messages or official channel
    is_target_saved = target_chat_id == get_saved_messages_id(user_id)
    if not is_target_saved:
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

    provided_encrypted_text = (
        str(req.encryptedText).strip() if isinstance(req.encryptedText, str) else ""
    )
    provided_encrypted_reasoning = (
        str(req.encryptedReasoningContent).strip()
        if isinstance(req.encryptedReasoningContent, str)
        else ""
    )
    client_id = str(req.clientId or "").strip()

    # Get original sender info and file data
    file_data = None
    if is_ai_message:
        ai_role = str(original_msg.get("role") or "").strip().lower()
        if ai_role == "assistant":
            forwarded_from_info = {
                "originalSenderId": "ai",
                "name": "NovaRoom AI",
                "username": "novaroom_ai",
            }
        else:
            # AI history also stores user's own messages with role="user".
            # Preserve user as original source so re-forwarding keeps this label.
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
            str(original_msg.get("reasoningContent") or ""), session_token, source_ai_scope
        )
        reasoning_enabled = bool(original_msg.get("reasoningEnabled", False))
        reasoning_duration_sec = int(original_msg.get("reasoningDurationSec", 0) or 0)
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
            # Preserve the original forwarded label chain:
            # if message is already forwarded, keep its first source.
            forwarded_from_info = {
                "originalSenderId": existing_original_sender_id,
                "name": existing_name,
                "username": existing_username,
            }
        else:
            original_sender_id = original_msg.get("senderId")
            original_sender = await cl_users.find_one({"chatId": original_sender_id})
            forwarded_from_info = {
                "originalSenderId": original_sender_id,
                "name": (
                    original_sender["profile"]["name"] if original_sender else "Unknown"
                ),
                "username": (
                    original_sender["profile"]["username"] if original_sender else ""
                ),
            }
        source_chat_scope = f"chat:{original_msg.get('chatId', '')}"
        message_text = decrypt_with_fallback(
            original_msg.get("text", ""), session_token, source_chat_scope
        )
        file_data = original_msg.get("file")
        reasoning_content = decrypt_with_fallback(
            str(original_msg.get("reasoningContent") or ""), session_token, source_chat_scope
        )
        reasoning_enabled = bool(original_msg.get("reasoningEnabled", False))
        reasoning_duration_sec = int(original_msg.get("reasoningDurationSec", 0) or 0)

    # Create forwarded message
    target_scope = f"chat:{target_chat_id}"
    encrypted_forward_text = (
        provided_encrypted_text
        if provided_encrypted_text
        else encrypt_scoped_text(message_text, session_token, target_scope)
    )
    encrypted_forward_reasoning = (
        provided_encrypted_reasoning
        if provided_encrypted_reasoning
        else encrypt_scoped_text(reasoning_content, session_token, target_scope)
    )
    forwarded_msg = {
        "chatId": target_chat_id,
        "senderId": user_id,
        "text": encrypted_forward_text,
        "textEncrypted": True,
        "timestamp": utc_now(),
        "seenBy": [user_id],
        "replyTo": None,  # Forwarded messages don't preserve replies
        "reactions": [],
        "forwardedFrom": forwarded_from_info,
        "reasoningContent": encrypted_forward_reasoning,
        "reasoningEnabled": reasoning_enabled,
        "reasoningDurationSec": reasoning_duration_sec,
    }

    # Add file data if present
    if file_data:
        forwarded_msg["file"] = file_data

    result = await cl_messages.insert_one(forwarded_msg)
    msg_id = str(result.inserted_id)

    last_msg = {
        "id": msg_id,
        "text": encrypted_forward_text if message_text else "[File]",
        "senderId": user_id,
        "timestamp": forwarded_msg["timestamp"],
        "file": file_data,
    }

    # Update chat document (only for non-saved chats)
    if not is_target_saved:
        await cl_chats.update_one(
            {"_id": target_chat_id},
            {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
        )

    # Broadcast to participants
    participants_to_notify = [user_id] if is_target_saved else []
    if not is_target_saved:
        target_chat_doc = await cl_chats.find_one(
            {"_id": target_chat_id}, {"participants": 1}
        )
        participants_to_notify = (
            target_chat_doc.get("participants", []) if target_chat_doc else []
        )

    if participants_to_notify:
        msg_payload = {
            "type": "new_message",
            "chatId": target_chat_id,
            "message": {
                                "id": msg_id,
                                "chatId": target_chat_id,
                                "senderId": user_id,
                                "text": encrypted_forward_text if message_text else "",
                "timestamp": dt_to_epoch_ms(forwarded_msg["timestamp"]),
                "seen": False,
                "replyTo": None,
                "edited": False,
                "reactions": [],
                "forwardedFrom": forwarded_from_info,
                "file": file_data,
                "reasoningContent": encrypted_forward_reasoning,
                "reasoningEnabled": reasoning_enabled,
                "reasoningDurationSec": reasoning_duration_sec,
                "clientId": client_id or None,
            },
        }
        await broadcast(participants_to_notify, msg_payload)

    return {
        "success": True,
        "messageId": msg_id,
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
    # Concurrently send to many users; safe_send handles cleaning dead sockets.
    await asyncio.gather(
        *(safe_send(uid, payload) for uid in set(user_ids)), return_exceptions=True
    )


async def safe_send_ai(user_id: str, message: dict):
    conns: List[WebSocket] = []
    seen_ws: set[int] = set()
    for ws in [*active_ai_connections.get(user_id, []), *active_connections.get(user_id, [])]:
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
        "text": decrypt_with_fallback(doc.get("text", ""), session_token, f"chat:{chat_id}"),
        "senderId": doc.get("senderId"),
        "timestamp": doc.get("timestamp"),
        "file": doc.get("file"),
    }


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

        is_first_connection = not active_connections.get(chat_id)
        active_connections.setdefault(chat_id, []).append(websocket)
        profile = (
            user.get("profile", {}) if isinstance(user.get("profile"), dict) else {}
        )
        user_name = profile.get("name", "")
        username = profile.get("username", "")
        user_bio = decrypt_user_bio(user, token)

        async def stream_ai_reply(
            ai_chat_id: str,
            prompt_messages: List[Dict[str, str]],
            memory_summary: str,
            model_name: str,
            reasoning_mode: bool,
            should_generate_title: bool = False,
            first_user_message: str = "",
            is_temporary_chat: bool = False,
        ):
            ai_scope = f"ai:{ai_chat_id}"
            ai_message_doc = {
                "userId": chat_id,
                "aiChatId": ai_chat_id,
                "role": "assistant",
                "content": encrypt_scoped_text("", token, ai_scope),
                "contentEncrypted": True,
                "reasoningContent": encrypt_scoped_text("", token, ai_scope),
                "reasoningEnabled": bool(reasoning_mode),
                "streamCompleted": False,
                "timestamp": utc_now(),
            }
            result = await cl_ai_messages.insert_one(ai_message_doc)
            ai_msg_id = str(result.inserted_id)
            message_ts_ms = dt_to_epoch_ms(ai_message_doc["timestamp"])

            await safe_send_ai(
                chat_id,
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
                        "timestamp": message_ts_ms,
                    },
                },
            )

            stopped = False
            full_ai_response = ""
            full_reasoning_content = ""
            stream_started_at = time.time()
            first_main_content_at: Optional[float] = None
            try:
                async for chunk in generate_ai_response_stream(
                    prompt_messages,
                    user_name=user_name,
                    username=username,
                    chat_id=chat_id,
                    bio=user_bio,
                    conversation_summary=memory_summary,
                    model=model_name,
                    reasoning_mode=reasoning_mode,
                ):
                    text_chunk = ""
                    reasoning_chunk = ""
                    if isinstance(chunk, dict):
                        text_chunk = str(chunk.get("content") or "")
                        reasoning_chunk = str(chunk.get("reasoning_content") or "")
                    elif isinstance(chunk, str):
                        text_chunk = chunk

                    if text_chunk:
                        full_ai_response += text_chunk
                        if first_main_content_at is None:
                            first_main_content_at = time.time()
                    if reasoning_chunk:
                        full_reasoning_content += reasoning_chunk

                    await cl_ai_messages.update_one(
                        {"_id": result.inserted_id},
                        {
                            "$set": {
                                "content": encrypt_scoped_text(
                                    full_ai_response, token, ai_scope
                                ),
                                "reasoningContent": encrypt_scoped_text(
                                    full_reasoning_content, token, ai_scope
                                ),
                                "streamCompleted": False,
                            }
                        },
                    )
                    await safe_send_ai(
                        chat_id,
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
                await cl_ai_messages.update_one(
                    {"_id": result.inserted_id},
                    {
                        "$set": {
                            "content": encrypt_scoped_text(
                                full_ai_response, token, ai_scope
                            ),
                            "reasoningContent": encrypt_scoped_text(
                                full_reasoning_content, token, ai_scope
                            ),
                            "streamCompleted": True,
                            "reasoningDurationSec": reasoning_duration_sec,
                        }
                    },
                )
                generated_title = ""
                chat_update: Dict[str, Any] = {"updatedAt": utc_now()}
                if is_temporary_chat:
                    chat_update["title"] = encrypt_scoped_text(
                        "گفتوگوی موقت", "", f"ai-chat-meta:{ai_chat_id}"
                    )
                    chat_update["titleEncrypted"] = True
                elif should_generate_title and not stopped:
                    candidate_title = await generate_chat_title(first_user_message)
                    if (
                        isinstance(candidate_title, str)
                        and candidate_title.strip()
                        and candidate_title.strip() != "گفتوگوی جدید"
                    ):
                        generated_title = candidate_title.strip()[:56]
                        chat_update["title"] = encrypt_scoped_text(
                            generated_title, "", f"ai-chat-meta:{ai_chat_id}"
                        )
                        chat_update["titleEncrypted"] = True
                await cl_ai_chats.update_one(
                    {"_id": await try_object_id(ai_chat_id), "userId": chat_id},
                    {"$set": chat_update},
                )

                await safe_send_ai(
                    chat_id,
                    {
                        "type": "ai_response_done",
                        "stopped": stopped,
                        "title": generated_title,
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
                            "timestamp": message_ts_ms,
                        },
                    },
                )

        if is_first_connection:
            await cl_users.update_one({"chatId": chat_id}, {"$set": {"online": True}})

            # Notify contacts (only on first active connection)
            user_chats = await cl_chats.find({"participants": chat_id}).to_list(None)
            contacts_to_notify = set()
            for chat in user_chats:
                for p in chat.get("participants", []):
                    if p != chat_id:
                        contacts_to_notify.add(p)

            allowed_contacts = await _filter_recipients_by_block_status(
                chat_id, contacts_to_notify
            )
            await broadcast(
                allowed_contacts,
                {"type": "user_status", "userId": chat_id, "online": True},
            )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=70)
            except asyncio.TimeoutError:
                # Proactively probe silent/stale connections so online status
                # doesn't stay "stuck" for a long time on abrupt network drops.
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
                file_data = data.get("file")  # File metadata from upload endpoint
                if not isinstance(text, str):
                    continue
                if len(text) > MAX_CHAT_MESSAGE_LENGTH:
                    continue

                # Allow empty text if file is present
                if not chat_id_target or (not text.strip() and not file_data):
                    continue

                # Check if this is saved messages
                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id

                if not is_saved:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1, "chatType": 1}
                    )
                    participants = chat_doc.get("participants", []) if chat_doc else []
                    if chat_id not in participants:
                        continue
                    if chat_doc and chat_doc.get("chatType") != "group":
                        other_id = next((p for p in participants if p != chat_id), "")
                        if other_id and await _is_direct_blocked_between(chat_id, other_id):
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
                }
                if reply_to and isinstance(reply_to.get("text"), str):
                    message_doc["replyTo"]["text"] = encrypt_scoped_text(
                        reply_to.get("text", ""), token, chat_scope
                    )

                # Add file data if present
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

                # Only update chat document for normal chats (not saved messages)
                if not is_saved:
                    await cl_chats.update_one(
                        {"_id": chat_id_target},
                        {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
                    )

                participants = [chat_id] if is_saved else []
                if not is_saved:
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
                            "file": file_data,
                            "clientId": client_id if isinstance(client_id, str) else None,
                        },
                    }

                    await broadcast(participants, msg_payload)

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
                if not is_saved:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                await cl_messages.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "text": encrypt_scoped_text(
                                new_text, token, f"chat:{chat_id_target}"
                            ),
                            "textEncrypted": True,
                            "editedAt": utc_now(),
                        }
                    },
                )

                # Update lastMessage text if it points to this message.
                if not is_saved:
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

                participants = [chat_id] if is_saved else []
                if not is_saved:
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
                        {"chatId": chat_id}, {"verified": 1}
                    )
                    if not requester or not bool(requester.get("verified", False)):
                        continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                if not is_saved:
                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                # Delete associated file if present
                if should_delete_file_with_message(msg):
                    file_data = msg.get("file") or {}
                    await delete_file(file_data["fileId"])

                await cl_messages.delete_one({"_id": oid})

                # Rebuild lastMessage if needed.
                last_msg = None
                if not is_saved:
                    last_msg = await build_last_message(chat_id_target, token)
                    await cl_chats.update_one(
                        {"_id": chat_id_target},
                        {"$set": {"lastMessage": last_msg, "updatedAt": utc_now()}},
                    )

                participants = [chat_id] if is_saved else []
                if not is_saved:
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
                if chat_id_target:
                    # Skip seen logic for saved messages
                    saved_chat_id = get_saved_messages_id(chat_id)
                    if chat_id_target == saved_chat_id:
                        continue

                    chat_doc = await cl_chats.find_one(
                        {"_id": chat_id_target}, {"participants": 1}
                    )
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                    await cl_messages.update_many(
                        {"chatId": chat_id_target, "seenBy": {"$ne": chat_id}},
                        {"$addToSet": {"seenBy": chat_id}},
                    )

                    if chat_doc:
                        participants = chat_doc.get("participants", [])
                        await broadcast(
                            [p for p in participants if p != chat_id],
                            {
                                "type": "messages_seen",
                                "chatId": chat_id_target,
                                "byUserId": chat_id,
                            },
                        )

            elif data.get("type") == "typing":
                chat_id_target = data.get("chatId")
                is_typing = bool(data.get("isTyping"))
                if not chat_id_target:
                    continue

                # Ignore saved messages typing indicator.
                saved_chat_id = get_saved_messages_id(chat_id)
                if chat_id_target == saved_chat_id:
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
                text = data.get("text")
                client_id = data.get("clientId")
                ai_chat_id = str(data.get("aiChatId") or "").strip()
                use_reasoner = bool(data.get("useReasoner"))
                model_name = "deepseek-reasoner" if use_reasoner else "deepseek-chat"

                if not isinstance(text, str) or not text.strip():
                    continue
                if len(text) > MAX_AI_MESSAGE_LENGTH:
                    continue

                try:
                    ai_chat = await ensure_ai_chat(chat_id, ai_chat_id)
                except HTTPException:
                    await asyncio.sleep(0.12)
                    try:
                        ai_chat = await ensure_ai_chat(chat_id, ai_chat_id)
                    except HTTPException:
                        await safe_send_ai(
                            chat_id,
                            {
                                "type": "ai_error",
                                "message": "گفتوگوی انتخاب‌شده معتبر نیست.",
                            },
                        )
                        continue

                user_msg_count = await cl_ai_messages.count_documents(
                    {"userId": chat_id, "aiChatId": ai_chat_id, "role": "user"}
                )
                if user_msg_count >= MAX_AI_MESSAGES_PER_CHAT:
                    await safe_send_ai(
                        chat_id,
                        {
                            "type": "ai_error",
                            "message": "حداکثر 30 پیام در هر گفتوگو مجاز است. لطفاً گفتوگوی جدید باز کنید.",
                        },
                    )
                    continue

                user_message_doc = {
                    "userId": chat_id,
                    "aiChatId": ai_chat_id,
                    "role": "user",
                    "content": encrypt_scoped_text(text, token, f"ai:{ai_chat_id}"),
                    "contentEncrypted": True,
                    "timestamp": utc_now(),
                }
                user_insert = await cl_ai_messages.insert_one(user_message_doc)

                await safe_send_ai(
                    chat_id,
                    {
                        "type": "ai_user_message_saved",
                        "title": "",
                        "clientId": client_id if isinstance(client_id, str) else None,
                        "message": {
                            "id": str(user_insert.inserted_id),
                            "aiChatId": ai_chat_id,
                            "senderId": chat_id,
                            "text": text,
                            "timestamp": dt_to_epoch_ms(user_message_doc["timestamp"]),
                        },
                    },
                )

                memory_summary = ""
                if isinstance(ai_chat.get("summary"), str):
                    memory_summary = decrypt_with_fallback(
                        ai_chat.get("summary", ""),
                        token,
                        f"ai-chat-meta:{ai_chat_id}",
                    ).strip()

                history_docs = (
                    await cl_ai_messages.find({"userId": chat_id, "aiChatId": ai_chat_id})
                    .sort("timestamp", -1)
                    .limit(6)
                    .to_list(6)
                )
                history_docs.reverse()
                messages = [
                    {
                        "role": doc["role"],
                        "content": decrypt_with_fallback(
                            doc.get("content", ""), token, f"ai:{ai_chat_id}"
                        ),
                    }
                    for doc in history_docs
                ]

                refreshed_summary = await generate_conversation_summary(
                    messages,
                    previous_summary=memory_summary,
                    user_name=user_name,
                    username=username,
                    chat_id=chat_id,
                    bio=user_bio,
                )
                await cl_ai_chats.update_one(
                    {"_id": ai_chat["_id"], "userId": chat_id},
                    {
                        "$set": {
                            "summary": encrypt_scoped_text(
                                refreshed_summary,
                                "",
                                f"ai-chat-meta:{ai_chat_id}",
                            ),
                            "summaryEncrypted": True,
                            "updatedAt": utc_now(),
                        }
                    },
                )

                current_stream_task = active_ai_stream_tasks.get(chat_id)
                if current_stream_task and not current_stream_task.done():
                    current_stream_task.cancel()
                    try:
                        await current_stream_task
                    except asyncio.CancelledError:
                        pass

                new_stream_task = asyncio.create_task(
                    stream_ai_reply(
                        ai_chat_id,
                        messages,
                        refreshed_summary,
                        model_name,
                        use_reasoner,
                        should_generate_title=(user_msg_count == 0),
                        first_user_message=text,
                        is_temporary_chat=bool(ai_chat.get("isTemporary", False)),
                    )
                )
                active_ai_stream_tasks[chat_id] = new_stream_task
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
                await websocket.send_json({"type": "pong"})

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

            if not active_connections[chat_id]:
                del active_connections[chat_id]

                await cl_users.update_one(
                    {"chatId": chat_id}, {"$set": {"online": False}}
                )

                # Notify contacts of offline status (only when last connection is gone)
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
                await broadcast(
                    allowed_contacts,
                    {"type": "user_status", "userId": chat_id, "online": False},
                )


async def ensure_ai_chat(user_id: str, ai_chat_id: str) -> dict:
    oid = await try_object_id(ai_chat_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid AI chat ID")
    chat = await cl_ai_chats.find_one({"_id": oid, "userId": user_id})
    if not chat:
        raise HTTPException(status_code=404, detail="AI chat not found")
    return chat


@app.get("/ai/chats")
async def get_ai_chats(current_user: dict = Depends(get_current_user)):
    user_id = current_user["chatId"]
    session_token = str(current_user.get("_session_token") or "")
    rows = (
        await cl_ai_chats.find(
            {"userId": user_id, "$or": [{"isTemporary": {"$exists": False}}, {"isTemporary": False}]}
        ).sort("updatedAt", -1).to_list(200)
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
                or "گفتوگوی جدید"
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
async def create_ai_chat(
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
    plain_title = "گفتوگوی موقت" if is_temporary else "گفتوگوی جدید"
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
async def rename_ai_chat(
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
async def delete_ai_chat(
    ai_chat_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]
    chat = await ensure_ai_chat(user_id, ai_chat_id)
    await cl_ai_messages.delete_many({"userId": user_id, "aiChatId": ai_chat_id})
    await cl_ai_chats.delete_one({"_id": chat["_id"]})
    return {"success": True}


@app.websocket("/ws/ai")
async def websocket_ai_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()
    user_id: Optional[str] = None

    try:
        user = await get_user_from_session_token(token)
        if not user:
            await websocket.close(code=1008)
            return
        user_id = user.get("chatId")

        active_ai_connections.setdefault(user_id, []).append(websocket)

        profile = (
            user.get("profile", {}) if isinstance(user.get("profile"), dict) else {}
        )
        user_name = profile.get("name", "")
        username = profile.get("username", "")
        user_bio = decrypt_user_bio(user, token)

        async def stream_ai_reply(
            ai_chat_id: str,
            prompt_messages: List[Dict[str, str]],
            memory_summary: str,
            model_name: str,
            reasoning_mode: bool,
            should_generate_title: bool = False,
            first_user_message: str = "",
            is_temporary_chat: bool = False,
        ):
            ai_scope = f"ai:{ai_chat_id}"
            ai_message_doc = {
                "userId": user_id,
                "aiChatId": ai_chat_id,
                "role": "assistant",
                "content": encrypt_scoped_text("", token, ai_scope),
                "contentEncrypted": True,
                "reasoningContent": encrypt_scoped_text("", token, ai_scope),
                "reasoningEnabled": bool(reasoning_mode),
                "streamCompleted": False,
                "timestamp": utc_now(),
            }
            result = await cl_ai_messages.insert_one(ai_message_doc)
            ai_msg_id = str(result.inserted_id)
            message_ts_ms = dt_to_epoch_ms(ai_message_doc["timestamp"])

            await safe_send_ai(
                user_id,
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
                        "timestamp": message_ts_ms,
                    },
                },
            )

            stopped = False
            full_ai_response = ""
            full_reasoning_content = ""
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
                ):
                    text_chunk = ""
                    reasoning_chunk = ""
                    if isinstance(chunk, dict):
                        text_chunk = str(chunk.get("content") or "")
                        reasoning_chunk = str(chunk.get("reasoning_content") or "")
                    elif isinstance(chunk, str):
                        text_chunk = chunk

                    if text_chunk:
                        full_ai_response += text_chunk
                        if first_main_content_at is None:
                            first_main_content_at = time.time()
                    if reasoning_chunk:
                        full_reasoning_content += reasoning_chunk

                    await cl_ai_messages.update_one(
                        {"_id": result.inserted_id},
                        {
                            "$set": {
                                "content": encrypt_scoped_text(
                                    full_ai_response, token, ai_scope
                                ),
                                "reasoningContent": encrypt_scoped_text(
                                    full_reasoning_content, token, ai_scope
                                ),
                                "streamCompleted": False,
                            }
                        },
                    )
                    await safe_send_ai(
                        user_id,
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
                        round(
                            (first_main_content_at or time.time())
                            - stream_started_at
                        ),
                    )
                )
                await cl_ai_messages.update_one(
                    {"_id": result.inserted_id},
                    {
                        "$set": {
                            "content": encrypt_scoped_text(
                                full_ai_response, token, ai_scope
                            ),
                            "reasoningContent": encrypt_scoped_text(
                                full_reasoning_content, token, ai_scope
                            ),
                            "streamCompleted": True,
                            "reasoningDurationSec": reasoning_duration_sec,
                        }
                    },
                )
                generated_title = ""
                chat_update: Dict[str, Any] = {"updatedAt": utc_now()}
                if is_temporary_chat:
                    chat_update["title"] = encrypt_scoped_text(
                        "گفتوگوی موقت", "", f"ai-chat-meta:{ai_chat_id}"
                    )
                    chat_update["titleEncrypted"] = True
                elif should_generate_title and not stopped:
                    candidate_title = await generate_chat_title(first_user_message)
                    if (
                        isinstance(candidate_title, str)
                        and candidate_title.strip()
                        and candidate_title.strip() != "گفتوگوی جدید"
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

                await safe_send_ai(
                    user_id,
                    {
                        "type": "ai_response_done",
                        "stopped": stopped,
                        "title": generated_title,
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
                            "timestamp": message_ts_ms,
                        },
                    },
                )

        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                continue

            if data.get("type") == "ai_message":
                text = data.get("text")
                client_id = data.get("clientId")
                ai_chat_id = str(data.get("aiChatId") or "").strip()
                use_reasoner = bool(data.get("useReasoner"))
                model_name = "deepseek-reasoner" if use_reasoner else "deepseek-chat"

                if not isinstance(text, str) or not text.strip():
                    continue
                if len(text) > MAX_AI_MESSAGE_LENGTH:
                    continue

                try:
                    ai_chat = await ensure_ai_chat(user_id, ai_chat_id)
                except HTTPException:
                    # In rare race cases, chat can be created immediately before ws send.
                    await asyncio.sleep(0.12)
                    try:
                        ai_chat = await ensure_ai_chat(user_id, ai_chat_id)
                    except HTTPException:
                        await safe_send_ai(
                            user_id,
                            {
                                "type": "ai_error",
                                "message": "گفتوگوی انتخاب‌شده معتبر نیست.",
                            },
                        )
                        continue

                user_msg_count = await cl_ai_messages.count_documents(
                    {"userId": user_id, "aiChatId": ai_chat_id, "role": "user"}
                )
                if user_msg_count >= MAX_AI_MESSAGES_PER_CHAT:
                    await safe_send_ai(
                        user_id,
                        {
                            "type": "ai_error",
                            "message": "حداکثر 30 پیام در هر گفتوگو مجاز است. لطفاً گفتوگوی جدید باز کنید.",
                        },
                    )
                    continue

                # Save user message
                user_message_doc = {
                    "userId": user_id,
                    "aiChatId": ai_chat_id,
                    "role": "user",
                    "content": encrypt_scoped_text(text, token, f"ai:{ai_chat_id}"),
                    "contentEncrypted": True,
                    "timestamp": utc_now(),
                }
                user_insert = await cl_ai_messages.insert_one(user_message_doc)

                await safe_send_ai(
                    user_id,
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
                        },
                    },
                )

                memory_summary = ""
                if isinstance(ai_chat.get("summary"), str):
                    memory_summary = decrypt_with_fallback(
                        ai_chat.get("summary", ""),
                        token,
                        f"ai-chat-meta:{ai_chat_id}",
                    ).strip()

                history_docs = (
                    await cl_ai_messages.find(
                        {"userId": user_id, "aiChatId": ai_chat_id}
                    )
                    .sort("timestamp", -1)
                    .limit(6)
                    .to_list(6)
                )
                history_docs.reverse()

                messages = [
                    {
                        "role": doc["role"],
                        "content": decrypt_with_fallback(
                            doc.get("content", ""), token, f"ai:{ai_chat_id}"
                        ),
                    }
                    for doc in history_docs
                ]

                refreshed_summary = await generate_conversation_summary(
                    messages,
                    previous_summary=memory_summary,
                    user_name=user_name,
                    username=username,
                    chat_id=user_id,
                    bio=user_bio,
                )
                await cl_ai_chats.update_one(
                    {"_id": ai_chat["_id"], "userId": user_id},
                    {
                        "$set": {
                            "summary": encrypt_scoped_text(
                                refreshed_summary, "", f"ai-chat-meta:{ai_chat_id}"
                            ),
                            "summaryEncrypted": True,
                            "updatedAt": utc_now(),
                        }
                    },
                )

                current_stream_task = active_ai_stream_tasks.get(user_id)
                if current_stream_task and not current_stream_task.done():
                    current_stream_task.cancel()
                    try:
                        await current_stream_task
                    except asyncio.CancelledError:
                        pass

                new_stream_task = asyncio.create_task(
                    stream_ai_reply(
                        ai_chat_id,
                        messages,
                        refreshed_summary,
                        model_name,
                        use_reasoner,
                        should_generate_title=(user_msg_count == 0),
                        first_user_message=text,
                        is_temporary_chat=bool(ai_chat.get("isTemporary", False)),
                    )
                )
                active_ai_stream_tasks[user_id] = new_stream_task

            elif data.get("type") == "ai_stop":
                current_stream_task = active_ai_stream_tasks.get(user_id)
                if current_stream_task and not current_stream_task.done():
                    current_stream_task.cancel()
                    try:
                        await current_stream_task
                    except asyncio.CancelledError:
                        pass
                active_ai_stream_tasks.pop(user_id, None)

            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        print(f"AI WebSocket Error for {user_id}: {traceback.format_exc()}")
    finally:
        if (
            user_id
            and user_id in active_ai_connections
            and websocket in active_ai_connections[user_id]
        ):
            active_ai_connections[user_id].remove(websocket)
            if not active_ai_connections[user_id]:
                del active_ai_connections[user_id]


@app.get("/ai/messages")
async def get_ai_messages(
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

    return [
        {
            "id": str(m["_id"]),
            "aiChatId": chatId,
            "senderId": "ai" if m["role"] == "assistant" else user_id,
            "text": decrypt_with_fallback(m.get("content", ""), session_token, ai_scope),
            "reasoningContent": decrypt_with_fallback(
                m.get("reasoningContent", ""), session_token, ai_scope
            ),
            "reasoningEnabled": bool(m.get("reasoningEnabled", False)),
            "isStreaming": bool(
                m["role"] == "assistant" and not bool(m.get("streamCompleted", True))
            ),
            "streamCompleted": bool(m.get("streamCompleted", True)),
            "reasoningDurationSec": int(m.get("reasoningDurationSec", 0) or 0),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
        }
        for m in msgs
    ]


@app.delete("/ai/messages/{message_id}")
async def delete_ai_message(
    message_id: str, current_user: dict = Depends(get_current_user)
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
