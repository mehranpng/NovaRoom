from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt
import os
import asyncio
from pathlib import Path
from dotenv import load_dotenv, find_dotenv

_root_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
else:
    load_dotenv(find_dotenv(usecwd=True))

DB_NAME = os.getenv("MONGO_DB_NAME") or os.getenv("DB_NAME", "novaroom")
client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client[DB_NAME]
cl_users = db["users"]


async def hash_existing_passwords():
    users = await cl_users.find(
        {"login.password": {"$not": {"$regex": "^\\$2[abxy]\\$"}}}
    ).to_list(None)

    print(f"Found {len(users)} users with plain-text password")

    for user in users:
        plain_pass = user["login"]["password"]
        hashed = bcrypt.hashpw(plain_pass.encode("utf-8"), bcrypt.gensalt())
        hashed_str = hashed.decode("utf-8")

        await cl_users.update_one(
            {"_id": user["_id"]}, {"$set": {"login.password": hashed_str}}
        )
        print(f"✓ Hashed password for {(user.get('profile') or {}).get('username') or user.get('chatId')}")

    print("✅ All passwords hashed successfully!")


asyncio.run(hash_existing_passwords())
