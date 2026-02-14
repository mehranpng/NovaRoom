import { useState, useRef } from 'react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { UserPlus, ArrowLeft, Mail, Key, User as UserIcon } from 'lucide-react';

interface RegisterProps {
    onRegisterSuccess: (user: User, token: string) => void;
    onBackToLogin: () => void;
}

type Step = 'email' | 'code' | 'details';

export function Register({ onRegisterSuccess, onBackToLogin }: RegisterProps) {
    const [step, setStep] = useState<Step>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const emailRef = useRef<HTMLInputElement | null>(null);
    const codeRef = useRef<HTMLInputElement | null>(null);
    const nameRef = useRef<HTMLInputElement | null>(null);
    const usernameRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);
    const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            setSuccess('کد تأیید به ایمیل شما ارسال شد');
            setStep('code');
        } catch (err: any) {
            if (err.message.includes('409')) {
                setError('این ایمیل قبلاً ثبت شده است');
            } else {
                setError(err.message || 'خطا در ارسال کد تأیید');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await apiFetch('/auth/register/verify', {
                method: 'POST',
                body: JSON.stringify({ email, code }),
            });

            setSuccess('کد تأیید با موفقیت تایید شد');
            setStep('details');
        } catch (err: any) {
            setError(err.message || 'کد تأیید نامعتبر یا منقضی شده است');
        } finally {
            setLoading(false);
        }
    };

    const handleDetailsSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Validate passwords match
        if (password !== confirmPassword) {
            setError('رمز عبور و تکرار آن یکسان نیستند');
            return;
        }

        // Validate password length
        if (password.length < 6) {
            setError('رمز عبور باید حداقل 6 کاراکتر باشد');
            return;
        }

        // Validate username format
        const usernameRegex = /^[A-Za-z0-9_]+$/;
        if (!usernameRegex.test(username)) {
            setError('نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد و _ باشد');
            return;
        }

        if (username.length > 32) {
            setError('نام کاربری نباید بیشتر از 32 کاراکتر باشد');
            return;
        }

        setLoading(true);

        try {
            const data = await apiFetch('/auth/register/complete', {
                method: 'POST',
                body: JSON.stringify({ email, name, username, password }),
            });

            localStorage.setItem('token', data.token);
            onRegisterSuccess(data.user, data.token);
        } catch (err: any) {
            if (err.message.includes('409')) {
                if (err.message.includes('Email')) {
                    setError('این ایمیل قبلاً ثبت شده است');
                } else if (err.message.includes('Username')) {
                    setError('این نام کاربری قبلاً گرفته شده است');
                } else {
                    setError('ایمیل یا نام کاربری تکراری است');
                }
            } else {
                setError(err.message || 'خطا در ثبت نام');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleResendCode = async () => {
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            setSuccess('کد تأیید مجدداً به ایمیل شما ارسال شد');
        } catch (err: any) {
            setError(err.message || 'خطا در ارسال مجدد کد');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <UserPlus size={48} strokeWidth={1.5} />
                    <h1>ثبت نام در نوا روم</h1>
                    <p>
                        {step === 'email' && 'ایمیل خود را وارد کنید'}
                        {step === 'code' && 'کد تأیید را وارد کنید'}
                        {step === 'details' && 'اطلاعات خود را تکمیل کنید'}
                    </p>
                </div>

                {/* Step 1: Email */}
                {step === 'email' && (
                    <form onSubmit={handleEmailSubmit}>
                        <div className="form-group">
                            <label>
                                <Mail size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                ایمیل
                            </label>
                            <input
                                ref={emailRef}
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        emailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="example@gmail.com"
                                required
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}
                        {success && <div className="success-message">{success}</div>}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال ارسال...' : 'ارسال کد تأیید'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={onBackToLogin}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                            بازگشت به ورود
                        </button>
                    </form>
                )}

                {/* Step 2: Verification Code */}
                {step === 'code' && (
                    <form onSubmit={handleCodeSubmit}>
                        <div className="form-group">
                            <label>
                                <Key size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                کد تأیید 6 رقمی
                            </label>
                            <input
                                ref={codeRef}
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                onFocus={() => {
                                    setTimeout(() => {
                                        codeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="123456"
                                maxLength={6}
                                pattern="\d{6}"
                                required
                            />
                            <small style={{ color: '#888', fontSize: '12px', marginTop: '8px', display: 'block' }}>
                                کد به ایمیل <strong>{email}</strong> ارسال شد
                                <br />
                                <span style={{ color: '#ff9800' }}>⚠️ اگر دریافت نکردید، پوشه هرزنامه (Spam) را چک کنید</span>
                            </small>
                        </div>

                        {error && <div className="error-message">{error}</div>}
                        {success && <div className="success-message">{success}</div>}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال تأیید...' : 'تأیید کد'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={handleResendCode}
                            disabled={loading}
                            style={{ marginTop: '10px' }}
                        >
                            ارسال مجدد کد
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => setStep('email')}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                            تغییر ایمیل
                        </button>
                    </form>
                )}

                {/* Step 3: User Details */}
                {step === 'details' && (
                    <form onSubmit={handleDetailsSubmit}>
                        <div className="form-group">
                            <label>
                                <UserIcon size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                نام
                            </label>
                            <input
                                ref={nameRef}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="نام خود را وارد کنید"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <UserIcon size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                نام کاربری
                            </label>
                            <input
                                ref={usernameRef}
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                                onFocus={() => {
                                    setTimeout(() => {
                                        usernameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="username123"
                                pattern="[A-Za-z0-9_]+"
                                maxLength={32}
                                required
                            />
                            <small style={{ color: '#888', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                                فقط حروف انگلیسی، اعداد و _
                            </small>
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                رمز عبور
                            </label>
                            <input
                                ref={passwordRef}
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        passwordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="••••••••"
                                minLength={6}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                تکرار رمز عبور
                            </label>
                            <input
                                ref={confirmPasswordRef}
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        confirmPasswordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                placeholder="••••••••"
                                minLength={6}
                                required
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}
                        {success && <div className="success-message">{success}</div>}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال ثبت نام...' : 'ثبت نام'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => setStep('code')}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                            بازگشت
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
