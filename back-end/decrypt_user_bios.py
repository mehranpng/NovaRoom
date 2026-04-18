#!/usr/bin/env python3
"""
Decrypt all encrypted user bios and persist them as plain text.

Usage:
  python decrypt_user_bios.py
  python decrypt_user_bios.py --dry-run
"""

import argparse
import asyncio
import base64
import hashlib
import hmac
import os
from typing import Any

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


ENC_PREFIX = "enc:v1:"
ENC_NONCE_SIZE = 16
ENC_TAG_SIZE = 16
LEGACY_BOOTSTRAP_TOKEN = "__bootstrap_migration__"


def derive_secret_key() -> str:
    raw = os.getenv("SECRET_KEY", "") or "dev-secret-change-me"
    if len(raw.encode("utf-8")) < 32:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw


SECRET_KEY = derive_secret_key()


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


def decrypt_with_fallback(cipher: Any, token: str, scope: str) -> str:
    value = str(cipher or "")
    if not value.startswith(ENC_PREFIX):
        return value
    plain = _decrypt_scoped_text_raw(value, token, scope)
    if plain:
        return plain
    legacy_plain = _decrypt_scoped_text_raw(value, LEGACY_BOOTSTRAP_TOKEN, scope)
    if legacy_plain:
        return legacy_plain
    return value


def user_bio_scope(chat_id: str) -> str:
    return f"user-bio:{chat_id}"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Decrypt encrypted user bios in MongoDB.")
    parser.add_argument("--dry-run", action="store_true", help="Only print stats without writing updates.")
    args = parser.parse_args()

    load_dotenv()
    mongo_url = os.getenv("MONGO_DB")
    if not mongo_url:
        raise RuntimeError("MONGO_DB is not set in environment.")

    client = AsyncIOMotorClient(mongo_url)
    db = client["Messenger"]
    users = db["users"]

    scanned = 0
    changed = 0
    skipped = 0

    cursor = users.find({}, {"chatId": 1, "profile.bio": 1, "_session_token": 1})
    async for user in cursor:
        scanned += 1
        chat_id = str(user.get("chatId") or "")
        if not chat_id:
            skipped += 1
            continue
        profile = user.get("profile") or {}
        bio = str(profile.get("bio") or "")
        if not bio:
            skipped += 1
            continue

        plain_bio = decrypt_with_fallback(bio, str(user.get("_session_token") or ""), user_bio_scope(chat_id))
        if plain_bio == bio:
            skipped += 1
            continue

        changed += 1
        if not args.dry_run:
            await users.update_one(
                {"_id": user["_id"]},
                {"$set": {"profile.bio": plain_bio, "profile.bioEncrypted": False}},
            )

    client.close()
    mode = "DRY-RUN" if args.dry_run else "APPLY"
    print(f"[{mode}] scanned={scanned} changed={changed} skipped={skipped}")


if __name__ == "__main__":
    asyncio.run(main())
