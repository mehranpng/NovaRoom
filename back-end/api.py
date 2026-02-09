from fastapi import FastAPI
import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


load_dotenv()

client = AsyncIOMotorClient(os.getenv("MONGO_DB"))

db = client["Messenger"]
cl_users = db["users"]


####
