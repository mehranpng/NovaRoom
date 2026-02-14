import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../config/api';
import { KeyRound, ArrowLeft, Mail, Key, CheckCircle, AlertCircle } from 'lucide-react';

interface ForgotPasswordProps {
    onBackToLogin: () => void;
    onResetSuccess: () => void;
}

type Step = 'email' | 'reset';

export function ForgotPassword({ onBackToLogin, onResetSuccess }: ForgotPasswordProps) {
    const navigate = useNavigate();
    const location = useLocation();
    
    // Determine step from URL path
    const getStepFromPath = (): Step => {
        if (location.pathname.includes('/reset')) return 'reset';
        return 'email';
    };

    const [step, setStepState] = useState<Step>(getStepFromPath());
    const [email, setEmail] = useState(() => sessionStorage.getItem('forgot_email') || '');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Sync step with URL on mount and location change
    useEffect(() => {
        const newStep = getStepFromPath();
        setStepState(newStep);
        
        // Restore email from sessionStorage if on reset step
        const savedEmail = sessionStorage.getItem('forgot_email');
        if (savedEmail && newStep === 'reset') {
            setEmail(savedEmail);
        }
    }, [location.pathname]);

    // Update step and navigate
    const setStep = (newStep: Step) => {
        setStepState(newStep);
        if (newStep === 'email') {
            navigate('/forgot-password/request', { replace: true });
        } else if (newStep === 'reset') {
            navigate('/forgot-password/reset', { replace: true });
        }
    };

    // Farsi error messages
    const getErrorMessage = (err: any): string => {
        const message = err.message || '';
        
        if (message.includes('404') || message.includes('not found') || message.includes('User not found')) {
            return 'کاربری با این ایمیل یافت نشد';
        }
        if (message.includes('Invalid email')) {
            return 'فرمت ایمیل نامعتبر است';
        }
        if (message.includes('Invalid') && message.includes('code')) {
            return 'کد بازیابی نامعتبر است';
        }
        if (message.includes('expired')) {
            return 'کد بازیابی منقضی شده است';
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
            await apiFetch('/auth/password-reset/request', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            // Save email and move to next step WITHOUT showing success here
            sessionStorage.setItem('forgot_email', email);
            setStep('reset');
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Manual validation
        if (!code || code.length !== 6) {
            setError('لطفاً کد 6 رقمی را وارد کنید');
            return;
        }
        if (!newPassword) {
            setError('لطفاً رمز عبور جدید خود را وارد کنید');
            return;
        }
        if (newPassword.length < 6) {
            setError('رمز عبور باید حداقل 6 کاراکتر باشد');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('رمز عبور جدید و تکرار آن یکسان نیستند');
            return;
        }

        setLoading(true);

        try {
            await apiFetch('/auth/password-reset/verify', {
                method: 'POST',
                body: JSON.stringify({ email, code, new_password: newPassword }),
            });

            // Clear sessionStorage
            sessionStorage.removeItem('forgot_email');
            
            // Redirect to login immediately
            onResetSuccess();
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
            await apiFetch('/auth/password-reset/request', {
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
        sessionStorage.removeItem('forgot_email');
        onBackToLogin();
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <KeyRound size={48} strokeWidth={1.5} />
                    <h1>بازیابی رمز عبور</h1>
                    <p>
                        {step === 'email' && 'ایمیل خود را وارد کنید'}
                        {step === 'reset' && 'کد بازیابی و رمز جدید را وارد کنید'}
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
                            {loading ? 'در حال ارسال...' : 'ارسال کد بازیابی'}
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

                {/* Step 2: Reset Password */}
                {step === 'reset' && (
                    <form onSubmit={handleResetSubmit}>
                        <div className="form-group">
                            <label>
                                <Key size={16} />
                                کد بازیابی 6 رقمی
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
                                <div>کد بازیابی به ایمیل {email} ارسال شد</div>
                                <div className="info-message" style={{ marginTop: '8px', padding: '8px 10px', marginBottom: 0 }}>
                                    <AlertCircle size={16} />
                                    <span>اگر ایمیل دریافت نکردید، پوشه هرزنامه را بررسی کنید</span>
                                </div>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} />
                                رمز عبور جدید
                            </label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => {
                                    setNewPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <Key size={16} />
                                تکرار رمز عبور جدید
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

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال تغییر...' : 'تغییر رمز عبور'}
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

                <div className="login-footer">
                    رمز عبور خود را به یاد آوردید؟{' '}
                    <button onClick={handleBackToLogin}>وارد شوید</button>
                </div>
            </div>
        </div>
    );
}
