import { useState, useRef } from 'react';
import { apiFetch } from '../config/api';
import { KeyRound, ArrowLeft, Mail, Key } from 'lucide-react';

interface ForgotPasswordProps {
    onBackToLogin: () => void;
    onResetSuccess: () => void;
}

type Step = 'email' | 'reset';

export function ForgotPassword({ onBackToLogin, onResetSuccess }: ForgotPasswordProps) {
    const [step, setStep] = useState<Step>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const emailRef = useRef<HTMLInputElement | null>(null);
    const codeRef = useRef<HTMLInputElement | null>(null);
    const newPasswordRef = useRef<HTMLInputElement | null>(null);
    const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await apiFetch('/auth/password-reset/request', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            setSuccess('کد بازیابی به ایمیل شما ارسال شد');
            setStep('reset');
        } catch (err: any) {
            setError(err.message || 'خطا در ارسال کد بازیابی');
        } finally {
            setLoading(false);
        }
    };

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Validate passwords match
        if (newPassword !== confirmPassword) {
            setError('رمز عبور جدید و تکرار آن یکسان نیستند');
            return;
        }

        // Validate password length
        if (newPassword.length < 6) {
            setError('رمز عبور باید حداقل 6 کاراکتر باشد');
            return;
        }

        setLoading(true);

        try {
            await apiFetch('/auth/password-reset/verify', {
                method: 'POST',
                body: JSON.stringify({ email, code, new_password: newPassword }),
            });

            setSuccess('رمز عبور با موفقیت تغییر کرد');
            setTimeout(() => {
                onResetSuccess();
            }, 2000);
        } catch (err: any) {
            if (err.message.includes('400')) {
                setError('کد بازیابی نامعتبر یا منقضی شده است');
            } else if (err.message.includes('404')) {
                setError('کاربر پیدا نشد');
            } else {
                setError(err.message || 'خطا در بازیابی رمز عبور');
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
            await apiFetch('/auth/password-reset/request', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });

            setSuccess('کد بازیابی مجدداً به ایمیل شما ارسال شد');
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
                            {loading ? 'در حال ارسال...' : 'ارسال کد بازیابی'}
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

                {/* Step 2: Reset Password */}
                {step === 'reset' && (
                    <form onSubmit={handleResetSubmit}>
                        <div className="form-group">
                            <label>
                                <Key size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                کد بازیابی 6 رقمی
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

                        <div className="form-group">
                            <label>
                                <Key size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                                رمز عبور جدید
                            </label>
                            <input
                                ref={newPasswordRef}
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        newPasswordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                                تکرار رمز عبور جدید
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
                            <ArrowLeft size={16} style={{ display: 'inline', marginLeft: '5px' }} />
                            تغییر ایمیل
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
