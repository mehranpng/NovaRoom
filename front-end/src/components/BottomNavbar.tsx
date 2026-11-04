import { AnimatePresence, motion } from 'framer-motion';
import { cx } from '../utils/cx';
import { useNow } from '../hooks/useNow';
import { formatDeletionRemaining } from '../utils/deletionTimer';
import { Avatar } from './Avatar';
import type { User } from '../types';

export function PlumpyBotIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="M19,21H5c-1.657,0-3-1.343-3-3V8c0-1.657,1.343-3,3-3h14c1.657,0,3,1.343,3,3v10C22,19.657,20.657,21,19,21z" opacity=".35" fill="currentColor" />
            <rect width="2" height="2" x="11" y="3" fill="currentColor" />
            <circle cx="12" cy="2" r="2" fill="currentColor" />
            <path d="M22,16v-6c1.105,0,2,0.895,2,2v2C24,15.105,23.105,16,22,16z" fill="currentColor" />
            <path d="M2,10v6c-1.105,0-2-0.895-2-2v-2C0,10.895,0.895,10,2,10z" fill="currentColor" />
            <circle cx="16" cy="12" r="2" fill="currentColor" />
            <circle cx="8" cy="12" r="2" fill="currentColor" />
            <path d="M12,18c-0.552,0-1,0.448-1,1v2h2v-2C13,18.448,12.552,18,12,18z" fill="currentColor" />
            <path d="M16,18c-0.552,0-1,0.448-1,1v2h2v-2C17,18.448,16.552,18,16,18z" fill="currentColor" />
            <path d="M8,18c-0.552,0-1,0.448-1,1v2h2v-2C9,18.448,8.552,18,8,18z" fill="currentColor" />
        </svg>
    );
}

export function PlumpyChatIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="M19,3H5C3.343,3,2,4.343,2,6v13v0.828c0,1.746,1.974,2.762,3.395,1.747l2.822-2.016 C8.726,19.195,9.336,19,9.961,19H19c1.657,0,3-1.343,3-3V6C22,4.343,20.657,3,19,3z" opacity=".35" fill="currentColor" />
            <path d="M15,10H9c-0.553,0-1-0.448-1-1s0.447-1,1-1h6c0.553,0,1,0.448,1,1S15.553,10,15,10z" fill="currentColor" />
            <path d="M13,14H9c-0.553,0-1-0.448-1-1s0.447-1,1-1h4c0.553,0,1,0.448,1,1S13.553,14,13,14z" fill="currentColor" />
        </svg>
    );
}

export function PlumpyChessIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="M18.5,18c-0.176,0-12.824,0-13,0C4.672,18,4,18.672,4,19.5S4.672,21,5.5,21c0.176,0,12.824,0,13,0c0.828,0,1.5-0.672,1.5-1.5S19.328,18,18.5,18z" fill="currentColor" />
            <path d="M18,18v-0.025c0-1.151-0.612-2.199-1.582-2.819C14.953,14.219,13,12.5,13,10h3c1.105,0,2-0.895,2-2v0c0-0.63-0.296-1.222-0.8-1.6L14,4l0-0.921c0-0.606-0.537-1.084-1.137-0.999C8.983,2.632,6,5.968,6,10v8H18z" opacity=".35" fill="currentColor" />
        </svg>
    );
}

export function PlumpySettingsIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path d="M16,18.928c0.678-0.391,1.459-0.424,2.135-0.164c0.564,0.217,1.209,0.037,1.592-0.43c0.683-0.833,1.234-1.778,1.621-2.805c0.221-0.587,0.012-1.232-0.467-1.638C20.342,13.437,20,12.761,20,12c0-0.761,0.342-1.437,0.88-1.893c0.479-0.406,0.689-1.05,0.467-1.638c-0.387-1.026-0.937-1.972-1.621-2.805c-0.383-0.467-1.028-0.647-1.592-0.43C17.459,5.496,16.678,5.463,16,5.072c-0.68-0.393-1.1-1.056-1.21-1.775c-0.09-0.588-0.556-1.058-1.143-1.158C13.111,2.048,12.561,2,12,2s-1.111,0.048-1.647,0.139C9.766,2.239,9.301,2.709,9.21,3.297C9.1,4.016,8.68,4.679,8,5.072C7.322,5.463,6.541,5.496,5.865,5.235c-0.564-0.217-1.209-0.037-1.592,0.43C3.59,6.498,3.04,7.443,2.653,8.47C2.431,9.057,2.641,9.702,3.12,10.107C3.658,10.563,4,11.239,4,12c0,0.761-0.342,1.437-0.88,1.893c-0.479,0.406-0.689,1.05-0.467,1.638c0.387,1.026,0.937,1.972,1.621,2.805c0.383,0.467,1.028,0.647,1.592,0.43C6.541,18.504,7.322,18.537,8,18.928c0.68,0.393,1.1,1.056,1.21,1.775c0.09,0.588,0.556,1.058,1.143,1.158C10.889,21.952,11.439,22,12,22s1.111-0.048,1.647-0.139c0.587-0.099,1.053-0.569,1.143-1.158C14.9,19.984,15.32,19.321,16,18.928z" opacity=".35" fill="currentColor" />
            <path d="M12,8c-2.209,0-4,1.791-4,4s1.791,4,4,4s4-1.791,4-4S14.209,8,12,8z" fill="currentColor" />
        </svg>
    );
}

export function PlumpyUserIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <circle cx="12" cy="7" r="5" opacity=".35" fill="currentColor" />
            <path d="M18,15H6c-1.657,0-3,1.343-3,3c0,1.657,1.343,3,3,3h12c1.657,0,3-1.343,3-3C21,16.343,19.657,15,18,15z" fill="currentColor" />
        </svg>
    );
}

export interface BottomNavbarProps {
    activeTab: 'ai' | 'chess' | 'chats' | 'settings' | 'profile';
    onSelectTab: (tab: 'ai' | 'chess' | 'chats' | 'settings' | 'profile') => void;
    currentUser?: User | null;
    hasUnseenSettings?: boolean;
    deletionScheduledFor?: number | null;
}

export function BottomNavbar({ activeTab, onSelectTab, currentUser, hasUnseenSettings, deletionScheduledFor }: BottomNavbarProps) {
    const now = useNow(Boolean(deletionScheduledFor));
    const deletionRemaining = deletionScheduledFor ? formatDeletionRemaining(deletionScheduledFor, now) : '';

    return (
        <>
            <div className="bottom-navbar-scrim" aria-hidden="true" />
            <nav className="bottom-navbar" aria-label="ناوبری اصلی">
                <button
                    type="button"
                    className={cx('bottom-navbar__tab', activeTab === 'ai' && 'bottom-navbar__tab--active')}
                    onClick={() => onSelectTab('ai')}
                    aria-label="Nova AI"
                >
                    <AnimatePresence>
                        {activeTab === 'ai' && (
                            <motion.span
                                key="pill-ai"
                                className="bottom-navbar__pill"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                            />
                        )}
                    </AnimatePresence>
                    <span className="bottom-navbar__icon">
                        <PlumpyBotIcon />
                    </span>
                </button>

                <button
                    type="button"
                    className={cx('bottom-navbar__tab', activeTab === 'chess' && 'bottom-navbar__tab--active')}
                    onClick={() => onSelectTab('chess')}
                    aria-label="شطرنج"
                >
                    <AnimatePresence>
                        {activeTab === 'chess' && (
                            <motion.span
                                key="pill-chess"
                                className="bottom-navbar__pill"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                            />
                        )}
                    </AnimatePresence>
                    <span className="bottom-navbar__icon">
                        <PlumpyChessIcon />
                    </span>
                </button>

                <button
                    type="button"
                    className={cx('bottom-navbar__tab', activeTab === 'chats' && 'bottom-navbar__tab--active')}
                    onClick={() => onSelectTab('chats')}
                    aria-label="پیام‌ها"
                >
                    <AnimatePresence>
                        {activeTab === 'chats' && (
                            <motion.span
                                key="pill-chats"
                                className="bottom-navbar__pill"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                            />
                        )}
                    </AnimatePresence>
                    <span className="bottom-navbar__icon">
                        <PlumpyChatIcon />
                    </span>
                </button>

                <button
                    type="button"
                    className={cx('bottom-navbar__tab', activeTab === 'settings' && 'bottom-navbar__tab--active')}
                    onClick={() => onSelectTab('settings')}
                    aria-label="تنظیمات"
                >
                    <AnimatePresence>
                        {activeTab === 'settings' && (
                            <motion.span
                                key="pill-settings"
                                className="bottom-navbar__pill"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                            />
                        )}
                    </AnimatePresence>
                    <span className="bottom-navbar__icon" style={{ position: 'relative' }}>
                        <PlumpySettingsIcon />
                        {deletionScheduledFor ? (
                            <span
                                className="bottom-navbar__deletion"
                                role="status"
                                aria-label={`حذف حساب تا ${deletionRemaining} دیگر`}
                            >
                                {deletionRemaining}
                            </span>
                        ) : hasUnseenSettings ? (
                            <span className="bottom-navbar__badge" />
                        ) : null}
                    </span>
                </button>

                <button
                    type="button"
                    className={cx('bottom-navbar__tab', activeTab === 'profile' && 'bottom-navbar__tab--active')}
                    onClick={() => onSelectTab('profile')}
                    aria-label="پروفایل"
                >
                    <AnimatePresence>
                        {activeTab === 'profile' && (
                            <motion.span
                                key="pill-profile"
                                className="bottom-navbar__pill"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                            />
                        )}
                    </AnimatePresence>
                    <span className="bottom-navbar__icon bottom-navbar__icon--avatar">
                        {currentUser ? (
                            <Avatar
                                name={currentUser.name}
                                size="xs"
                                src={currentUser.avatar}
                            />
                        ) : (
                            <PlumpyUserIcon />
                        )}
                    </span>
                </button>
            </nav>
        </>
    );
}
