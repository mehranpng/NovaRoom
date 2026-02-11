from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Depends,
    HTTPException,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from datetime import datetime, timedelta
import jwt
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from typing import List, Dict, Optional
import traceback
import asyncio

load_dotenv()

app = FastAPI(title="NovaRoom API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client["Messenger"]
cl_users = db["users"]
cl_chats = db["chats"]
cl_messages = db["messages"]

# Store active connections
active_connections: Dict[str, List[WebSocket]] = {}

security = HTTPBearer()


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


@app.on_event("startup")
async def startup_db():
    await cl_users.create_index("chatId", unique=True)
    await cl_users.create_index("login.email", unique=True)
    await cl_users.create_index("profile.username", unique=True)
    await cl_chats.create_index([("participants", 1)])
    await cl_chats.create_index([("updatedAt", -1)])
    await cl_messages.create_index("chatId")
    await cl_messages.create_index([("chatId", 1), ("timestamp", -1)])


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
        other_id = next((pid for pid in chat["participants"] if pid != my_id), None)
        other_user = await cl_users.find_one({"chatId": other_id})

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
                "otherUser": {
                    "name": other_user["profile"]["name"] if other_user else "Unknown",
                    "avatar": other_user["profile"]["avatar"] if other_user else "",
                    "username": (
                        other_user["profile"]["username"] if other_user else other_id
                    ),
                    "online": other_user.get("online", False) if other_user else False,
                },
                "lastMessage": chat.get("lastMessage"),
                "unreadCount": unread,
            }
        )
    return result


@app.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)
):
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

# Helper to remove dead connections safely
async def safe_send(user_id: str, message: dict):
    if user_id not in active_connections:
        return
    
    dead_connections = []
    for ws in active_connections[user_id]:
        try:
            await ws.send_json(message)
        except Exception:
            dead_connections.append(ws)
    
    # Clean up dead connections
    for dead_ws in dead_connections:
        if dead_ws in active_connections[user_id]:
            active_connections[user_id].remove(dead_ws)
            
    if not active_connections[user_id]:
        del active_connections[user_id]


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    await websocket.accept()
    chat_id: Optional[str] = None
    try:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            chat_id = payload.get("chatId")
        except:
            await websocket.close(code=1008)
            return

        if not chat_id:
            await websocket.close(code=1008)
            return

        user = await cl_users.find_one({"chatId": chat_id})
        if not user:
            await websocket.close(code=1008)
            return

        if chat_id not in active_connections:
            active_connections[chat_id] = []
        active_connections[chat_id].append(websocket)

        await cl_users.update_one({"chatId": chat_id}, {"$set": {"online": True}})

        # Notify contacts
        user_chats = await cl_chats.find({"participants": chat_id}).to_list(None)
        contacts_to_notify = set()
        for chat in user_chats:
            for p in chat["participants"]:
                if p != chat_id:
                    contacts_to_notify.add(p)

        for p in contacts_to_notify:
            await safe_send(p, {"type": "user_status", "userId": chat_id, "online": True})

        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "message":
                chat_id_target = data["chatId"]
                text = data["text"]

                print(f"Received message from {chat_id} to {chat_id_target}: {text}")

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

                participants = await cl_chats.find_one(
                    {"_id": chat_id_target}, {"participants": 1}
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
                            "timestamp": int(message_doc["timestamp"].timestamp() * 1000),
                            "seen": False,
                        },
                    }
                    
                    for p in participants["participants"]:
                        await safe_send(p, msg_payload)

            elif data.get("type") == "seen":
                chat_id_target = data.get("chatId")
                if chat_id_target:
                    await cl_messages.update_many(
                        {"chatId": chat_id_target, "seenBy": {"$ne": chat_id}},
                        {"$push": {"seenBy": chat_id}},
                    )
                    
                    chat_doc = await cl_chats.find_one({"_id": chat_id_target})
                    if chat_doc:
                        for p in chat_doc["participants"]:
                            if p != chat_id:
                                await safe_send(p, {
                                    "type": "messages_seen",
                                    "chatId": chat_id_target,
                                    "byUserId": chat_id,
                                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket Error for {chat_id}: {traceback.format_exc()}")
    finally:
        if chat_id and chat_id in active_connections:
            if websocket in active_connections[chat_id]:
                active_connections[chat_id].remove(websocket)
            
            if not active_connections[chat_id]:
                del active_connections[chat_id]
                await cl_users.update_one({"chatId": chat_id}, {"$set": {"online": False}})

                # Notify contacts of offline status
                user_chats = await cl_chats.find({"participants": chat_id}).to_list(None)
                contacts_to_notify = set()
                for chat in user_chats:
                    for p in chat["participants"]:
                        if p != chat_id:
                            contacts_to_notify.add(p)

                for p in contacts_to_notify:
                    await safe_send(p, {"type": "user_status", "userId": chat_id, "online": False})

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
