# ✅ رفع مشکل 403 Forbidden در بررسی نام کاربری

## 🔴 مشکل اصلی

```
INFO: 83.121.126.201:0 - "GET /users/username-available?username=mehran HTTP/1.1" 403 Forbidden
```

پیام خطا:
```
بررسی نام کاربری ممکن نشد
```

---

## 🔍 علت مشکل

Endpoint `/users/username-available` نیاز به **authentication** داشت:

```python
# ❌ قبلی - نیاز به توکن داشت
@app.get("/users/username-available")
async def username_available(
    username: str = Query(..., min_length=1, max_length=32),
    current_user: dict = Depends(get_current_user),  # ❌ Authentication required
):
    ...
```

**مشکل**: در صفحه Register، کاربر هنوز login نکرده و توکن ندارد! ❌

---

## ✅ راه‌حل

### 1. ایجاد Endpoint Public جدید در Backend

یک endpoint جدید بدون نیاز به authentication ایجاد کردیم:

```python
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
```

**ویژگی‌ها**:
- ✅ بدون نیاز به authentication
- ✅ فقط برای registration استفاده می‌شود
- ✅ همان validation logic را دارد

---

### 2. به‌روزرسانی Frontend

در `Register.tsx` از endpoint جدید استفاده می‌کنیم:

```tsx
// ✅ استفاده از endpoint public
const response = await fetch(
    `${API_URL}/auth/username-available?username=${encodeURIComponent(trimmed)}`,
    {
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
        },
        // ❌ بدون Authorization header
    }
);
```

**تغییر کلیدی**: دیگر از `apiFetch` استفاده نمی‌کنیم (که خودکار توکن اضافه می‌کند)، بلکه مستقیماً `fetch` را صدا می‌زنیم.

---

## 📊 مقایسه Before/After

| | قبل ❌ | بعد ✅ |
|---|--------|--------|
| **Endpoint** | `/users/username-available` | `/auth/username-available` |
| **Authentication** | ✅ Required | ❌ Not Required |
| **Use Case** | فقط Profile Edit | Register + Profile Edit |
| **HTTP Status** | 403 Forbidden | 200 OK |
| **Frontend Call** | `apiFetch()` با auth | `fetch()` بدون auth |

---

## 🎯 دو Endpoint جداگانه

حالا دو endpoint داریم:

### 1. `/auth/username-available` (Public)
```python
# برای Registration
# بدون نیاز به authentication
# چک می‌کند username در کل سیستم موجود است یا نه
```

### 2. `/users/username-available` (Authenticated)
```python
# برای Profile Edit
# نیاز به authentication دارد
# چک می‌کند username برای کاربر فعلی قابل استفاده است یا نه
# (اگر username خود کاربر باشد، available برمی‌گرداند)
```

---

## ✅ نتیجه

حالا بررسی username در Register بدون خطا کار می‌کند:

```
✅ INFO: 83.121.126.201:0 - "GET /auth/username-available?username=mehran HTTP/1.1" 200 OK
```

و پیام فارسی:
```
✅ "نام کاربری قابل استفاده است"
```

---

## 📝 فایل‌های تغییر یافته

1. **Backend**: `back-end/api.py`
   - ✅ اضافه کردن endpoint public جدید
   
2. **Frontend**: `front-end/src/components/Register.tsx`
   - ✅ استفاده از endpoint جدید با `fetch()` مستقیم

---

## 🔒 نکات امنیتی

**چرا endpoint public مشکلی ندارد؟**

- ✅ فقط اطلاعات عمومی (`available: true/false`) برمی‌گرداند
- ✅ هیچ اطلاعات شخصی‌ای leak نمی‌کند
- ✅ Rate limiting در production قابل اعمال است
- ✅ Username validation قبل از چک انجام می‌شود

---

## 🎉 تست

### تست 1: Username موجود نیست
```bash
curl "http://localhost:8000/auth/username-available?username=newuser123"
# Response: {"available": true}
```

### تست 2: Username موجود است
```bash
curl "http://localhost:8000/auth/username-available?username=mehran"
# Response: {"available": false}
```

### تست 3: Username نامعتبر
```bash
curl "http://localhost:8000/auth/username-available?username=test@123"
# Response: {"available": false}
```

---

## 🎊 همه چیز آماده است!

- ✅ مشکل 403 Forbidden حل شد
- ✅ بررسی real-time username در Register کار می‌کند
- ✅ پیام‌های فارسی نمایش داده می‌شوند
- ✅ دو endpoint جدا برای Registration و Profile Edit
