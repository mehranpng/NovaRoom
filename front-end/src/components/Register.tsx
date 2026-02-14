import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { UserPlus, ArrowLeft, Mail, Key, User as UserIcon, CheckCircle, AlertCircle } from 'lucide-react';

interface RegisterProps {
    onRegisterSuccess: (user: User, token: string) => void;
    onBackToLogin: () => void;
}

type Step = 'email' | 'code' | 'details';
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function Register({ onRegisterSuccess, onBackToLogin }: RegisterProps) {
    const navigate = useNavigate();
    const location = useLocation();
    
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
    const [success, setSuccess] = useState('');

    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [usernameHint, setUsernameHint] = useState<string>('');
    const checkTimerRef = useRef<number | null>(null);

    // Prevent page refresh/unload
    useEffect(() => {
        const preventUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = ''; // Chrome requires returnValue to be set
        };

        const preventPageHide = (e: PageTransitionEvent) => {
            if (!e.persisted) {
                e.preventDefault();
            }
        };

        // Add listeners
        window.addEventListener('beforeunload', preventUnload);
        window.addEventListener('pagehide', preventPageHide);

        return () => {
            window.removeEventListener('beforeunload', preventUnload);
            window.removeEventListener('pagehide', preventPageHide);
        };
    }, []);

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
                // Use PUBLIC endpoint without authentication
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
        
        // Email errors
        if (message.includes('409') || message.includes('already exists') || message.includes('already registered')) {
            return 'این ایمیل قبلاً ثبت شده است';
        }
        if (message.includes('Invalid email')) {
            return 'فرمت ایمیل نامعتبر است';
        }
        
        // Code errors
        if (message.includes('Invalid') && message.includes('code')) {
            return 'کد تأیید نامعتبر است';
        }
        if (message.includes('expired')) {
            return 'کد تأیید منقضی شده است';
        }
        
        // Username errors
        if (message.includes('Username') && (message.includes('409') || message.includes('taken') || message.includes('exists'))) {
            return 'این نام کاربری قبلاً گرفته شده است';
        }
        
        // Network errors
        if (message.includes('Network') || message.includes('fetch')) {
            return 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید';
        }
        
        // Generic errors
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
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            // Save email to sessionStorage
            sessionStorage.setItem('register_email', email);
            
            setSuccess(`کد تأیید به ایمیل ${email} ارسال شد`);
            setTimeout(() => {
                setStep('code');
            }, 1500);
        } catch (err: any) {
            setError(getErrorMessage(err));
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
            setTimeout(() => {
                setStep('details');
            }, 1200);
        } catch (err: any) {
            setError(getErrorMessage(err));
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

        // Validate username status
        if (usernameStatus !== 'available') {
            setError('لطفاً یک نام کاربری معتبر و در دسترس وارد کنید');
            return;
        }

        setLoading(true);

        try {
            const data = await apiFetch('/auth/register/complete', {
                method: 'POST',
                body: JSON.stringify({ email, name, username: username.trim(), password }),
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
        setSuccess('');

        try {
            await apiFetch('/auth/register/email', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            setSuccess(`کد تأیید مجدداً به ایمیل ${email} ارسال شد`);
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
                                <Mail size={16} />
                                ایمیل
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="example@gmail.com"
                                required
                                autoFocus
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}
                        {success && (
                            <div className="success-message">
                                <CheckCircle size={20} />
                                <div>
                                    <div>{success}</div>
                                    <div className="info-message" style={{ marginTop: '8px', padding: '8px 10px' }}>
                                        <AlertCircle size={16} />
                                        <span>اگر ایمیل دریافت نکردید، پوشه هرزنامه را بررسی کنید</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال ارسال...' : 'ارسال کد تأیید'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={handleBackToLogin}
                            style={{ marginTop: '10px' }}
                        >
                            <ArrowLeft size={16} style={{ marginLeft: '5px' }} />
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
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="123456"
                                maxLength={6}
                                required
                                autoFocus
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
                            <ArrowLeft size={16} style={{ marginLeft: '5px' }} />
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
                                onChange={(e) => setName(e.target.value)}
                                placeholder="نام خود را وارد کنید"
                                required
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
                                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                                placeholder="username123"
                                maxLength={32}
                                required
                            />
                            {!!usernameHint && (
                                <small style={{
                                    color: usernameStatus === 'available' ? '#16a34a' :
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
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                minLength={6}
                                required
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
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                                minLength={6}
                                required
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}
                        {success && (
                            <div className="success-message">
                                <CheckCircle size={20} />
                                {success}
                            </div>
                        )}

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
                            <ArrowLeft size={16} style={{ marginLeft: '5px' }} />
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
