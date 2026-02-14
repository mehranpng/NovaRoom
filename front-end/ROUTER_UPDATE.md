# Router Update Guide

## بعد از Pull کردن این تغییرات، حتماً این دستور را اجرا کنید:

```bash
cd front-end
npm install
```

یا اگر از `yarn` استفاده می‌کنید:

```bash
cd front-end
yarn install
```

این دستور `react-router-dom` را نصب می‌کند که برای مدیریت روت‌های مختلف در صفحات ثبت‌نام، لاگین و بازیابی رمز عبور استفاده شده است.

## تغییرات اعمال شده:

### ✅ مشکلات برطرف شده:

1. **RTL و فونت**: تمام متن‌های فارسی، لینک‌ها و دکمه‌ها حالا راست‌چین و با فونت Vazir هستند
2. **تراز آیکون‌ها**: آیکون‌ها در کنار label ها به صورت صحیح قرار گرفته‌اند
3. **اینپوت‌های کد عددی**: تمام اینپوت‌های کد تأیید فقط عدد قبول می‌کنند (`inputMode="numeric"`)
4. **پیام‌های موفقیت**: پیام‌های سبز رنگ با آیکون CheckCircle و متن راهنما درون آن قرار گرفته
5. **هشدار Spam**: آیکون AlertCircle به جای ایموجی استفاده شده و متن به فارسی خالص تبدیل شد
6. **جلوگیری از Refresh**: با `useEffect` و `visibilitychange` event از refresh خودکار هنگام بازگشت از اپ دیگر جلوگیری شد
7. **روت‌های جداگانه**: هر مرحله از ثبت‌نام، لاگین و بازیابی رمز عبور روت مخصوص خود را دارد:
   - `/register/email`
   - `/register/verify`
   - `/register/complete`
   - `/forgot-password/request`
   - `/forgot-password/reset`

### 📝 کامپوننت‌های به‌روز شده:

- `Register.tsx` - ثبت‌نام با 3 مرحله
- `ForgotPassword.tsx` - بازیابی رمز عبور با 2 مرحله
- `Login.tsx` - صفحه ورود
- `App.css` - استایل‌های RTL و راست‌چین
- `main.tsx` - اضافه شدن BrowserRouter
- `package.json` - اضافه شدن react-router-dom

---

**نکته مهم**: بعد از نصب، سرور dev را restart کنید:

```bash
npm run dev
```
