import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import './admin/admin.css';

interface PasswordFieldProps {
    label: string;
    icon?: ReactNode;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoComplete?: string;
    autoFocus?: boolean;
}

export function PasswordField({ label, icon, value, onChange, placeholder, autoComplete, autoFocus }: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="adm-field">
            <label className="adm-label">
                {icon}
                {label}
            </label>
            <div className="adm-password-wrap">
                <input
                    className="adm-input"
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    autoFocus={autoFocus}
                />
                <button
                    type="button"
                    className="adm-eye adm-tap"
                    onClick={() => setVisible((prev) => !prev)}
                    aria-label={visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                    aria-pressed={visible}
                >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
        </div>
    );
}
