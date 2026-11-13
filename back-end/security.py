import functools
import ipaddress
import math
import os
import time
from bisect import bisect_right
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

from dotenv import find_dotenv, load_dotenv
from fastapi import HTTPException
from p_redis_limiter import Rate, RateLimiter
from redis.asyncio import Redis
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_root_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
else:
    load_dotenv(find_dotenv(usecwd=True))


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


PRODUCTION = env_bool("PRODUCTION")

GLOBAL_RATES = ["30/s", "300/m", "3000/h"]
WS_CONNECT_RATES = ["5/s", "20/m"]
DENIAL_WEIGHT = 5
BAD_STATUS_WEIGHT = 1
BAD_STATUSES = frozenset({401, 403, 404, 405})
VIOLATION_WINDOW_SECONDS = 60
VIOLATION_THRESHOLD = 60
BLOCK_DURATIONS = (300, 900, 3600, 21600, 86400)
LEVEL_MEMORY_SECONDS = 86400
LOCAL_FALLBACK_RATE = "10/s"
BLOCKED_CACHE_MAX = 20000

TRUSTED_PROXIES = frozenset(
    item.strip()
    for item in os.getenv("TRUSTED_PROXIES", "127.0.0.1,::1").split(",")
    if item.strip()
)

_whitelist = {
    item.strip()
    for item in os.getenv("RATE_LIMIT_WHITELIST", "").split(",")
    if item.strip()
}

redis_client: Optional[Redis] = None
global_limiter: Optional[RateLimiter] = None
ws_limiter: Optional[RateLimiter] = None

if PRODUCTION:
    redis_client = Redis(
        host=os.getenv("REDIS_HOST", "127.0.0.1"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_DB", "0")),
        password=os.getenv("REDIS_PASSWORD") or None,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    global_limiter = RateLimiter(
        redis_client,
        rates=GLOBAL_RATES,
        prefix="nr:global",
        on_redis_error="local",
        fallback_rate=LOCAL_FALLBACK_RATE,
    )
    ws_limiter = RateLimiter(
        redis_client,
        rates=WS_CONNECT_RATES,
        prefix="nr:ws",
        on_redis_error="local",
        fallback_rate="5/s",
    )

VIOLATION_LUA = """
local v = redis.call('INCRBY', KEYS[1], ARGV[4])
if v == tonumber(ARGV[4]) then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if v < tonumber(ARGV[2]) then return 0 end
redis.call('DEL', KEYS[1])
if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
local level = tonumber(redis.call('INCR', KEYS[2]))
if level > #ARGV - 4 then
  level = #ARGV - 4
  redis.call('SET', KEYS[2], level, 'KEEPTTL')
end
local dur = tonumber(ARGV[4 + level])
redis.call('SET', KEYS[3], level, 'EX', dur)
redis.call('EXPIRE', KEYS[2], dur + tonumber(ARGV[3]))
return dur
"""

_violation_script = redis_client.register_script(VIOLATION_LUA) if redis_client else None
_blocked_until: dict[str, float] = {}


def is_public_ip(value: str) -> bool:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not (addr.is_loopback or addr.is_private or addr.is_link_local)


def client_ip(source: Any) -> str:
    client = getattr(source, "client", None)
    peer = getattr(client, "host", "") if client else ""
    headers = source.headers
    if peer not in TRUSTED_PROXIES and is_public_ip(peer):
        return peer[:64]
    real_ip = (headers.get("x-real-ip") or "").strip()
    if real_ip and is_public_ip(real_ip):
        return real_ip[:64]
    forwarded = headers.get("x-forwarded-for")
    parts = [p.strip() for p in forwarded.split(",") if p.strip()] if forwarded else []
    for part in reversed(parts):
        if is_public_ip(part):
            return part[:64]
    if real_ip:
        return real_ip[:64]
    if parts:
        return parts[-1][:64]
    return (peer or "127.0.0.1")[:64]


def is_exempt_ip(ip: str) -> bool:
    if ip in _whitelist:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_loopback or addr.is_private or addr.is_link_local


async def blocked_seconds(ip: str) -> int:
    now = time.monotonic()
    cached = _blocked_until.get(ip)
    if cached:
        if cached > now:
            return max(1, math.ceil(cached - now))
        _blocked_until.pop(ip, None)
    if not redis_client:
        return 0
    try:
        ttl = await redis_client.ttl(f"nr:block:{ip}")
    except Exception:
        return 0
    if ttl and ttl > 0:
        if len(_blocked_until) >= BLOCKED_CACHE_MAX:
            _blocked_until.clear()
        _blocked_until[ip] = now + ttl
        return ttl
    return 0


async def register_violation(ip: str, weight: int) -> None:
    if not _violation_script or is_exempt_ip(ip):
        return
    try:
        duration = await _violation_script(
            keys=[f"nr:viol:{ip}", f"nr:level:{ip}", f"nr:block:{ip}"],
            args=[
                VIOLATION_WINDOW_SECONDS,
                VIOLATION_THRESHOLD,
                LEVEL_MEMORY_SECONDS,
                weight,
                *BLOCK_DURATIONS,
            ],
        )
    except Exception:
        return
    if duration:
        _blocked_until[ip] = time.monotonic() + int(duration)


async def register_blocked_hit(ip: str) -> None:
    await register_violation(ip, DENIAL_WEIGHT)


def _too_many(retry_after: int, detail: str = "Too many requests") -> JSONResponse:
    return JSONResponse(
        {"detail": detail, "retry_after": retry_after},
        status_code=429,
        headers={"Retry-After": str(retry_after)},
    )


class SecurityMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in ("http", "websocket") or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return

        connection = HTTPConnection(scope)
        ip = client_ip(connection)
        is_ws = scope["type"] == "websocket"

        if not PRODUCTION or is_exempt_ip(ip):
            await self.app(scope, receive, send)
            return

        remaining = await blocked_seconds(ip)
        if remaining:
            await register_blocked_hit(ip)
            await self._reject(scope, receive, send, is_ws, _too_many(remaining, "Temporarily blocked"))
            return

        limiter = ws_limiter if is_ws else global_limiter
        result = await limiter.check_async(ip)
        if not result.allowed:
            await register_violation(ip, DENIAL_WEIGHT)
            retry = max(1, math.ceil(result.retry_after))
            await self._reject(scope, receive, send, is_ws, _too_many(retry))
            return

        if is_ws:
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message):
            if message["type"] == "http.response.start" and message["status"] in BAD_STATUSES:
                await register_violation(ip, BAD_STATUS_WEIGHT)
            await send(message)

        await self.app(scope, receive, send_wrapper)

    @staticmethod
    async def _reject(scope, receive, send, is_ws: bool, response: JSONResponse):
        if is_ws:
            await send({"type": "websocket.close", "code": 1008})
            return
        await response(scope, receive, send)


def _build_route_limiter(func, spec: str) -> RateLimiter:
    rates = [Rate.parse(part.strip()) for part in spec.split(";") if part.strip()]
    return RateLimiter(
        redis_client,
        rates=rates,
        prefix=f"nr:route:{func.__module__}.{func.__qualname__}",
        on_redis_error="local",
        fallback_rate=LOCAL_FALLBACK_RATE,
    )


def _limit(spec: str):
    def decorator(func):
        if not PRODUCTION:
            return func
        route_limiter = _build_route_limiter(func, spec)

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if request is not None:
                ip = client_ip(request)
                if not is_exempt_ip(ip):
                    result = await route_limiter.check_async(ip)
                    if not result.allowed:
                        await register_violation(ip, DENIAL_WEIGHT)
                        retry = max(1, math.ceil(result.retry_after))
                        raise HTTPException(
                            status_code=429,
                            detail="Too many requests",
                            headers={"Retry-After": str(retry)},
                        )
            return await func(*args, **kwargs)

        return wrapper

    return decorator


limiter = SimpleNamespace(limit=_limit)


async def close_redis() -> None:
    if redis_client:
        await redis_client.aclose()
