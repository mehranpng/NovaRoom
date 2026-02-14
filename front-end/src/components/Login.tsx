import { useState } from 'react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { LogIn } from 'lucide-react';

interface LoginProps {
    onLoginSuccess: (user: User, token: string) => void;
    onRegisterClick: () => void;
    onForgotPasswordClick: () => void;
}

export function Login({ onLoginSuccess, onRegisterClick, onForgotPasswordClick }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Farsi error messages
    const getErrorMessage = (err: any): string => {
        const message = err.message || '';
        
        // Authentication errors
        if (message.includes('401') || message.includes('Unauthorized') || 
            message.includes('Invalid credentials') || message.includes('incorrect')) {
            return 'ایمیل یا رمز عبور نامعتبر است';
        }
        if (message.includes('404') || message.includes('not found') || message.includes('User not found')) {
            return 'کاربری با این ایمیل یافت نشد';
        }
        if (message.includes('Invalid email')) {
            return 'فرمت ایمیل نامعتبر است';
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
        
        return 'ایمیل یا رمز عبور نامعتبر است';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const data = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
            });

            localStorage.setItem('token', data.token);
            onLoginSuccess(data.user, data.token);
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <LogIn size={48} strokeWidth={1.5} />
                    <h1>نوا روم</h1>
                    <p>برای ادامه وارد شوید</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>ایمیل</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="example@gmail.com"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>رمز عبور</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? 'در حال ورود...' : 'ورود'}
                    </button>
                </form>

                <div className="login-footer">
                    رمز عبور خود را فراموش کرده‌اید؟{' '}
                    <button onClick={onForgotPasswordClick}>بازیابی رمز عبور</button>
                </div>

                <div className="login-footer" style={{ marginTop: '12px' }}>
                    حساب کاربری ندارید؟{' '}
                    <button onClick={onRegisterClick}>ثبت نام کنید</button>
                </div>
            </div>
        </div>
    );
}
