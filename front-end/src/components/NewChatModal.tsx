import { useState, useEffect, useCallback } from 'react';
import { Search, Users, Link as LinkIcon, ChevronLeft, Copy, CheckCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';

interface NewChatScreenProps {
    onClose: () => void;
    onUserSelected: (user: User) => void;
    onCreateGroup: (groupName: string) => Promise<any> | any;
    onJoinGroup: (inviteCode: string) => Promise<void> | void;
    currentUser?: User | null;
}

interface OwnedGroup {
    chatId: string;
    name: string;
    inviteCode: string;
    inviteLink: string;
}

const navigationTabTransition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

const surfaceStyle = {
    border: '1px solid var(--border-primary)',
    background: 'var(--bg-secondary)',
    borderRadius: 20,
} as const;

const textDirection = (value: string): 'rtl' | 'ltr' =>
    value && /^[\x00-\x7F]*$/.test(value) ? 'ltr' : 'rtl';

const extractInviteCode = (rawValue: string): string => {
    const value = rawValue.trim();
    if (!value) return '';

    const deepLink = value.match(/(?:senoroom|novaroom):\/\/group\/([a-zA-Z0-9]+)/);
    if (deepLink?.[1]) return deepLink[1];

    const urlLink = value.match(/\/group\/([a-zA-Z0-9]+)/);
    if (urlLink?.[1]) return urlLink[1];

    const fullLink = value.match(/groupInvite=([a-zA-Z0-9]+)/);
    if (fullLink?.[1]) return fullLink[1];

    return value;
};

export function NewChatModal({ onClose, onUserSelected, onCreateGroup, onJoinGroup, currentUser }: NewChatScreenProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'chat' | 'group'>('chat');
    const [groupName, setGroupName] = useState('');
    const [inviteInput, setInviteInput] = useState('');
    const [createdGroupLink, setCreatedGroupLink] = useState<string>('');
    const [copied, setCopied] = useState(false);
    const [creating, setCreating] = useState(false);
    const [joining, setJoining] = useState(false);
    const [groupError, setGroupError] = useState<string>('');
    const [joinError, setJoinError] = useState<string>('');
    const [ownedGroups, setOwnedGroups] = useState<OwnedGroup[]>([]);
    const [copiedGroup, setCopiedGroup] = useState<string>('');

    const loadOwnedGroups = useCallback(async () => {
        try {
            const groups = await apiFetch('/profile/groups');
            setOwnedGroups(Array.isArray(groups) ? groups : []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        void loadOwnedGroups();
    }, [loadOwnedGroups]);

    useEffect(() => {
        if (mode !== 'chat') return;

        const q = query.trim().replace(/^@+/, '');

        if (!q || q.length < 3) {
            setResults([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const search = async () => {
            try {
                const users = await apiFetch(`/users/search?query=${encodeURIComponent(q)}`);
                const usernameQuery = q.toLowerCase();
                const usernameOnly = (Array.isArray(users) ? users : []).filter((user: User) =>
                    String(user?.username || '').toLowerCase().includes(usernameQuery)
                );
                setResults(usernameOnly);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        const timeout = setTimeout(search, 300);
        return () => clearTimeout(timeout);
    }, [query, mode]);

    const handleSelectUser = (user: User) => {
        onUserSelected(user);
    };

    const handleCreateGroup = async () => {
        const normalized = groupName.trim();
        if (normalized.length < 3) {
            setGroupError('نام گروه باید حداقل ۳ کاراکتر باشد');
            return;
        }
        setGroupError('');
        setCreating(true);
        try {
            const res = await onCreateGroup(normalized);
            if (res?.inviteLink) {
                setCreatedGroupLink(res.inviteLink);
                setGroupName('');
            }
            if (res?.chatId) await loadOwnedGroups();
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : 'ساخت گروه با خطا مواجه شد');
        } finally {
            setCreating(false);
        }
    };

    const handleJoinGroup = async () => {
        const inviteCode = extractInviteCode(inviteInput);
        if (!inviteCode) {
            setJoinError('لینک یا کد دعوت گروه را وارد کنید');
            return;
        }
        setJoinError('');
        setJoining(true);
        try {
            await onJoinGroup(inviteCode);
        } catch (error) {
            setJoinError(error instanceof Error ? error.message : 'لینک دعوت نامعتبر است یا گروه یافت نشد');
        } finally {
            setJoining(false);
        }
    };

    const handleCopy = () => {
        void navigator.clipboard.writeText(createdGroupLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyGroupLink = (inviteLink: string, chatId: string) => {
        void navigator.clipboard.writeText(inviteLink);
        setCopiedGroup(chatId);
        setTimeout(() => setCopiedGroup(''), 2000);
    };

    const isAdmin = Boolean(currentUser?.adminLevel);
    const groupLimitLabel = isAdmin ? 'حداکثر ۳۰ گروه' : 'حداکثر ۲ گروه';
    const trimmedQuery = query.trim().replace(/^@+/, '');
    const searchDirection = textDirection(query.trim());
    const groupNameDirection = textDirection(groupName.trim());

    const tabs: Array<{ key: 'chat' | 'group'; label: string; icon: typeof Search }> = [
        { key: 'chat', label: 'چت خصوصی', icon: Search },
        { key: 'group', label: 'گروه', icon: Users },
    ];

    return (
        <motion.div
            className="profile new-chat-screen"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <div className="profile__header-side">
                    <button type="button" onClick={onClose} className="profile__header-back back-icon-btn" aria-label="بازگشت">
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">گفتگوی جدید</h1>
            </div>

            <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 68 }}>
                <div role="tablist" className="new-chat-screen__tabs">
                    {tabs.map(({ key, label, icon: Icon }) => {
                        const active = mode === key;
                        return (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setMode(key)}
                                className={`new-chat-screen__tab${active ? ' new-chat-screen__tab--active' : ''}`}
                            >
                                <Icon size={16} />
                                {label}
                            </button>
                        );
                    })}
                </div>

                <div className="new-chat-screen__panels">
                    {mode === 'chat' ? (
                        <motion.div
                            key="chat"
                            className="new-chat-screen__panel"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={navigationTabTransition}
                            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                        >
                            <div className="new-chat-screen__search" style={{ direction: searchDirection }}>
                                <Search size={18} />
                                <input
                                    type="text"
                                    inputMode="text"
                                    placeholder="جستجو با نام کاربری..."
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    style={{ direction: searchDirection, textAlign: searchDirection === 'rtl' ? 'right' : 'left' }}
                                />
                            </div>

                            <div className="new-chat-screen__results">
                                {loading ? (
                                    <div className="new-chat-screen__state">
                                        <span className="chat-range-loader" aria-hidden="true" />
                                        <span>در حال جستجو...</span>
                                    </div>
                                ) : results.length > 0 ? (
                                    <div className="new-chat-screen__list">
                                        {results.map((user) => (
                                            <button
                                                key={user.chatId}
                                                type="button"
                                                className="new-chat-screen__user"
                                                onClick={() => handleSelectUser(user)}
                                            >
                                                <Avatar name={user.name} size="md" online={user.online} src={user.avatar} />
                                                <span className="new-chat-screen__user-text">
                                                    <span className="new-chat-screen__user-name">
                                                        {user.name}
                                                        {user.verified ? <VerifiedBadge size={14} /> : null}
                                                    </span>
                                                    <span className="new-chat-screen__user-username">@{user.username}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="new-chat-screen__state">
                                        <Search size={22} style={{ opacity: 0.55 }} />
                                        <span>{trimmedQuery.length >= 3 ? 'کاربری یافت نشد' : 'نام کاربری مورد نظر را جستجو کنید'}</span>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="group"
                            className="new-chat-screen__panel"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={navigationTabTransition}
                            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                        >
                            <div style={{ ...surfaceStyle, padding: 16 }}>
                                <p className="profile__field-label" style={{ marginBottom: 10 }}>ساخت گروه ({groupLimitLabel})</p>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="text"
                                        className="profile__field-input"
                                        style={{ borderRadius: 9999, background: 'var(--bg-primary)', direction: groupNameDirection, textAlign: groupNameDirection === 'rtl' ? 'right' : 'left' }}
                                        placeholder="نام گروه"
                                        value={groupName}
                                        onChange={(e) => {
                                            setGroupName(e.target.value);
                                            if (groupError) setGroupError('');
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !creating) handleCreateGroup();
                                        }}
                                    />
                                </div>
                                {groupError && <p className="new-chat-screen__error">{groupError}</p>}
                                <button
                                    type="button"
                                    className="new-chat-screen__action new-chat-screen__action--primary"
                                    onClick={handleCreateGroup}
                                    disabled={creating}
                                >
                                    <Users size={16} />
                                    {creating ? 'در حال ساخت...' : 'ساخت گروه جدید'}
                                </button>

                                {createdGroupLink && (
                                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-primary)' }}>
                                        <p className="profile__field-label" style={{ marginBottom: 8, color: 'var(--accent-primary)' }}>گروه ساخته شد</p>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span className="new-chat-screen__invite">
                                                {createdGroupLink}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={handleCopy}
                                                className={`new-chat-screen__copy${copied ? ' new-chat-screen__copy--copied' : ''}`}
                                            >
                                                {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                                                {copied ? 'کپی شد' : 'کپی'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ ...surfaceStyle, padding: 16 }}>
                                <p className="profile__field-label" style={{ marginBottom: 10 }}>عضویت با لینک</p>
                                <div style={{ position: 'relative' }}>
                                    <LinkIcon size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                    <input
                                        type="text"
                                        className="profile__field-input"
                                        style={{ paddingRight: 40, borderRadius: 9999, background: 'var(--bg-primary)' }}
                                        placeholder="novaroom://group/INVITE_CODE"
                                        value={inviteInput}
                                        onChange={(e) => {
                                            setInviteInput(e.target.value);
                                            if (joinError) setJoinError('');
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !joining) handleJoinGroup();
                                        }}
                                    />
                                </div>
                                {joinError && <p className="new-chat-screen__error">{joinError}</p>}
                                <button
                                    type="button"
                                    className="new-chat-screen__action"
                                    onClick={handleJoinGroup}
                                    disabled={joining}
                                >
                                    <LinkIcon size={16} />
                                    {joining ? 'در حال عضویت...' : 'عضویت در گروه'}
                                </button>
                            </div>

                            <div style={{ ...surfaceStyle, padding: 16, marginTop: 18, direction: 'rtl', textAlign: 'right' }}>
                                <p className="profile__field-label" style={{ marginBottom: 10 }}>گروه‌های ساخته‌شده شما</p>
                                {ownedGroups.length === 0 ? (
                                    <p className="profile__groups-empty">هنوز گروهی نساخته‌اید.</p>
                                ) : (
                                    <div className="profile__groups-list">
                                        {ownedGroups.map((group) => (
                                            <div className="profile__group-item" key={group.chatId}>
                                                <div className="profile__group-main">
                                                    <p className="profile__group-name">{group.name}</p>
                                                    <p className="profile__group-code">{group.inviteCode}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={`new-chat-screen__copy${copiedGroup === group.chatId ? ' new-chat-screen__copy--copied' : ''}`}
                                                    onClick={() => handleCopyGroupLink(group.inviteLink, group.chatId)}
                                                >
                                                    {copiedGroup === group.chatId ? <CheckCheck size={14} /> : <LinkIcon size={14} />}
                                                    {copiedGroup === group.chatId ? 'کپی شد' : 'کپی لینک دعوت'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
