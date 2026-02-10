from fastapi import (
    FastAPI,
    WebSocket,
    Depends,
    HTTPException,
    Query,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from datetime import datetime, timedelta
import jwt
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from typing import List, Dict, Optional

load_dotenv()

# ====================== CONFIG ======================
app = FastAPI(title="QuickChat API")

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client["Messenger"]

cl_users = db["users"]
cl_chats = db["chats"]
cl_messages = db["messages"]

active_connections: Dict[str, WebSocket] = {}

security = HTTPBearer()


# ====================== MODELS ======================
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


class UserSearchResult(BaseModel):
    chatId: str
    username: str
    name: str
    avatar: str
    bio: str
    online: bool


class ChatCreateRequest(BaseModel):
    targetChatId: str


# ====================== HELPERS ======================
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    try:
        payload = jwt.decode(
            credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM]
        )
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


# ====================== STARTUP ======================
@app.on_event("startup")
async def startup_db():
    await cl_users.create_index("chatId", unique=True)
    await cl_users.create_index("login.email", unique=True)
    await cl_users.create_index("profile.username", unique=True)
    await cl_chats.create_index([("participants", 1)])
    await cl_chats.create_index([("updatedAt", -1)])
    await cl_messages.create_index("chatId")
    await cl_messages.create_index([("chatId", 1), ("timestamp", -1)])


# ====================== AUTH ======================
@app.post("/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = await cl_users.find_one({"login.email": req.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    stored_hash = user.get("login", {}).get("password")
    if not stored_hash or not isinstance(stored_hash, str):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not bcrypt.checkpw(req.password.encode("utf-8"), stored_hash.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"chatId": user["chatId"]})

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
        },
    }


# ====================== PROFILE ======================
@app.get("/profile/me")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return {
        "chatId": current_user["chatId"],
        "username": current_user["profile"]["username"],
        "name": current_user["profile"]["name"],
        "bio": current_user["profile"]["bio"],
        "avatar": current_user["profile"]["avatar"],
        "online": current_user.get("online", False),
    }


@app.patch("/profile/me")
async def update_profile(
    updates: ProfileUpdate, current_user: dict = Depends(get_current_user)
):
    update_data = {}
    if updates.name:
        update_data["profile.name"] = updates.name
    if updates.username:
        update_data["profile.username"] = updates.username
    if updates.bio is not None:
        update_data["profile.bio"] = updates.bio

    if update_data:
        await cl_users.update_one(
            {"chatId": current_user["chatId"]}, {"$set": update_data}
        )

    return {"message": "Profile updated"}


# ====================== USER SEARCH ======================
@app.get("/users/search", response_model=List[UserSearchResult])
async def search_users(
    query: str = Query(..., min_length=2),
    current_user: dict = Depends(get_current_user),
):
    users = (
        await cl_users.find(
            {
                "$or": [
                    {"profile.username": {"$regex": query, "$options": "i"}},
                    {"profile.name": {"$regex": query, "$options": "i"}},
                ],
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
        }
        for u in users
    ]


# ====================== CHATS ======================
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

    new_chat = {
        "_id": chat_id,
        "participants": sorted([my_id, target_id]),
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "lastMessage": None,
    }
    await cl_chats.insert_one(new_chat)
    return {"chatId": chat_id, "participants": new_chat["participants"]}


@app.get("/chats")
async def get_chat_list(current_user: dict = Depends(get_current_user)):
    my_id = current_user["chatId"]
    chats = (
        await cl_chats.find({"participants": my_id}).sort("updatedAt", -1).to_list(50)
    )

    result = []
    for chat in chats:
        unread = await cl_messages.count_documents(
            {
                "chatId": chat["_id"],
                "senderId": {"$ne": my_id},
                "seenBy": {"$ne": my_id},
            }
        )
        result.append(
            {
                "id": chat["_id"],
                "participantIds": chat["participants"],
                "lastMessage": chat.get("lastMessage"),
                "unreadCount": unread,
            }
        )
    return result


# ====================== MESSAGES ======================
@app.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)
):
    # Mark messages as seen
    await cl_messages.update_many(
        {"chatId": chat_id, "seenBy": {"$ne": current_user["chatId"]}},
        {"$push": {"seenBy": current_user["chatId"]}},
    )

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
            "text": m["text"],
            "timestamp": int(m["timestamp"].timestamp() * 1000),
            "seen": current_user["chatId"] in m.get("seenBy", []),
        }
        for m in msgs
    ]


# ====================== WEBSOCKET ======================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()

    chat_id: Optional[str] = None

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        chat_id = payload.get("chatId")
        if not chat_id:
            await websocket.close()
            return

        user = await cl_users.find_one({"chatId": chat_id})
        if not user:
            await websocket.close()
            return

        active_connections[chat_id] = websocket

        while True:
            data = await websocket.receive_json()

            if data.get("type") == "message":
                chat_id_target = data["chatId"]
                text = data["text"]

                message_doc = {
                    "chatId": chat_id_target,
                    "senderId": chat_id,
                    "text": text,
                    "timestamp": datetime.utcnow(),
                    "seenBy": [chat_id],
                }
                result = await cl_messages.insert_one(message_doc)
                msg_id = str(result.inserted_id)

                last_msg = {
                    "text": text,
                    "senderId": chat_id,
                    "timestamp": message_doc["timestamp"],
                }
                await cl_chats.update_one(
                    {"_id": chat_id_target},
                    {"$set": {"lastMessage": last_msg, "updatedAt": datetime.utcnow()}},
                )

                # Broadcast to other participant
                participants = await cl_chats.find_one(
                    {"_id": chat_id_target}, {"participants": 1}
                )
                if participants:
                    for p in participants["participants"]:
                        if p != chat_id and p in active_connections:
                            try:
                                await active_connections[p].send_json(
                                    {
                                        "type": "new_message",
                                        "chatId": chat_id_target,
                                        "message": {
                                            "id": msg_id,
                                            "chatId": chat_id_target,
                                            "senderId": chat_id,
                                            "text": text,
                                            "timestamp": int(
                                                message_doc["timestamp"].timestamp()
                                                * 1000
                                            ),
                                            "seen": False,
                                        },
                                    }
                                )
                            except:
                                pass
    except Exception:
        pass
    finally:
        if chat_id and chat_id in active_connections:
            del active_connections[chat_id]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
