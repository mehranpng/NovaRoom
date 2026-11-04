import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, Menu, Settings as SettingsIcon, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MutableRefObject, ReactElement } from 'react';
import { screenVariants } from '../../utils/screenMotion';
import { cx } from '../../utils/cx';
import { AdminUsersSection } from './AdminUsersSection';
import { AdminRegistrationSection } from './AdminRegistrationSection';
import './admin.css';

interface AdminPanelProps {
    section: string;
    onSectionChange: (section: string) => void;
    onBack: () => void;
}

type AdminSectionComponent = (props: { backRef: MutableRefObject<() => boolean> }) => ReactElement;

const adminSections: { id: string; label: string; icon: LucideIcon; Component: AdminSectionComponent }[] = [
    { id: 'settings', label: 'تنظیمات', icon: SettingsIcon, Component: AdminRegistrationSection },
    { id: 'users', label: 'کاربران', icon: Users, Component: AdminUsersSection },
];

export function AdminPanel({ section, onSectionChange, onBack }: AdminPanelProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const hamburgerRef = useRef<HTMLButtonElement>(null);
    const firstItemRef = useRef<HTMLButtonElement>(null);
    const backRef = useRef<() => boolean>(() => false);

    const activeSection = adminSections.find((item) => item.id === section) ?? adminSections[0];

    useEffect(() => {
        if (!menuOpen) return;
        firstItemRef.current?.focus();
        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setMenuOpen(false);
            hamburgerRef.current?.focus();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [menuOpen]);

    const closeMenu = () => {
        setMenuOpen(false);
        hamburgerRef.current?.focus();
    };

    const handleBack = () => {
        if (backRef.current()) return;
        onBack();
    };

    const ActiveComponent = activeSection.Component;

    return (
        <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="profile__header">
                <div className="profile__header-side">
                    <button
                        type="button"
                        onClick={handleBack}
                        className="profile__header-back back-icon-btn adm-tap"
                        aria-label="بازگشت"
                    >
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">{activeSection.label}</h1>
                <div className="profile__header-actions">
                    <button
                        ref={hamburgerRef}
                        type="button"
                        onClick={() => setMenuOpen((prev) => !prev)}
                        className="profile__header-back back-icon-btn adm-tap"
                        aria-label="منوی بخش‌ ها"
                        aria-expanded={menuOpen}
                    >
                        <Menu size={20} />
                    </button>
                </div>
            </div>

            <motion.div
                key={activeSection.id}
                className="adm-section"
                variants={screenVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
            >
                <ActiveComponent backRef={backRef} />
            </motion.div>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        key="backdrop"
                        className="adm-menu-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        onClick={closeMenu}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        key="menu"
                        className="adm-menu"
                        role="menu"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        {adminSections.map((item, index) => (
                            <button
                                key={item.id}
                                ref={index === 0 ? firstItemRef : undefined}
                                type="button"
                                role="menuitem"
                                className={cx('adm-menu__item', 'adm-tap', item.id === activeSection.id && 'adm-menu__item--active')}
                                onClick={() => {
                                    onSectionChange(item.id);
                                    closeMenu();
                                }}
                            >
                                <item.icon size={18} />
                                {item.label}
                                {item.id === activeSection.id && <Check size={16} className="adm-menu__check" />}
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
