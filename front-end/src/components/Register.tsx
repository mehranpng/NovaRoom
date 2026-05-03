import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { UserPlus, ArrowLeft, Mail, Key, User as UserIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { DarkModeToggle } from './DarkModeToggle';
import { useDarkMode } from '../hooks/useDarkMode';
import { detectDeviceName } from '../utils/device';

interface RegisterProps {
    onRegisterSuccess: (user: User, token: string) => void;
    onBackToLogin: () => void;
}

type Step = 'email' | 'code' | 'details';
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function Register({ onRegisterSuccess, onBackToLogin }: RegisterProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { themeMode, setThemeMode } = useDarkMode();

    const handleToggleTheme = () => {
        setThemeMode((prevMode) =>
            prevMode === 'system' ? 'light' : prevMode === 'light' ? 'dark' : 'system'
        );
    };
    
    // Determine step from URL path
    const getStepFromPath = (): Step => {
        if (location.pathname.includes('/verify')) return 'code';
        if (location.pathname.includes('/complete')) return 'details';
        return 'email';
    };

    const [step, setStepState] = useState<Step>(getStepFromPath());
    const [email, setEmail] = useState(() => sessionStorage.getItem('register_email') || '');
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [usernameHint, setUsernameHint] = useState<string>('');
    const checkTimerRef = useRef<number | null>(null);

    // Sync step with URL on mount and location change
    useEffect(() => {
        const newStep = getStepFromPath();
        setStepState(newStep);
        
        // Restore email from sessionStorage if on code or details step
        const savedEmail = sessionStorage.getItem('register_email');
        if (savedEmail && (newStep === 'code' || newStep === 'details')) {
            setEmail(savedEmail);
        }
    }, [location.pathname]);

    // Username checking using PUBLIC endpoint
    useEffect(() => {
        if (step !== 'details' || !username) {
            setUsernameStatus('idle');
            setUsernameHint('');
            return;
        }

        const trimmed = username.trim();

        if (!trimmed) {
            setUsernameStatus('invalid');
            setUsernameHint('نام کاربری الزامی است');
            return;
        }

        if (trimmed.length < 3) {
            setUsernameStatus('invalid');
            setUsernameHint('نام کاربری باید حداقل 3 کاراکتر باشد');
            return;
        }

        if (trimmed.length > 32) {
            setUsernameStatus('invalid');
            setUsernameHint('حداکثر 32 کاراکتر');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setUsernameStatus('invalid');
            setUsernameHint('فقط حروف لاتین، اعداد و آندرلاین');
            return;
        }

        setUsernameStatus('checking');
        setUsernameHint('در حال بررسی...');

        if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        checkTimerRef.current = window.setTimeout(async () => {
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_IS_DEV_ENVIRONMENT === 'true' ? import.meta.env.VITE_DEV_API_URL : import.meta.env.VITE_PROD_API_URL}/auth/username-available?username=${encodeURIComponent(trimmed)}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'ngrok-skip-browser-warning': 'true',
                        },
                    }
                );
                
                if (!response.ok) {
                    setUsernameStatus('invalid');
                    setUsernameHint('بررسی نام کاربری ممکن نشد');
                    return;
                }
                
                const res = await response.json();
                if (res?.available) {
                    setUsernameStatus('available');
                    setUsernameHint('نام کاربری قابل استفاده است');
                } else {
                    setUsernameStatus('taken');
                    setUsernameHint('این نام کاربری قبلاً گرفته شده');
                }
            } catch {
                setUsernameStatus('invalid');
                setUsernameHint('بررسی نام کاربری ممکن نشد');
            }
        }, 350);

        return () => {
            if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        };
    }, [username, step]);

    // Update step and navigate
    const setStep = (newStep: Step) => {
        setStepState(newStep);
        if (newStep === 'email') {
            navigate('/register/email', { replace: true });
        } else if (newStep === 'code') {
            navigate('/register/verify', { replace: true });
        } else if (newStep === 'details') {
            navigate('/register/complete', { replace: true });
        }
    };

    // Farsi error messages
    const getErrorMessage = (err: any): string => {
        const message = err.message || '';
        
        if (message.includes('409') || message.includes('already exists') || message.includes('already registered')) {
            return 'این ایمیل قبلاً ثبت شده است';
        }
        if (message.includes('Invalid email')) {
            return 'فرمت ایمیل نامعتبر است';
        }
        if (message.includes('Invalid') && message.includes('code')) {
            return 'کد تأیید نامعتبر است';
        }
        if (message.includes('expired')) {
            return 'کد تأیید منقضی شده است';
        }
        if (message.includes('Username') && (message.includes('409') || message.includes('taken') || message.includes('exists'))) {
            return 'این نام کاربری قبلاً گرفته شده است';
        }
        if (message.includes('Network') || message.includes('fetch')) {
            return 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید';
        }
        if (message.includes('400')) {
            return 'درخواست نامعتبر است';
        }
        if (message.includes('500')) {
            return 'خطای سرور. لطفاً بعداً تلاش کنید';
        }
        
        return 'خطای نامشخص. لطفاً دوباره تلاش کنید';
    };

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Manual validation
        if (!email) {
            setError('لطفاً ایمیل خود را وارد کنید');
            return;
        }
        if (!email.includes('@')) {
            setError('لطفاً یک آدرس ایمیل معتبر وارد کنید');
            return;
        }

        setLoading(true);

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            // Save email and move to next step WITHOUT showing success here
            sessionStorage.setItem('register_email', email);
            setStep('code');
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleCodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Manual validation
        if (!code || code.length !== 6) {
            setError('لطفاً کد 6 رقمی را وارد کنید');
            return;
        }

        setLoading(true);

        try {
            await apiFetch('/auth/register/verify', {
                method: 'POST',
                body: JSON.stringify({ email, code }),
            });

            setStep('details');
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDetailsSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Manual validation
        if (!name) {
            setError('لطفاً نام خود را وارد کنید');
            return;
        }
        if (!username) {
            setError('لطفاً نام کاربری خود را وارد کنید');
            return;
        }
        if (usernameStatus !== 'available') {
            setError('لطفاً یک نام کاربری معتبر و در دسترس وارد کنید');
            return;
        }
        if (!password) {
            setError('لطفاً رمز عبور خود را وارد کنید');
            return;
        }
        if (password.length < 6) {
            setError('رمز عبور باید حداقل 6 کاراکتر باشد');
            return;
        }
        if (password !== confirmPassword) {
            setError('رمز عبور و تکرار آن یکسان نیستند');
            return;
        }

        setLoading(true);

        try {
            const data = await apiFetch('/auth/register/complete', {
                method: 'POST',
                body: JSON.stringify({ email, name, username: username.trim(), password, deviceName: detectDeviceName() }),
            });

            // Clear sessionStorage
            sessionStorage.removeItem('register_email');
            
            localStorage.setItem('token', data.token);
            onRegisterSuccess(data.user, data.token);
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleResendCode = async () => {
        setLoading(true);
        setError('');

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            // Show temporary success
            const originalError = error;
            setError('');
            setTimeout(() => setError(originalError), 3000);
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleBackToLogin = () => {
        sessionStorage.removeItem('register_email');
        onBackToLogin();
    };

    return (
        <div className="login-page">
            <div className="login-page__dark-toggle">
                <DarkModeToggle themeMode={themeMode} onToggle={handleToggleTheme} />
            </div>
            
            <div className="login-container">
                <div className="login-header">
                    <UserPlus size={48} strokeWidth={1.5} className="login-header-icon" />
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
                                <Mail size={16} />
                                ایمیل
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setError('');
                                }}
                                placeholder="example@gmail.com"
                                autoFocus
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال ارسال...' : 'ارسال کد تأیید'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={handleBackToLogin}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} />
                            بازگشت به ورود
                        </button>
                    </form>
                )}

                {/* Step 2: Verification Code */}
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
                                onChange={(e) => {
                                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                                    setError('');
                                }}
                                placeholder="123456"
                                maxLength={6}
                                autoFocus
                            />
                        </div>

                        <div className="success-message">
                            <CheckCircle size={20} />
                            <div>
                                <div>کد تأیید به ایمیل {email} ارسال شد</div>
                                <div className="info-message" style={{ marginTop: '8px', padding: '8px 10px', marginBottom: 0 }}>
                                    <AlertCircle size={16} />
                                    <span>اگر ایمیل دریافت نکردید، پوشه هرزنامه را بررسی کنید</span>
                                </div>
                            </div>
                        </div>

                        {error && <div className="error-message">{error}</div>}

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
                            <ArrowLeft size={16} />
                            تغییر ایمیل
                        </button>
                    </form>
                )}

                {/* Step 3: User Details */}
                {step === 'details' && (
                    <form onSubmit={handleDetailsSubmit}>
                        <div className="form-group">
                            <label>
                                <UserIcon size={16} />
                                نام
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    setError('');
                                }}
                                placeholder="نام خود را وارد کنید"
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <UserIcon size={16} />
                                نام کاربری
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''));
                                    setError('');
                                }}
                                placeholder="username123"
                                maxLength={32}
                            />
                            {!!usernameHint && (
                                <small style={{
                                    color: usernameStatus === 'available' ? 'var(--accent-hover)' :
                                           usernameStatus === 'taken' || usernameStatus === 'invalid' ? '#dc2626' : '#6b7280',
                                    fontSize: '12px',
                                    marginTop: '5px',
                                    display: 'block',
                                    direction: 'rtl',
                                    textAlign: 'right'
                                }}>
                                    {usernameHint}
                                </small>
                            )}
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} />
                                رمز عبور
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} />
                                تکرار رمز عبور
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <button 
                            type="submit" 
                            className="login-btn" 
                            disabled={loading || usernameStatus !== 'available'}
                        >
                            {loading ? 'در حال ثبت نام...' : 'ثبت نام'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => setStep('code')}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} />
                            بازگشت
                        </button>
                    </form>
                )}

                <div className="login-footer">
                    قبلاً ثبت نام کرده‌اید؟{' '}
                    <button onClick={handleBackToLogin}>وارد شوید</button>
                </div>
            </div>
        </div>
    );
}
