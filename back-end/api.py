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

# Store active connections (multiple tabs/devices per user)
active_connections: Dict[str, List[WebSocket]] = {}

security = HTTPBearer()

# Valid emojis for reactions
VALID_REACTIONS = ["👍", "👎", "🤣", "😢", "❤️", "💔", "😐"]

# Pin settings
MAX_PINNED_CHATS = 20

# Official channel ID


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


def _get_pinned_from_user_doc(user: dict) -> List[str]:
    ids = (((user or {}).get("settings") or {}).get("pinnedChatIds") or [])
    if not isinstance(ids, list):
        return []
    # keep as strings, unique, and cap
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


def _user_can_pin_chat(user_id: str, chat_id: str) -> bool:
    # Prevent pinning AI pseudo chat (not in chats collection) by requiring it to be either a real chat or saved messages.
    if chat_id == get_saved_messages_id(user_id):
        return True
    # Real chat ids start with chat_ or grp_ in this project.
    return isinstance(chat_id, str) and (chat_id.startswith("chat_") or chat_id.startswith("grp_"))


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
        {"$set": {"settings.pinnedChatIds": pinned, "settings.pinnedUpdatedAt": utc_now()}},
    )

    # Return fresh
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
        {"$set": {"settings.pinnedChatIds": pinned, "settings.pinnedUpdatedAt": utc_now()}},
    )

    user = await cl_users.find_one({"chatId": user_id}, {"settings": 1})
    return {"pinnedChatIds": _get_pinned_from_user_doc(user or {})}






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
        raise HTTPException(status_code=400, detail="Invalid or expired reset code"
        )

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
    if not bool(current_user.get("verified", False)):
        raise HTTPException(status_code=403, detail="Only verified users can create groups")

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
    invite_code = (req.inviteCode or "").strip()
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
            file_data = msg.get("file")
            if file_data and file_data.get("fileId"):
                await delete_file(file_data["fileId"])

        await cl_messages.delete_many({"chatId": chat_id})
        await cl_chats.delete_one({"_id": chat_id})
        return {"message": "Group deleted (no members left)"}

    return {"message": "Left group"}


@app.put("/groups/{chat_id}")
async def update_group(chat_id: str, req: GroupUpdateRequest, current_user: dict = Depends(get_current_user)):
    if not bool(current_user.get("verified", False)):
        raise HTTPException(status_code=403, detail="Only verified users can update groups")

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
            raise HTTPException(status_code=400, detail="Group name must be at least 3 characters")
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
                    "username": build_group_invite_link(chat.get("inviteCode", "")) if is_group else (other_user["profile"]["username"] if other_user else (other_id or "")),
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


# (rest of file unchanged)
