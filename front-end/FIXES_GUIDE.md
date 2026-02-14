# 🔧 راهنمای اصلاح مشکلات UI و Router

## خلاصه مشکلات

1. ✅ **آیکون دکمه‌های بازگشت بالاتر از متن بود** - حل شده در `App.css`
2. ⏳ **پیام تکراری در Register/ForgotPassword**
3. ⏳ **فقدان آیکون در label‌های Login**
4. ✅ **خطاهای HTML validation** - حل شده در `App.css`
5. ⏳ **Router کار نمی‌کند**

---

## 1️⃣ Login.tsx - اضافه کردن آیکون به label‌ها

### تغییرات:
```tsx
import { useState } from 'react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { LogIn, Mail, Key } from 'lucide-react'; // ✅ اضافه کردن Mail, Key

// ...

// در بخش form:
<div className="form-group">
    <label>
        <Mail size={16} /> {/* ✅ اضافه */}
        ایمیل
    </label>
    <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="example@gmail.com"
        required
        autoFocus
        onInvalid={(e) => {
            e.preventDefault();
            setError('لطفاً یک آدرس ایمیل معتبر وارد کنید');
        }}
    />
</div>

<div className="form-group">
    <label>
        <Key size={16} /> {/* ✅ اضافه */}
        رمز عبور
    </label>
    <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        required
        onInvalid={(e) => {
            e.preventDefault();
            setError('لطفاً رمز عبور خود را وارد کنید');
        }}
    />
</div>
```

---

## 2️⃣ Register.tsx - حذف پیام تکراری و HTML validation

### مشکل پیام تکراری:
در `handleEmailSubmit`:

```tsx
// ❌ قبلی - دو جا پیام نمایش داده می‌شد
setSuccess(`کد تأیید به ایمیل ${email} ارسال شد`);
setTimeout(() => {
    setStep('code');
}, 1500);
```

```tsx
// ✅ بعدی - فقط یک پیام قبل از رفتن به step بعد
try {
    await apiFetch('/auth/register/email', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
    
    // Save email
    sessionStorage.setItem('register_email', email);
    
    // Navigate to next step WITHOUT showing success message
    // The success message will be shown IN the code step
    setStep('code');
} catch (err: any) {
    setError(getErrorMessage(err));
} finally {
    setLoading(false);
}
```

### و در بخش Step 2 (code)، نمایش پیام:
```tsx
{step === 'code' && (
    <form onSubmit={handleCodeSubmit}>
        <div className="form-group">
            <label>
                <Key size={16} />
                کد تأیید 6 رقمی
            </label>
            <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                required
                autoFocus
                onInvalid={(e) => {
                    e.preventDefault();
                    setError('لطفاً کد 6 رقمی را وارد کنید');
                }}
            />
        </div>

        <div className="success-message">
            <CheckCircle size={20} />
            <div>
                <div>کد تأیید به ایمیل {email} ارسال شد</div>
                <div className="info-message" style={{ marginTop: '8px', padding: '8px 10px' }}>
                    <AlertCircle size={16} />
                    <span>اگر ایمیل دریافت نکردید، پوشه هرزنامه را بررسی کنید</span>
                </div>
            </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'در حال تأیید...' : 'تأیید کد'}
        </button>
        
        {/* ... */}
    </form>
)}
```

### HTML Validation:
```tsx
// به همه input‌ها اضافه کنید:
onInvalid={(e) => {
    e.preventDefault();
    setError('پیام خطای فارسی مناسب');
}}
```

---

## 3️⃣ ForgotPassword.tsx - مشابه Register

### در `handleEmailSubmit`:
```tsx
try {
    await apiFetch('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
    
    sessionStorage.setItem('reset_email', email);
    
    // Navigate WITHOUT showing success
    setStep('reset');
} catch (err: any) {
    setError(getErrorMessage(err));
} finally {
    setLoading(false);
}
```

### در Step 2:
```tsx
{step === 'reset' && (
    <form onSubmit={handleResetSubmit}>
        {/* ... */}
        
        <div className="success-message">
            <CheckCircle size={20} />
            <div>
                <div>کد بازیابی به ایمیل {email} ارسال شد</div>
                <div className="info-message" style={{ marginTop: '8px', padding: '8px 10px' }}>
                    <AlertCircle size={16} />
                    <span>اگر ایمیل دریافت نکردید، پوشه هرزنامه را بررسی کنید</span>
                </div>
            </div>
        </div>
        
        {/* ... */}
    </form>
)}
```

---

## 4️⃣ Router - اصلاح کامل

### `main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </React.StrictMode>
);
```

### `App.tsx` - استفاده از Routes:
```tsx
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

// ...

export function App() {
    const location = useLocation();
    // ... all state ...
    
    // Check auth
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            apiFetch('/profile/me')
                .then(user => {
                    setCurrentUser(user);
                    setIsAuthenticated(true);
                })
                .catch(() => {
                    localStorage.removeItem('token');
                });
        }
    }, []);
    
    if (!isAuthenticated) {
        return (
            <Routes>
                <Route path="/login" element={
                    <Login
                        onLoginSuccess={handleLoginSuccess}
                        onRegisterClick={() => navigate('/register/email')}
                        onForgotPasswordClick={() => navigate('/forgot-password/request')}
                    />
                } />
                
                <Route path="/register/*" element={
                    <Register
                        onRegisterSuccess={handleRegisterSuccess}
                        onBackToLogin={() => navigate('/login')}
                    />
                } />
                
                <Route path="/forgot-password/*" element={
                    <ForgotPassword
                        onBackToLogin={() => navigate('/login')}
                        onResetSuccess={() => navigate('/login')}
                    />
                } />
                
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        );
    }
    
    // Main app (authenticated)
    return (
        <div className="app">
            {/* ... main app ... */}
        </div>
    );
}
```

### `Register.tsx` - با router:
```tsx
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';

export function Register({ onRegisterSuccess, onBackToLogin }: RegisterProps) {
    const navigate = useNavigate();
    const location = useLocation();
    
    // استفاده از Routes برای مدیریت step‌ها
    return (
        <Routes>
            <Route path="email" element={<EmailStep />} />
            <Route path="verify" element={<CodeStep />} />
            <Route path="complete" element={<DetailsStep />} />
            <Route path="*" element={<Navigate to="email" replace />} />
        </Routes>
    );
}

// یا می‌توانید با useLocation step را تشخیص دهید:
const getStepFromPath = (): Step => {
    if (location.pathname.includes('/verify')) return 'code';
    if (location.pathname.includes('/complete')) return 'details';
    return 'email';
};

const setStep = (newStep: Step) => {
    if (newStep === 'email') {
        navigate('/register/email');
    } else if (newStep === 'code') {
        navigate('/register/verify');
    } else if (newStep === 'details') {
        navigate('/register/complete');
    }
};
```

### `ForgotPassword.tsx` - مشابه Register:
```tsx
import { useNavigate, useLocation } from 'react-router-dom';

const getStepFromPath = (): Step => {
    if (location.pathname.includes('/reset')) return 'reset';
    return 'request';
};

const setStep = (newStep: Step) => {
    if (newStep === 'request') {
        navigate('/forgot-password/request');
    } else if (newStep === 'reset') {
        navigate('/forgot-password/reset');
    }
};
```

---

## 5️⃣ تست‌ها

### Router Test:
1. `/login` → صفحه Login
2. `/register/email` → Register step 1
3. `/register/verify` → Register step 2
4. `/register/complete` → Register step 3
5. Refresh در هر کدام → باید همان صفحه باقی بماند
6. Back/Forward browser → باید کار کند

### UI Test:
1. ✅ دکمه‌های بازگشت: آیکون کنار متن
2. ✅ Label‌های Login: آیکون Mail و Key
3. ✅ پیام‌های success: فقط یک پیام
4. ✅ HTML validation: پیام‌های فارسی

---

## نکات مهم

### 1. sessionStorage برای حفظ email:
```tsx
// Save
sessionStorage.setItem('register_email', email);

// Load
const savedEmail = sessionStorage.getItem('register_email');

// Clear after register
sessionStorage.removeItem('register_email');
```

### 2. HTML Validation:
```tsx
<input
    required
    minLength={6}
    onInvalid={(e) => {
        e.preventDefault();
        setError('پیام فارسی');
    }}
/>
```

### 3. Router Navigation:
```tsx
import { useNavigate } from 'react-router-dom';

const navigate = useNavigate();

navigate('/path'); // Navigate
navigate('/path', { replace: true }); // Replace
```

---

## چک‌لیست نهایی

- [x] `App.css` - استایل دکمه‌ها و HTML validation
- [ ] `main.tsx` - BrowserRouter
- [ ] `App.tsx` - Routes
- [ ] `Login.tsx` - آیکون‌ها + HTML validation
- [ ] `Register.tsx` - Router + پیام تکراری + HTML validation
- [ ] `ForgotPassword.tsx` - Router + پیام تکراری + HTML validation

---

## دستورات npm

```bash
# Install react-router-dom if needed
npm install react-router-dom

# Run dev server
npm run dev
```

---

## مراجع

- [React Router Docs](https://reactrouter.com/)
- [Lucide Icons](https://lucide.dev/)
- [HTML Form Validation](https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation)
