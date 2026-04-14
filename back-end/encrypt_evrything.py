"""
One-time migration tool to encrypt legacy plaintext records/files.

Usage:
    python back-end/encrypt_evrything.py
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path
from typing import Any, Dict

import aiofiles
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_DB = os.getenv("MONGO_DB")
if not MONGO_DB:
    raise RuntimeError("MONGO_DB is not set in environment/.env")

RAW_SECRET = os.getenv("SECRET_KEY", "") or "dev-secret-change-me"
if len(RAW_SECRET.encode("utf-8")) < 32:
    SECRET_KEY = hashlib.sha256(RAW_SECRET.encode("utf-8")).hexdigest()
else:
    SECRET_KEY = RAW_SECRET

ENC_PREFIX = "enc:v1:"
ENC_NONCE_SIZE = 16
ENC_TAG_SIZE = 16

UPLOAD_DIR = Path("uploads")
FILE_MAGIC = b"NRF1"
FILE_NONCE_SIZE = 16
FILE_TAG_SIZE = 16


def is_ciphertext(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


def _derive_enc_key(scope: str) -> bytes:
    material = f"{SECRET_KEY}|{scope}".encode("utf-8")
    return hashlib.sha256(material).digest()


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


def encrypt_scoped_text(plain: Any, scope: str) -> str:
    text = str(plain or "")
    if not text:
        return ""
    if is_ciphertext(text):
        return text
    key = _derive_enc_key(scope)
    nonce = secrets.token_bytes(ENC_NONCE_SIZE)
    encrypted = _xor_stream(text.encode("utf-8"), key, nonce)
    tag = hmac.new(key, nonce + encrypted, hashlib.sha256).digest()[:ENC_TAG_SIZE]
    payload = base64.urlsafe_b64encode(nonce + encrypted + tag).decode("ascii")
    return f"{ENC_PREFIX}{payload}"


def _file_key() -> bytes:
    return hashlib.sha256(f"{RAW_SECRET}|file-storage".encode("utf-8")).digest()


def encrypt_file_bytes(plain: bytes) -> bytes:
    if plain.startswith(FILE_MAGIC):
        return plain
    key = _file_key()
    nonce = secrets.token_bytes(FILE_NONCE_SIZE)
    cipher = _xor_stream(plain, key, nonce)
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:FILE_TAG_SIZE]
    return FILE_MAGIC + nonce + cipher + tag


def user_bio_scope(chat_id: str) -> str:
    return f"user-bio:{chat_id}"


async def encrypt_users(cl_users) -> int:
    converted = 0
    async for u in cl_users.find({"profile.bio": {"$exists": True}}):
        chat_id = str(u.get("chatId") or "")
        if not chat_id:
            continue
        profile = u.get("profile") or {}
        bio = str(profile.get("bio") or "")
        if not bio or is_ciphertext(bio):
            continue
        await cl_users.update_one(
            {"_id": u["_id"]},
            {
                "$set": {
                    "profile.bio": encrypt_scoped_text(bio, user_bio_scope(chat_id)),
                    "profile.bioEncrypted": True,
                }
            },
        )
        converted += 1
    return converted


async def encrypt_messages(cl_messages) -> int:
    converted = 0
    async for m in cl_messages.find({}):
        chat_scope = f"chat:{m.get('chatId', '')}"
        updates: Dict[str, Any] = {}

        txt = str(m.get("text") or "")
        if txt and not is_ciphertext(txt):
            updates["text"] = encrypt_scoped_text(txt, chat_scope)

        reply = m.get("replyTo")
        if isinstance(reply, dict):
            r_txt = str(reply.get("text") or "")
            if r_txt and not is_ciphertext(r_txt):
                updates["replyTo"] = {
                    **reply,
                    "text": encrypt_scoped_text(r_txt, chat_scope),
                }

        reasoning = str(m.get("reasoningContent") or "")
        if reasoning and not is_ciphertext(reasoning):
            updates["reasoningContent"] = encrypt_scoped_text(reasoning, chat_scope)

        if updates:
            updates["textEncrypted"] = True
            await cl_messages.update_one({"_id": m["_id"]}, {"$set": updates})
            converted += 1
    return converted


async def encrypt_chat_last_messages(cl_chats) -> int:
    converted = 0
    async for c in cl_chats.find({"lastMessage.text": {"$exists": True}}):
        last_message = c.get("lastMessage") or {}
        text = str(last_message.get("text") or "")
        if not text or text == "[File]" or is_ciphertext(text):
            continue
        chat_id = str(c.get("_id") or "")
        enc_text = encrypt_scoped_text(text, f"chat:{chat_id}")
        await cl_chats.update_one(
            {"_id": c["_id"]},
            {"$set": {"lastMessage.text": enc_text}},
        )
        converted += 1
    return converted


async def encrypt_ai_messages(cl_ai_messages) -> int:
    converted = 0
    async for m in cl_ai_messages.find({}):
        ai_scope = f"ai:{m.get('aiChatId', '')}"
        updates: Dict[str, Any] = {}

        content = str(m.get("content") or "")
        if content and not is_ciphertext(content):
            updates["content"] = encrypt_scoped_text(content, ai_scope)

        reasoning = str(m.get("reasoningContent") or "")
        if reasoning and not is_ciphertext(reasoning):
            updates["reasoningContent"] = encrypt_scoped_text(reasoning, ai_scope)

        if updates:
            updates["contentEncrypted"] = True
            await cl_ai_messages.update_one({"_id": m["_id"]}, {"$set": updates})
            converted += 1
    return converted


async def encrypt_ai_chats(cl_ai_chats) -> int:
    converted = 0
    async for c in cl_ai_chats.find({}):
        scope = f"ai-chat-meta:{c.get('_id')}"
        updates: Dict[str, Any] = {}

        title = str(c.get("title") or "")
        if title and not is_ciphertext(title):
            updates["title"] = encrypt_scoped_text(title, scope)

        summary = str(c.get("summary") or "")
        if summary and not is_ciphertext(summary):
            updates["summary"] = encrypt_scoped_text(summary, scope)

        if updates:
            updates["titleEncrypted"] = True
            updates["summaryEncrypted"] = True
            await cl_ai_chats.update_one({"_id": c["_id"]}, {"$set": updates})
            converted += 1
    return converted


async def encrypt_files() -> int:
    if not UPLOAD_DIR.exists():
        return 0

    converted = 0
    for file_path in UPLOAD_DIR.iterdir():
        if not file_path.is_file():
            continue
        async with aiofiles.open(file_path, "rb") as f:
            raw = await f.read()
        if raw.startswith(FILE_MAGIC):
            continue
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(encrypt_file_bytes(raw))
        converted += 1
    return converted


async def main():
    client = AsyncIOMotorClient(MONGO_DB)
    db = client["Messenger"]

    cl_users = db["users"]
    cl_chats = db["chats"]
    cl_messages = db["messages"]
    cl_ai_messages = db["ai_messages"]
    cl_ai_chats = db["ai_chats"]

    users_count = await encrypt_users(cl_users)
    messages_count = await encrypt_messages(cl_messages)
    chats_last_count = await encrypt_chat_last_messages(cl_chats)
    ai_messages_count = await encrypt_ai_messages(cl_ai_messages)
    ai_chats_count = await encrypt_ai_chats(cl_ai_chats)
    files_count = await encrypt_files()

    print("Encryption migration completed:")
    print(f"- users.profile.bio: {users_count}")
    print(f"- messages (text/reply/reasoning): {messages_count}")
    print(f"- chats.lastMessage.text: {chats_last_count}")
    print(f"- ai_messages (content/reasoning): {ai_messages_count}")
    print(f"- ai_chats (title/summary): {ai_chats_count}")
    print(f"- files: {files_count}")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
