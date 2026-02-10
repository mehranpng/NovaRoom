from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt
import os
from dotenv import load_dotenv
import asyncio

load_dotenv()

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))
db = client["Messenger"]
cl_users = db["users"]


async def migrate():
    print("Starting migration...")

    async for user in cl_users.find({}):
        updates = {}
        unset = {}

        # 1. Fix chatId field
        if "chatid" in user:
            old = user["chatid"]
            new_chatid = (
                f"CID-{int(old):05d}" if isinstance(old, (int, str)) else str(old)
            )
            updates["chatId"] = new_chatid
            unset["chatid"] = ""

        # 2. Hash password if it's still plain text
        if "login" in user and "password" in user["login"]:
            pw = user["login"]["password"]
            if isinstance(pw, str) and not pw.startswith("$2"):
                hashed = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode(
                    "utf-8"
                )
                updates["login.password"] = hashed
                print(f"Hashed password for {user['login'].get('email')}")

        if updates or unset:
            update_op = {}
            if updates:
                update_op["$set"] = updates
            if unset:
                update_op["$unset"] = unset

            await cl_users.update_one({"_id": user["_id"]}, update_op)
            print(
                f"Migrated user: {user.get('login', {}).get('email')} → chatId={updates.get('chatId')}"
            )

    print("✅ Migration completed successfully!")


asyncio.run(migrate())
