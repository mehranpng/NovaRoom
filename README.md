# Messenger

## آموزش ها
- [ساخت دیتابیس در MongoDB](#ساخت-دیتابیس-mongodb) برای اتصال به بک اند
- [ران کردن FastAPI (back-end)](#ران-کردن-fastapi-back-end)
<br><br><br><br>
## ساخت دیتابیس MongoDB
<br>

1. **به این آدرس رفته cloud.mongodb.com و یک اکانت ایجاد کنید.**
---


2. **روی دکمه Creat کلیک کنید.**
---

3. **پلن Free رو انتخاب کنید.**
---

4. **دکمه Create Deployment رو در پایین صفحه سمت راست بزنید.**
---

5. **در صفحه باز شده دکمه Creat Database User رو بزنید.**
---

6. **بعد روی دکمه Choose a connection method کلیک کنید.**
---

7. **گزینه Compass رو انتخاب کنید.**
---

8. **در صفخه باز شده یک آدرس به این شکل میبینید:**
```
mongodb+srv://mehran_db_user:8wYwEomxmp36AFgc@cluster0.ev6alta.mongodb.net/
```
*آن را کپی کنید و یک جا ذخیره کنید*

---

9. **در این مرحله باید این مقدار را به آدرسی که از مرحله قبل گرفتید اضافه کنید:**
```
?appName=Cluster0
```
*مقدار Cluster0 اسم اون دیتابیسی هست که در مرحله 2 ساختید.*
*اگر موقع ساخت اسم رو تغییر نداده باشید همون Cluster0 هست.*

**وقتی این را به آخر آدرس دیتابیس خود اضافه کنید چنین شکلی میشود:**
```
mongodb+srv://mehran_db_user:8wYwEomxmp36AFgc@cluster0.ev6alta.mongodb.net/?appName=Cluster0
```
*و برای اتصال به دیتابیس باید از این استفاده کنید*

---
10. **آدرس مرحله قبل را ذخیره کنید و در مرحله بعدی برای کانکنت شدن بک اند از اون آدرس استفاده میکنیم**
---

<br><br><br><br>
## ران کردن FastAPI (back-end)
<br>

1. **وارد فولدر back-end شوید و یک فایل با اسم زیر بسازید**
```
.env
```
*این فایل باید دقیقا کنار فایل api.py ساخته شود.*

---
2. **فایل .env را باز کنید و متن زیر را داخلش قرار دهید:**
```
MONGO_DB=mongodb+srv://mehran_db_user:8wYwEomxmp36AFgc@cluster0.ev6alta.mongodb.net/?appName=Cluster0
```
*باید جلوی MONGO_DB= آدرس خودتون رو که در مرحله 9 آموزش قبل ساختیم رو قرار دهید*

---
3. **ساخت محیط مجازی پایتون و نصب کتابخانه ها**
*ترمینال را در vscode باز کنید. (ctrl+`)*
*به مسیر بک اند وارد شوید:*
```
cd back-end
```
*کامند زیر را برای ساخت محیط مجازی وارد کنید:*
```
python -m venv venv
```
*محیط مجازی را فعال کنید:*
```
venv\Scripts\activate
```
*نصب کتابخانه های مورد نیاز*
```
pip install fastapi "uvicorn[standard]" motor pyjwt bcrypt python-dotenv
```
---

3. **ران کردن FastAPI**
*ترمینال را باز کنید و به مسیر بک اند وارد شوید*
```
cd back-end
```
*کامند زیر را در ترمینال وارد کنید:*
```
uvicorn api:app --host 0.0.0.0 --port 8000
```
---
4. **پس از ران API در این آدرس قابل دسترس است:**
```
http://localhost:8000/
```
*آدرس داکیومنت API:*
```
http://localhost:8000/docs
```
---
