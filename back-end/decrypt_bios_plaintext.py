"""
Run this script to convert encrypted bios to plain text in MongoDB.

Usage:
    python decrypt_bios_plaintext.py
"""

import os
import base64
import hashlib
import hmac
from typing import Tuple

from dotenv import load_dotenv
from pymongo import MongoClient

ENC_PREFIX = "enc:v1:"
ENC_NONCE_SIZE = 16
ENC_TAG_SIZE = 16


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


def _base64url_decode(value: str) -> bytes:
    normalized = value.replace("-", "+").replace("_", "/")
    padding = "=" * ((4 - (len(normalized) % 4)) % 4)
    return base64.b64decode((normalized + padding).encode("ascii"))


def decrypt_bio(cipher: str, chat_id: str) -> Tuple[bool, str]:
    value = str(cipher or "")
    if not value.startswith(ENC_PREFIX):
        return False, value

    try:
        raw = _base64url_decode(value[len(ENC_PREFIX):])
        if len(raw) < ENC_NONCE_SIZE + ENC_TAG_SIZE:
            return False, value
        nonce = raw[:ENC_NONCE_SIZE]
        body = raw[ENC_NONCE_SIZE:-ENC_TAG_SIZE]
        tag = raw[-ENC_TAG_SIZE:]
        scope = f"user-bio:{chat_id}"
        key = hashlib.sha256(f"novaroom-client-shared|{scope}".encode("utf-8")).digest()
        expected = hmac.new(key, nonce + body, hashlib.sha256).digest()[:ENC_TAG_SIZE]
        if not hmac.compare_digest(tag, expected):
            return False, value
        plain = _xor_stream(body, key, nonce).decode("utf-8", errors="ignore")
        return True, plain
    except Exception:
        return False, value


def main() -> None:
    load_dotenv()
    mongo_uri = os.getenv("MONGO_DB")
    if not mongo_uri:
        raise RuntimeError("MONGO_DB is not set")

    client = MongoClient(mongo_uri)
    db = client["Messenger2"]
    users = db["users"]

    total = 0
    converted = 0
    skipped = 0

    cursor = users.find(
        {"profile.bio": {"$type": "string"}},
        {"chatId": 1, "profile.bio": 1, "profile.bioEncrypted": 1},
    )
    for user in cursor:
        total += 1
        chat_id = str(user.get("chatId") or "")
        raw_bio = str(((user.get("profile") or {}).get("bio")) or "")
        if not chat_id:
            skipped += 1
            continue

        ok, plain = decrypt_bio(raw_bio, chat_id)
        if ok:
            users.update_one(
                {"_id": user["_id"]},
                {"$set": {"profile.bio": plain, "profile.bioEncrypted": False}},
            )
            converted += 1
        else:
            users.update_one(
                {"_id": user["_id"]},
                {"$set": {"profile.bioEncrypted": False}},
            )

    print(
        f"Done. total={total}, converted={converted}, skipped={skipped}, unchanged={total - converted - skipped}"
    )


if __name__ == "__main__":
    main()
