import { useState, useEffect, useRef } from 'react';
import { Search, Users, Link as LinkIcon, X, Copy, CheckCheck } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUserSelected: (user: User) => void;
    onCreateGroup: (groupName: string) => Promise<any> | any;
    onJoinGroup: (inviteCode: string) => Promise<void> | void;
}

export function NewChatModal({ isOpen, onClose, onUserSelected, onCreateGroup, onJoinGroup }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'chat' | 'group'>('chat');
    const [groupName, setGroupName] = useState('');
    const [inviteInput, setInviteInput] = useState('');
    const [createdGroupLink, setCreatedGroupLink] = useState<string>('');
    const [copied, setCopied] = useState(false);

    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setResults([]);
        setLoading(false);
        setMode('chat');
        setGroupName('');
        setInviteInput('');
        setCreatedGroupLink('');
        setCopied(false);
    }, [isOpen]);

    useEffect(() => {
        if (mode !== 'chat') return;

        const q = query.trim().replace(/^@+/, '');

        if (!q || q.length < 2) {
            setResults([]);
            return;
        }

        const search = async () => {
            setLoading(true);
            try {
                const users = await apiFetch(`/users/search?query=${encodeURIComponent(q)}`);
                setResults(users);
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
        onClose();
    };

    const extractInviteCode = (rawValue: string): string => {
        const value = rawValue.trim();
        if (!value) return '';

        // senoroom://group/CODE یا novaroom://group/CODE
        const deepLink = value.match(/(?:senoroom|novaroom):\/\/group\/([a-zA-Z0-9]+)/);
        if (deepLink?.[1]) return deepLink[1];

        // هر URL که /group/CODE داشته باشه
        const urlLink = value.match(/\/group\/([a-zA-Z0-9]+)/);
        if (urlLink?.[1]) return urlLink[1];

        const fullLink = value.match(/groupInvite=([a-zA-Z0-9]+)/);
        if (fullLink?.[1]) return fullLink[1];

        // کد خالص
        return value;
    };

    const handleCreateGroup = async () => {
        const normalized = groupName.trim();
        if (normalized.length < 3) {
            alert('نام گروه باید حداقل ۳ کاراکتر باشد');
            return;
        }
        const res = await onCreateGroup(normalized);
        if (res?.inviteLink) {
            setCreatedGroupLink(res.inviteLink);
            setGroupName('');
        }
    };

    const handleJoinGroup = async () => {
        const inviteCode = extractInviteCode(inviteInput);
        if (!inviteCode) {
            alert('لینک یا کد دعوت گروه را وارد کنید');
            return;
        }
        await onJoinGroup(inviteCode);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(createdGroupLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="new-chat-modal">
                <div className="modal-header">
                    <h2>گفتگوی جدید</h2>
                    <button onClick={onClose} className="icon-btn" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="new-chat-modal__tabs">
                    <button
                        type="button"
                        className={`new-chat-modal__tab ${mode === 'chat' ? 'new-chat-modal__tab--active' : ''}`}
                        onClick={() => setMode('chat')}
                    >
                        <Search size={15} />
                        چت خصوصی
                    </button>
                    <button
                        type="button"
                        className={`new-chat-modal__tab ${mode === 'group' ? 'new-chat-modal__tab--active' : ''}`}
                        onClick={() => setMode('group')}
                    >
                        <Users size={15} />
                        گروه
                    </button>
                </div>

                {mode === 'chat' ? (
                    <>
                        <div className="search-box">
                            <Search size={20} />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="جستجو با نام کاربری..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onFocus={() => {
                                    setTimeout(() => {
                                        inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }, 150);
                                }}
                                autoFocus
                            />
                        </div>

                        <div className="results">
                            {loading ? (
                                <p className="loading">در حال جستجو...</p>
                            ) : results.length === 0 && query.trim().replace(/^@+/, '').length >= 2 ? (
                                <p className="no-results">کاربری یافت نشد</p>
                            ) : (
                                results.map((user) => (
                                    <div
                                        key={user.chatId}
                                        className="user-item"
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => handleSelectUser(user)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleSelectUser(user);
                                            }
                                        }}
                                    >
                                        <Avatar name={user.name} size="md" online={user.online} />
                                        <div style={{ flex: 1 }}>
                                            <div
                                                className="user-name"
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                            >
                                                {user.name}
                                                {user.verified ? <VerifiedBadge size={14} /> : null}
                                            </div>
                                            <div className="user-username">@{user.username}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                ) : (
                    <div className="new-chat-modal__group-box">
                        <label className="new-chat-modal__label">ساخت گروه</label>
                        <div className="new-chat-modal__input-wrap">
                            <Users size={16} />
                            <input
                                type="text"
                                placeholder="نام گروه"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateGroup();
                                }}
                            />
                        </div>
                        <button type="button" className="new-chat-modal__action" onClick={handleCreateGroup}>
                            ساخت گروه جدید
                        </button>

                        {/* نمایش لینک دعوت بعد از ساخت گروه */}
                        {createdGroupLink && (
                            <div style={{
                                marginTop: 12,
                                padding: '12px 14px',
                                background: 'var(--bg-secondary)',
                                borderRadius: 12,
                                border: '1px solid var(--border-primary)',
                            }}>
                                <div style={{
                                    fontSize: 12,
                                    color: 'var(--text-secondary)',
                                    marginBottom: 8,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}>
                                    ✅ گروه ساخته شد — لینک دعوت:
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                        flex: 1,
                                        wordBreak: 'break-all',
                                        color: 'var(--text-primary)',
                                        background: 'var(--bg-primary)',
                                        padding: '6px 10px',
                                        borderRadius: 8,
                                        border: '1px solid var(--border-primary)',
                                    }}>
                                        {createdGroupLink}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: 8,
                                            border: '1px solid var(--border-primary)',
                                            background: copied ? '#22c55e' : 'var(--bg-primary)',
                                            color: copied ? '#fff' : 'var(--text-primary)',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            whiteSpace: 'nowrap',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            transition: 'background 0.2s, color 0.2s',
                                        }}
                                    >
                                        {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                                        {copied ? 'کپی شد' : 'کپی'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <label className="new-chat-modal__label" style={{ marginTop: 16 }}>عضویت با لینک</label>
                        <div className="new-chat-modal__input-wrap">
                            <LinkIcon size={16} />
                            <input
                                type="text"
                                placeholder="senoroom://group/INVITE_CODE"
                                value={inviteInput}
                                onChange={(e) => setInviteInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleJoinGroup();
                                }}
                            />
                        </div>
                        <button type="button" className="new-chat-modal__action new-chat-modal__action--secondary" onClick={handleJoinGroup}>
                            عضویت در گروه
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}