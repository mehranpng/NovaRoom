import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import DotGrid from './DotGrid';
import { useDarkMode } from '../hooks/useDarkMode';

export function EmptyState() {
    const { isDarkMode, themePalette, themeTone, accentIntensity } = useDarkMode();
    const [colors, setColors] = useState({ base: '#9ca3af', active: '#2563eb' });

    useEffect(() => {
        // We need to get the computed values of the CSS variables 
        // because the DotGrid canvas drawing needs actual hex/rgb values.
        const root = document.documentElement;
        const computed = getComputedStyle(root);

        // Using a more subtle color for the base dots
        const base = computed.getPropertyValue('--text-tertiary').trim() || '#9ca3af';
        const active = computed.getPropertyValue('--accent-primary').trim() || '#2563eb';

        setColors({ base, active });
    }, [isDarkMode, themePalette, themeTone, accentIntensity]);

    return (
        <div className="empty-state">
            <div className="empty-state__background">
                <DotGrid
                    dotSize={3}
                    gap={18}
                    baseColor={colors.base}
                    activeColor={colors.active}
                    proximity={120}
                    shockRadius={180}
                    shockStrength={5}
                    resistance={750}
                    returnDuration={1.5}
                />
            </div>
            <div className="empty-state__content">
                <div className="empty-state__icon">
                    <MessageCircle size={32} />
                </div>
                <h2 className="empty-state__title">به نوا روم خوش آمدید</h2>
                <p className="empty-state__description">برای شروع صحبت یک گفتگو انتخاب کنید یا کاربری را جستوجو کنید.</p>
                
                <div className="empty-state__footer">
                    <span className="empty-state__dot" />
                    رمزگذاری سرتاسری
                </div>
            </div>
        </div>
    );

}
