# Mobile Refresh Fix - راه‌حل مشکل Refresh در موبایل

## مشکل قبلی ❌

وقتی کاربر در موبایل:
1. روی دکمه "ارسال کد" می‌زد
2. به اپلیکیشن Gmail می‌رفت تا کد را کپی کند  
3. برمی‌گشت به مرورگر

**نتیجه**: صفحه refresh می‌شد و تمام state ها (مثل ایمیل، step) پاک می‌شدند ❌

---

## علت مشکل 🔍

### 1. **State در حافظه موقت کامپوننت**
همه state ها در `useState` ذخیره می‌شدند:
```tsx
const [email, setEmail] = useState('');  // ❌ در RAM
const [step, setStep] = useState('email');  // ❌ در RAM
```

**مشکل**: وقتی برگه مرورگر inactive می‌شد (رفتن به Gmail)، مرورگر ممکن بود صفحه را unload کند و تمام state ها پاک شوند.

### 2. **useEffect با navigate باعث Loop می‌شد**
```tsx
useEffect(() => {
    navigate('/register/verify');  // ❌ هر بار که component mount می‌شد
}, [step]);
```

**مشکل**: وقتی صفحه refresh می‌شد، useEffect اجرا می‌شد و باعث navigate می‌شد که دوباره component را mount می‌کرد.

---

## راه‌حل ✅

### 1. **استفاده از sessionStorage برای ذخیره ایمیل**
```tsx
const [email, setEmail] = useState(() => 
    sessionStorage.getItem('register_email') || ''
);
```

**مزیت**: 
- ✅ حتی بعد از refresh، ایمیل حفظ می‌شود
- ✅ فقط در session فعلی مرورگر معتبر است
- ✅ وقتی tab بسته می‌شود، پاک می‌شود

### 2. **خواندن Step از URL به جای State**
```tsx
const getStepFromPath = (): Step => {
    if (location.pathname.includes('/verify')) return 'code';
    if (location.pathname.includes('/complete')) return 'details';
    return 'email';
};

const [step, setStepState] = useState<Step>(getStepFromPath());
```

**مزیت**:
- ✅ URL به عنوان **Single Source of Truth** عمل می‌کند
- ✅ حتی بعد از refresh، step صحیح از URL خوانده می‌شود
- ✅ دکمه back/forward مرورگر هم کار می‌کند

### 3. **Sync کردن State با URL بدون Loop**
```tsx
useEffect(() => {
    const newStep = getStepFromPath();
    setStepState(newStep);
    
    // بازیابی ایمیل از sessionStorage
    const savedEmail = sessionStorage.getItem('register_email');
    if (savedEmail && (newStep === 'code' || newStep === 'details')) {
        setEmail(savedEmail);
    }
}, [location.pathname]);  // فقط وقتی URL تغییر می‌کند
```

**مزیت**:
- ✅ فقط وقتی URL تغییر کند، اجرا می‌شود (نه هر بار که component render می‌شود)
- ✅ اگر کاربر مستقیم به `/register/verify` برود، ایمیل از sessionStorage بازیابی می‌شود

---

## فلوچارت راه‌حل 🔄

### سناریو 1: ثبت‌نام موفق
```
1. کاربر ایمیل را وارد می‌کند
   ↓
2. ایمیل در sessionStorage ذخیره می‌شود
   sessionStorage.setItem('register_email', email)
   ↓
3. navigate به /register/verify
   ↓
4. کاربر به Gmail می‌رود 📱
   ↓
5. کاربر برمی‌گردم 🔙
   ↓
6. useEffect اجرا می‌شود:
   - step از URL خوانده می‌شود → 'code'
   - email از sessionStorage خوانده می‌شود → 'user@example.com'
   ↓
7. ✅ صفحه در همان وضعیت قبل نمایش داده می‌شود
```

### سناریو 2: Refresh دستی
```
1. کاربر در صفحه /register/verify است
   ↓
2. کاربر صفحه را refresh می‌کند (F5)
   ↓
3. Component از نو mount می‌شود
   ↓
4. useState با مقدار اولیه اجرا می‌شود:
   - step = getStepFromPath() → از URL خوانده می‌شود → 'code'
   - email = sessionStorage.getItem('register_email') → 'user@example.com'
   ↓
5. ✅ صفحه با همان step و email نمایش داده می‌شود
```

---

## تغییرات کلیدی 🔑

### قبل (❌ مشکل‌دار):
```tsx
const [step, setStep] = useState('email');
const [email, setEmail] = useState('');

useEffect(() => {
    if (step === 'code') {
        navigate('/register/verify');
    }
}, [step, navigate]);
```

### بعد (✅ درست):
```tsx
// 1. خواندن step از URL
const getStepFromPath = (): Step => {
    if (location.pathname.includes('/verify')) return 'code';
    return 'email';
};

// 2. مقداردهی اولیه از sessionStorage و URL
const [step, setStepState] = useState<Step>(getStepFromPath());
const [email, setEmail] = useState(() => 
    sessionStorage.getItem('register_email') || ''
);

// 3. Sync با URL فقط وقتی URL تغییر کند
useEffect(() => {
    const newStep = getStepFromPath();
    setStepState(newStep);
    
    const savedEmail = sessionStorage.getItem('register_email');
    if (savedEmail && newStep === 'code') {
        setEmail(savedEmail);
    }
}, [location.pathname]);

// 4. تابع setStep که هم state و هم URL را به‌روز می‌کند
const setStep = (newStep: Step) => {
    setStepState(newStep);
    if (newStep === 'code') {
        navigate('/register/verify', { replace: true });
    }
};
```

---

## مدیریت sessionStorage 🗄️

### ذخیره‌سازی
```tsx
// وقتی کد با موفقیت ارسال شد
sessionStorage.setItem('register_email', email);
```

### بازیابی
```tsx
// در useState
const [email, setEmail] = useState(() => 
    sessionStorage.getItem('register_email') || ''
);

// یا در useEffect
const savedEmail = sessionStorage.getItem('register_email');
if (savedEmail) {
    setEmail(savedEmail);
}
```

### پاک‌سازی
```tsx
// وقتی ثبت‌نام کامل شد
sessionStorage.removeItem('register_email');

// وقتی کاربر برگشت به صفحه login
const handleBackToLogin = () => {
    sessionStorage.removeItem('register_email');
    onBackToLogin();
};
```

---

## تست 🧪

### تست 1: رفتن به Gmail و برگشتن
1. ✅ وارد کردن ایمیل
2. ✅ کلیک روی "ارسال کد"
3. ✅ رفتن به اپ Gmail
4. ✅ برگشتن به مرورگر
5. **نتیجه**: صفحه باید در همان وضعیت باشد و ایمیل حفظ شود

### تست 2: Refresh دستی
1. ✅ رفتن به مرحله "وارد کردن کد"
2. ✅ F5 یا Pull to Refresh
3. **نتیجه**: صفحه باید با همان step و ایمیل نمایش داده شود

### تست 3: Copy/Paste URL
1. ✅ کپی کردن URL: `/register/verify`
2. ✅ بستن tab
3. ✅ باز کردن tab جدید و paste کردن URL
4. **نتیجه**: اگر sessionStorage وجود داشت، ایمیل بازیابی می‌شود

### تست 4: بستن و باز کردن مرورگر
1. ✅ بستن مرورگر
2. ✅ باز کردن مرورگر
3. **نتیجه**: sessionStorage پاک می‌شود (برخلاف localStorage)

---

## مزایای راه‌حل ✨

| ویژگی | قبل ❌ | بعد ✅ |
|--------|--------|--------|
| حفظ ایمیل بعد از refresh | خیر | بله |
| حفظ step بعد از refresh | خیر | بله |
| کار کردن back/forward | خیر | بله |
| جلوگیری از loop | خیر | بله |
| امنیت (پاک شدن بعد از بستن tab) | - | بله |
| Deep linking (مثلاً `/register/verify`) | خیر | بله |

---

## کامپوننت‌های اصلاح شده 📝

- ✅ `Register.tsx` - استفاده از sessionStorage برای 'register_email'
- ✅ `ForgotPassword.tsx` - استفاده از sessionStorage برای 'forgot_email'

---

## نکات مهم ⚠️

1. **sessionStorage vs localStorage**:
   - ✅ `sessionStorage` فقط در session فعلی معتبر است
   - ❌ `localStorage` حتی بعد از بستن مرورگر باقی می‌ماند (برای این use case مناسب نیست)

2. **URL به عنوان Single Source of Truth**:
   - ✅ همیشه step را از URL بخوانید
   - ❌ نباید step را فقط در state نگه دارید

3. **جلوگیری از Loop**:
   - ✅ dependency array در useEffect باید `[location.pathname]` باشد
   - ❌ نه `[step]` که باعث loop می‌شود

---

## نتیجه‌گیری 🎯

با این تغییرات:
- ✅ مشکل refresh در موبایل کاملاً برطرف شد
- ✅ تجربه کاربری بهتر شد
- ✅ کد تمیزتر و قابل نگهداری‌تر شد
- ✅ از best practice های React Router استفاده شد
