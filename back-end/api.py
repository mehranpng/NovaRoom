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
from fastapi.responses import FileResponse
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
import hashlib
from bson import ObjectId
import re
import uuid
import jdatetime
from ai_service import generate_ai_response
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
    get_file_path,
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
ACCESS_TOKEN_EXPIRE_DAYS = 7

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client["Messenger2"]
cl_users = db["users"]
cl_chats = db["chats"]
cl_messages = db["messages"]
cl_ai_messages = db["ai_messages"]
cl_official_ch = db["official_ch"]  # Official channel messages

# Store active connections (multiple tabs/devices per user)
active_connections: Dict[str, List[WebSocket]] = {}

security = HTTPBearer()

# Valid emojis for reactions
VALID_REACTIONS = ["👍", "👎", "🤣", "😢", "❤️", "💔", "😐"]

# Official channel ID
OFFICIAL_CH_ID = "official_ch"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


class OfficialChSendRequest(BaseModel):
    text: str
    replyToId: Optional[str] = None
    file: Optional[dict] = None


class OfficialChEditRequest(BaseModel):
    text: str


async def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = utc_now() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return await jwt_encode_async(to_encode)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    try:
        payload = await jwt_decode_async(credentials.credentials)
        chat_id: Optional[str] = payload.get("chatId")
        if not chat_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await cl_users.find_one({"chatId": chat_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_chat_id_for_two(part1: str, part2: str) -> str:
    sorted_ids = sorted([part1, part2])
    return f"chat_{sorted_ids[0]}_{sorted_ids[1]}"


def get_saved_messages_id(user_id: str) -> str:
    return f"saved_messages_{user_id}"


def build_group_invite_link(invite_code: str) -> str:
    return f"novaroom://group/{invite_code}"


def normalize_group_invite_code(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    deep_link = re.search(r"group/([a-zA-Z0-9]+)", raw)
    if deep_link and deep_link.group(1):
        return deep_link.group(1)

    query_link = re.search(r"groupInvite=([a-zA-Z0-9]+)", raw)
    if query_link and query_link.group(1):
        return query_link.group(1)

    return raw


@app.on_event("startup")
async def startup_db():
    await cl_users.create_index("chatId", unique=True)
    await cl_users.create_index("login.email", unique=True)
    await cl_users.create_index("profile.username", unique=True)
    await cl_chats.create_index([("participants", 1)])
    await cl_chats.create_index([("updatedAt", -1)])
    await cl_messages.create_index("chatId")
    await cl_messages.create_index([("chatId", 1), ("timestamp", -1)])
    await cl_ai_messages.create_index("userId")
    await cl_ai_messages.create_index([("userId", 1), ("timestamp", -1)])
    await cl_official_ch.create_index([("timestamp", -1)])


# ==================== OFFICIAL CHANNEL ENDPOINTS ====================

@app.get("/official-ch/info")
async def get_official_ch_info(current_user: dict = Depends(get_current_user)):
    """Get official channel info including message count and last message"""
    total_messages = await cl_official_ch.count_documents({})
    
    last_msg_doc = await cl_official_ch.find_one(
        {}, sort=[("timestamp", -1)]
    )
    
    last_message = None
    if last_msg_doc:
        last_message = {
            "id": str(last_msg_doc["_id"]),
            "text": last_msg_doc.get("text", ""),
            "senderId": last_msg_doc.get("sender_id"),
            "timestamp": dt_to_epoch_ms(last_msg_doc.get("timestamp")),
        }
    
    return {
        "id": OFFICIAL_CH_ID,
        "name": "کانال رسمی نوا روم",
        "avatar": "/avatars/ch.png",
        "verified": True,
        "totalMessages": total_messages,
        "lastMessage": last_message,
    }


@app.get("/official-ch/messages")
async def get_official_ch_messages(
    limit: int = 50, current_user: dict = Depends(get_current_user)
):
    """Get official channel messages with sender info"""
    msgs = (
        await cl_official_ch.find({})
        .sort("timestamp", -1)
        .limit(limit)
        .to_list(limit)
    )
    msgs.reverse()

    # Get unique sender IDs
    sender_ids = list(set(m.get("sender_id") for m in msgs if m.get("sender_id")))
    
    # Fetch sender info in one query
    senders = await cl_users.find({"chatId": {"$in": sender_ids}}).to_list(
        len(sender_ids) or 1
    )
    sender_by_id = {u["chatId"]: u for u in senders}

    result = []
    for m in msgs:
        sender_id = m.get("sender_id")
        sender = sender_by_id.get(sender_id)
        
        sender_info = None
        if sender:
            sender_info = {
                "chatId": sender["chatId"],
                "name": sender["profile"]["name"],
                "username": sender["profile"]["username"],
                "avatar": sender["profile"]["avatar"],
                "verified": bool(sender.get("verified", False)),
            }
        
        result.append({
            "id": str(m["_id"]),
            "senderId": sender_id,
            "senderInfo": sender_info,
            "text": m.get("text", ""),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
            "edited": bool(m.get("editedAt")),
            "reactions": aggregate_reactions(m.get("reactions", [])),
            "replyTo": m.get("replyTo"),
            "file": m.get("file"),
        })
    
    return result


@app.post("/official-ch/send")
async def send_official_ch_message(
    req: OfficialChSendRequest, current_user: dict = Depends(get_current_user)
):
    """Send message to official channel (verified users only)"""
    user_id = current_user["chatId"]
    
    # Check if user is verified
    if not current_user.get("verified", False):
        raise HTTPException(
            status_code=403, detail="Only verified users can send messages"
        )
    
    if not req.text.strip() and not req.file:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Handle reply
    reply_to = None
    if req.replyToId:
        oid = await try_object_id(req.replyToId)
        if oid:
            base = await cl_official_ch.find_one({"_id": oid})
            if base:
                reply_to = {
                    "id": str(base["_id"]),
                    "senderId": base.get("sender_id"),
                    "text": base.get("text", ""),
                }
    
    message_doc = {
        "sender_id": user_id,
        "text": req.text,
        "timestamp": utc_now(),
        "reactions": [],
        "replyTo": reply_to,
    }
    
    if req.file:
        message_doc["file"] = req.file
    
    result = await cl_official_ch.insert_one(message_doc)
    msg_id = str(result.inserted_id)
    
    # Get sender info for broadcast
    sender_info = {
        "chatId": user_id,
        "name": current_user["profile"]["name"],
        "username": current_user["profile"]["username"],
        "avatar": current_user["profile"]["avatar"],
        "verified": True,
    }
    
    # Broadcast to all connected users
    all_users = await cl_users.find({}).to_list(None)
    user_ids = [u["chatId"] for u in all_users]
    
    await broadcast(
        user_ids,
        {
            "type": "official_ch_message",
            "message": {
                "id": msg_id,
                "senderId": user_id,
                "senderInfo": sender_info,
                "text": req.text,
                "timestamp": dt_to_epoch_ms(message_doc["timestamp"]),
                "edited": False,
                "reactions": [],
                "replyTo": reply_to,
                "file": req.file,
            },
        },
    )
    
    return {"success": True, "messageId": msg_id}


@app.put("/official-ch/edit/{message_id}")
async def edit_official_ch_message(
    message_id: str,
    req: OfficialChEditRequest,
    current_user: dict = Depends(get_current_user),
):
    """Edit a message in official channel (only message sender)"""
    user_id = current_user["chatId"]
    
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")
    
    msg = await cl_official_ch.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Only sender can edit
    if msg.get("sender_id") != user_id:
        raise HTTPException(status_code=403, detail="Only sender can edit message")
    
    await cl_official_ch.update_one(
        {"_id": oid},
        {"$set": {"text": req.text, "editedAt": utc_now()}},
    )
    
    # Get sender info
    sender_info = {
        "chatId": user_id,
        "name": current_user["profile"]["name"],
        "username": current_user["profile"]["username"],
        "avatar": current_user["profile"]["avatar"],
        "verified": bool(current_user.get("verified", False)),
    }
    
    # Broadcast to all users
    all_users = await cl_users.find({}).to_list(None)
    user_ids = [u["chatId"] for u in all_users]
    
    await broadcast(
        user_ids,
        {
            "type": "official_ch_edited",
            "message": {
                "id": message_id,
                "senderId": user_id,
                "senderInfo": sender_info,
                "text": req.text,
                "timestamp": dt_to_epoch_ms(msg.get("timestamp")),
                "edited": True,
                "reactions": aggregate_reactions(msg.get("reactions", [])),
                "replyTo": msg.get("replyTo"),
                "file": msg.get("file"),
            },
        },
    )
    
    return {"success": True}


@app.delete("/official-ch/delete/{message_id}")
async def delete_official_ch_message(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete a message from official channel (any verified user)"""
    user_id = current_user["chatId"]
    
    # Check if user is verified
    if not current_user.get("verified", False):
        raise HTTPException(
            status_code=403, detail="Only verified users can delete messages"
        )
    
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")
    
    msg = await cl_official_ch.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Delete associated file if present
    file_data = msg.get("file")
    if file_data and file_data.get("fileId"):
        await delete_file(file_data["fileId"])
    
    await cl_official_ch.delete_one({"_id": oid})
    
    # Broadcast to all users
    all_users = await cl_users.find({}).to_list(None)
    user_ids = [u["chatId"] for u in all_users]
    
    await broadcast(
        user_ids,
        {
            "type": "official_ch_deleted",
            "messageId": message_id,
        },
    )
    
    return {"success": True}


@app.post("/official-ch/react/{message_id}")
async def react_official_ch_message(
    message_id: str,
    req: ReactionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add or toggle reaction on official channel message (all users)"""
    user_id = current_user["chatId"]
    emoji = req.emoji
    
    if emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail="Invalid emoji")
    
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")
    
    msg = await cl_official_ch.find_one({"_id": oid})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    reactions = msg.get("reactions", [])
    user_reaction = next((r for r in reactions if r.get("userId") == user_id), None)
    
    if user_reaction:
        if user_reaction.get("emoji") == emoji:
            reactions = [r for r in reactions if r.get("userId") != user_id]
        else:
            for r in reactions:
                if r.get("userId") == user_id:
                    r["emoji"] = emoji
    else:
        reactions.append({"userId": user_id, "emoji": emoji})
    
    await cl_official_ch.update_one({"_id": oid}, {"$set": {"reactions": reactions}})
    
    aggregated_reactions = aggregate_reactions(reactions)
    
    # Broadcast to all users
    all_users = await cl_users.find({}).to_list(None)
    user_ids = [u["chatId"] for u in all_users]
    
    await broadcast(
        user_ids,
        {
            "type": "official_ch_reaction",
            "messageId": message_id,
            "reactions": aggregated_reactions,
        },
    )
    
    return {"reactions": aggregated_reactions}


# ==================== END OFFICIAL CHANNEL ENDPOINTS ====================


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
        "login": {"email": req.email, "password": hashed_password, "token": None},
        "profile": {
            "name": req.name,
            "username": desired_username,
            "bio": "",
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

    # Update token in database
    await cl_users.update_one({"chatId": chat_id}, {"$set": {"login.token": token}})

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
        {"login.email": req.email}, {"$set": {"login.password": hashed_password}}
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

    await cl_users.update_one(
        {"chatId": user["chatId"]}, {"$set": {"login.token": token}}
    )

    return {
        "token": token,
        "user": {
            "chatId": user["chatId"],
            "username": user["profile"]["username"],
            "name": user["profile"]["name"],
            "bio": user["profile"]["bio"],
            "avatar": user["profile"]["avatar"],
            "online": user.get("online", False),
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
        update_data["profile.bio"] = updates.bio

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
    if q.startswith("@"):  # support telegram-like input
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
            "bio": u["profile"]["bio"],
            "online": u.get("online", False),
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
async def create_group(req: GroupCreateRequest, current_user: dict = Depends(get_current_user)):
    name = (req.name or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Group name must be at least 3 characters")
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
async def join_group(req: GroupJoinRequest, current_user: dict = Depends(get_current_user)):
    invite_code = normalize_group_invite_code(req.inviteCode)
    if not invite_code:
        raise HTTPException(status_code=400, detail="Invite code is required")

    group_chat = await cl_chats.find_one({"inviteCode": invite_code, "chatType": "group"})
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


@app.get("/chats")
async def get_chat_list(current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]
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
        other_id = next((pid for pid in chat.get("participants", []) if pid != my_id), None)
        other_user = user_by_id.get(other_id) if (other_id and not is_group) else None

        last_msg = chat.get("lastMessage")
        if isinstance(last_msg, dict) and last_msg.get("timestamp") is not None:
            last_msg = {
                **last_msg,
                "timestamp": dt_to_epoch_ms(last_msg.get("timestamp")),
            }

        result.append(
            {
                "id": chat["_id"],
                "participantIds": chat.get("participants", []),
                "chatType": "group" if is_group else "direct",
                "otherUser": {
                    "chatId": (chat["_id"] if is_group else (other_user.get("chatId") if other_user else (other_id or ""))),
                    "name": (chat.get("groupName") or "گروه") if is_group else (other_user["profile"]["name"] if other_user else "Unknown"),
                    "avatar": (chat.get("groupAvatar") or "") if is_group else (other_user["profile"]["avatar"] if other_user else ""),
                    "username": (f"group_{chat['_id']}") if is_group else (other_user["profile"]["username"] if other_user else (other_id or "")),
                    "bio": ("گروه" if is_group else (other_user["profile"]["bio"] if other_user else "")),
                    "online": False if is_group else (other_user.get("online", False) if other_user else False),
                    "verified": False if is_group else (bool(other_user.get("verified", False)) if other_user else False),
                    "registrationDate": None if is_group else (other_user.get("registrationDate") if other_user else None),
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
                "text": doc.get("text", ""),
                "senderId": doc.get("senderId"),
                "timestamp": dt_to_epoch_ms(doc.get("timestamp")),
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

    # Delete associated files
    messages = await cl_messages.find({"chatId": chat_id}).to_list(None)
    for msg in messages:
        file_data = msg.get("file")
        if file_data and file_data.get("fileId"):
            await delete_file(file_data["fileId"])

    await cl_messages.delete_many({"chatId": chat_id})
    await cl_chats.delete_one({"_id": chat_id})
    return {"message": "Chat deleted"}


@app.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)
):
    current_user_id = current_user["chatId"]

    # Check if this is saved messages
    saved_chat_id = get_saved_messages_id(current_user_id)
    if chat_id == saved_chat_id:
        # For saved messages, don't mark as seen (no seenBy logic needed)
        msgs = (
            await cl_messages.find({"chatId": chat_id})
            .sort("timestamp", -1)
            .limit(limit)
            .to_list(limit)
        )
        msgs.reverse()

        return [
            {
                "id": str(m["_id"]),
                "chatId": m["chatId"],
                "senderId": m["senderId"],
                "text": m.get("text", ""),
                "timestamp": dt_to_epoch_ms(m.get("timestamp")),
                "seen": True,
                "replyTo": m.get("replyTo"),
                "edited": bool(m.get("editedAt")),
                "reactions": aggregate_reactions(m.get("reactions", [])),
                "forwardedFrom": m.get("forwardedFrom"),
                "file": m.get("file"),
            }
            for m in msgs
        ]

    chat_doc = await cl_chats.find_one({"_id": chat_id}, {"participants": 1})
    participants: List[str] = chat_doc.get("participants", []) if chat_doc else []
    if current_user_id not in participants:
        raise HTTPException(status_code=403, detail="Not allowed")

    # Mark messages as seen by the current user.
    await cl_messages.update_many(
        {"chatId": chat_id, "seenBy": {"$ne": current_user_id}},
        {"$addToSet": {"seenBy": current_user_id}},
    )

    msgs = (
        await cl_messages.find({"chatId": chat_id})
        .sort("timestamp", -1)
        .limit(limit)
        .to_list(limit)
    )
    msgs.reverse()

    def compute_seen(m: dict) -> bool:
        seen_by = m.get("seenBy", []) or []
        sender_id = m.get("senderId")

        # For my outgoing messages, "seen" should mean the other participant(s) saw it,
        # not that I (the sender) saw my own message.
        if sender_id == current_user_id:
            if not participants:
                return False
            return all(p in seen_by for p in participants)

        # For incoming messages (only used by UI as theirs), keep it consistent.
        return current_user_id in seen_by

    return [
        {
            "id": str(m["_id"]),
            "chatId": m["chatId"],
            "senderId": m["senderId"],
            "text": m.get("text", ""),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
            "seen": compute_seen(m),
            "replyTo": m.get("replyTo"),
            "edited": bool(m.get("editedAt")),
            "reactions": aggregate_reactions(m.get("reactions", [])),
            "forwardedFrom": m.get("forwardedFrom"),
            "file": m.get("file"),
        }
        for m in msgs
    ]


# File upload endpoint
@app.post("/files/upload")
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a file (max 3MB)"""
    # Read file content
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
    """Download a file"""
    # Validate file exists
    if not validate_file_access(file_id):
        raise HTTPException(status_code=404, detail="File not found")

    # Get file path
    file_path = get_file_path(file_id)

    # Return file
    return FileResponse(
        path=str(file_path), filename=file_id, media_type="application/octet-stream"
    )


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
    """Forward a message to another chat (supports regular, AI, and official channel messages)"""
    user_id = current_user["chatId"]
    message_id = req.messageId
    target_chat_id = req.targetChatId

    # Get original message - check all collections
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    # Try to find in regular messages first
    original_msg = await cl_messages.find_one({"_id": oid})
    is_ai_message = False
    is_official_ch = False

    # If not found, try AI messages
    if not original_msg:
        original_msg = await cl_ai_messages.find_one({"_id": oid})
        is_ai_message = True

    # If still not found, try official channel
    if not original_msg:
        original_msg = await cl_official_ch.find_one({"_id": oid})
        is_official_ch = True

    if not original_msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check if user has access to the original message
    if is_ai_message:
        # For AI messages, check if it belongs to the user
        if original_msg.get("userId") != user_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    elif is_official_ch:
        # All users can forward from official channel
        pass
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
    is_target_official_ch = target_chat_id == OFFICIAL_CH_ID

    if is_target_official_ch:
        raise HTTPException(
            status_code=403, detail="Cannot forward messages to official channel"
        )

    if not is_target_saved:
        target_chat = await cl_chats.find_one({"_id": target_chat_id})
        if not target_chat:
            raise HTTPException(status_code=404, detail="Target chat not found")

        target_participants = target_chat.get("participants", [])
        if user_id not in target_participants:
            raise HTTPException(
                status_code=403, detail="Not authorized to send to this chat"
            )

    # Get original sender info and file data
    file_data = None
    if is_ai_message:
        # For AI messages, the sender is AI
        forwarded_from_info = {
            "originalSenderId": "ai",
            "name": "NovaRoom AI",
            "username": "novaroom_ai",
        }
        message_text = original_msg.get("content", "")
    elif is_official_ch:
        # For official channel messages
        original_sender_id = original_msg.get("sender_id")
        original_sender = await cl_users.find_one({"chatId": original_sender_id})
        
        forwarded_from_info = {
            "originalSenderId": original_sender_id,
            "name": (
                original_sender["profile"]["name"] if original_sender else "Unknown"
            ),
            "username": (
                original_sender["profile"]["username"] if original_sender else ""
            ),
            "fromChannel": "کانال رسمی نوا روم",
        }
        message_text = original_msg.get("text", "")
        file_data = original_msg.get("file")
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
        message_text = original_msg.get("text", "")
        file_data = original_msg.get("file")

    # Create forwarded message
    forwarded_msg = {
        "chatId": target_chat_id,
        "senderId": user_id,
        "text": message_text,
        "timestamp": utc_now(),
        "seenBy": [user_id],
        "replyTo": None,  # Forwarded messages don't preserve replies
        "reactions": [],
        "forwardedFrom": forwarded_from_info,
    }

    # Add file data if present
    if file_data:
        forwarded_msg["file"] = file_data

    result = await cl_messages.insert_one(forwarded_msg)
    msg_id = str(result.inserted_id)

    last_msg = {
        "id": msg_id,
        "text": forwarded_msg["text"],
        "senderId": user_id,
        "timestamp": forwarded_msg["timestamp"],
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
                "text": forwarded_msg["text"],
                "timestamp": dt_to_epoch_ms(forwarded_msg["timestamp"]),
                "seen": False,
                "replyTo": None,
                "edited": False,
                "reactions": [],
                "forwardedFrom": forwarded_from_info,
                "file": file_data,
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


async def try_object_id(value: Any) -> Optional[ObjectId]:
    try:
        if not value or not isinstance(value, str):
            return None
        return ObjectId(value)
    except Exception:
        return None


async def build_last_message(chat_id: str) -> Optional[dict]:
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
        "text": doc.get("text", ""),
        "senderId": doc.get("senderId"),
        "timestamp": doc.get("timestamp"),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()
    chat_id: Optional[str] = None

    try:
        try:
            payload = await jwt_decode_async(token)
            chat_id = payload.get("chatId")
        except Exception:
            await websocket.close(code=1008)
            return

        if not chat_id:
            await websocket.close(code=1008)
            return

        user = await cl_users.find_one({"chatId": chat_id})
        if not user:
            await websocket.close(code=1008)
            return

        is_first_connection = not active_connections.get(chat_id)
        active_connections.setdefault(chat_id, []).append(websocket)

        if is_first_connection:
            await cl_users.update_one({"chatId": chat_id}, {"$set": {"online": True}})

            # Notify contacts (only on first active connection)
            user_chats = await cl_chats.find({"participants": chat_id}).to_list(None)
            contacts_to_notify = set()
            for chat in user_chats:
                for p in chat.get("participants", []):
                    if p != chat_id:
                        contacts_to_notify.add(p)

            await broadcast(
                contacts_to_notify,
                {"type": "user_status", "userId": chat_id, "online": True},
            )

        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                continue

            if data.get("type") == "message":
                chat_id_target = data.get("chatId")
                text = data.get("text", "")
                reply_to_id = data.get("replyToId")
                file_data = data.get("file")  # File metadata from upload endpoint

                # Allow empty text if file is present
                if not chat_id_target or (not text.strip() and not file_data):
                    continue

                # Check if this is saved messages
                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id

                if not is_saved:
                    chat_doc = await cl_chats.find_one({"_id": chat_id_target}, {"participants": 1})
                    participants = chat_doc.get("participants", []) if chat_doc else []
                    if chat_id not in participants:
                        continue

                reply_to = None
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
                                "text": base.get("text", ""),
                            }

                message_doc = {
                    "chatId": chat_id_target,
                    "senderId": chat_id,
                    "text": text,
                    "timestamp": utc_now(),
                    "seenBy": [chat_id],
                    "replyTo": reply_to,
                    "reactions": [],
                }

                # Add file data if present
                if file_data:
                    message_doc["file"] = file_data

                result = await cl_messages.insert_one(message_doc)
                msg_id = str(result.inserted_id)

                last_msg = {
                    "id": msg_id,
                    "text": text if text else "[File]",
                    "senderId": chat_id,
                    "timestamp": message_doc["timestamp"],
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

                oid = await try_object_id(message_id)
                if not oid:
                    continue

                msg = await cl_messages.find_one({"_id": oid, "chatId": chat_id_target})
                if not msg or msg.get("senderId") != chat_id:
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                if not is_saved:
                    chat_doc = await cl_chats.find_one({"_id": chat_id_target}, {"participants": 1})
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                await cl_messages.update_one(
                    {"_id": oid},
                    {"$set": {"text": new_text, "editedAt": utc_now()}},
                )

                # Update lastMessage text if it points to this message.
                if not is_saved:
                    await cl_chats.update_one(
                        {"_id": chat_id_target, "lastMessage.id": message_id},
                        {
                            "$set": {
                                "lastMessage.text": new_text,
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
                        "replyTo": msg.get("replyTo"),
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
                if not msg or msg.get("senderId") != chat_id:
                    continue

                saved_chat_id = get_saved_messages_id(chat_id)
                is_saved = chat_id_target == saved_chat_id
                if not is_saved:
                    chat_doc = await cl_chats.find_one({"_id": chat_id_target}, {"participants": 1})
                    if not chat_doc or chat_id not in chat_doc.get("participants", []):
                        continue

                # Delete associated file if present
                file_data = msg.get("file")
                if file_data and file_data.get("fileId"):
                    await delete_file(file_data["fileId"])

                await cl_messages.delete_one({"_id": oid})

                # Rebuild lastMessage if needed.
                last_msg = None
                if not is_saved:
                    last_msg = await build_last_message(chat_id_target)
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

            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        print(f"WebSocket Error for {chat_id}: {traceback.format_exc()}")
    finally:
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

                await broadcast(
                    contacts_to_notify,
                    {"type": "user_status", "userId": chat_id, "online": False},
                )


@app.websocket("/ws/ai")
async def websocket_ai_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()
    user_id: Optional[str] = None

    try:
        try:
            payload = await jwt_decode_async(token)
            user_id = payload.get("chatId")
        except Exception:
            await websocket.close(code=1008)
            return

        if not user_id:
            await websocket.close(code=1008)
            return

        user = await cl_users.find_one({"chatId": user_id})
        if not user:
            await websocket.close(code=1008)
            return

        user_name = user.get("profile", {}).get("name", "")

        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                continue

            if data.get("type") == "ai_message":
                text = data.get("text")

                if not isinstance(text, str) or not text.strip():
                    continue

                # Save user message
                user_message_doc = {
                    "userId": user_id,
                    "role": "user",
                    "content": text,
                    "timestamp": utc_now(),
                }
                await cl_ai_messages.insert_one(user_message_doc)

                # Get conversation history (last 20 messages)
                history_docs = (
                    await cl_ai_messages.find({"userId": user_id})
                    .sort("timestamp", -1)
                    .limit(20)
                    .to_list(20)
                )
                history_docs.reverse()

                # Prepare messages for AI
                messages = [
                    {"role": doc["role"], "content": doc["content"]}
                    for doc in history_docs
                ]

                # Generate AI response
                ai_response = await generate_ai_response(messages, user_name)

                # Save AI response
                ai_message_doc = {
                    "userId": user_id,
                    "role": "assistant",
                    "content": ai_response,
                    "timestamp": utc_now(),
                }
                result = await cl_ai_messages.insert_one(ai_message_doc)
                ai_msg_id = str(result.inserted_id)

                # Send response back to user
                await websocket.send_json(
                    {
                        "type": "ai_response",
                        "message": {
                            "id": ai_msg_id,
                            "senderId": "ai",
                            "text": ai_response,
                            "timestamp": dt_to_epoch_ms(ai_message_doc["timestamp"]),
                        },
                    }
                )

            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        print(f"AI WebSocket Error for {user_id}: {traceback.format_exc()}")


@app.get("/ai/messages")
async def get_ai_messages(
    limit: int = 50, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["chatId"]

    msgs = (
        await cl_ai_messages.find({"userId": user_id})
        .sort("timestamp", -1)
        .limit(limit)
        .to_list(limit)
    )
    msgs.reverse()

    return [
        {
            "id": str(m["_id"]),
            "senderId": "ai" if m["role"] == "assistant" else user_id,
            "text": m.get("content", ""),
            "timestamp": dt_to_epoch_ms(m.get("timestamp")),
        }
        for m in msgs
    ]


@app.delete("/ai/messages/{message_id}")
async def delete_ai_message(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete an AI chat message"""
    user_id = current_user["chatId"]

    # Convert message_id to ObjectId
    oid = await try_object_id(message_id)
    if not oid:
        raise HTTPException(status_code=400, detail="Invalid message ID")

    # Find the message
    msg = await cl_ai_messages.find_one({"_id": oid, "userId": user_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Delete the message
    await cl_ai_messages.delete_one({"_id": oid})

    return {"success": True, "message": "Message deleted successfully"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
