import { Check } from 'lucide-react';

interface VerifiedBadgeProps {
    verified?: boolean;
    className?: string;
}

export function VerifiedBadge({ verified = false, className }: VerifiedBadgeProps) {
    if (!verified) return null;

    return (
        <span
            className={className ? `verified-badge ${className}` : 'verified-badge'}
            aria-label="Verified account"
            title="Verified account"
        >
            <Check size={10} strokeWidth={3} />
        </span>
    );
}
