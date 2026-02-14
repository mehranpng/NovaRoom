import { useState, useRef } from 'react';
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

    const emailRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);

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
            setError(err.message || 'ایمیل یا رمز عبور نامعتبر است');
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
                            ref={emailRef}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="example@gmail.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>رمز عبور</label>
                        <input
                            ref={passwordRef}
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
