import { useState, useEffect, useRef } from 'react';
import { Search, Users, Link as LinkIcon, X } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUserSelected: (user: User) => void;
    onCreateGroup: (groupName: string) => Promise<void> | void;
    onJoinGroup: (inviteCode: string) => Promise<void> | void;
}

export function NewChatModal({ isOpen, onClose, onUserSelected, onCreateGroup, onJoinGroup }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'chat' | 'group'>('chat');
    const [groupName, setGroupName] = useState('');
    const [inviteInput, setInviteInput] = useState('');

    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setResults([]);
        setLoading(false);
        setMode('chat');
        setGroupName('');
        setInviteInput('');
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

        const deepLink = value.match(/group\/([a-zA-Z0-9]+)/);
        if (deepLink?.[1]) return deepLink[1];

        const fullLink = value.match(/groupInvite=([a-zA-Z0-9]+)/);
        if (fullLink?.[1]) return fullLink[1];

        return value;
    };

    const handleCreateGroup = async () => {
        const normalized = groupName.trim();
        if (normalized.length < 3) {
            alert('نام گروه باید حداقل ۳ کاراکتر باشد');
            return;
        }
        await onCreateGroup(normalized);
    };

    const handleJoinGroup = async () => {
        const inviteCode = extractInviteCode(inviteInput);
        if (!inviteCode) {
            alert('لینک یا کد دعوت گروه را وارد کنید');
            return;
        }
        await onJoinGroup(inviteCode);
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
                            />
                        </div>
                        <button type="button" className="new-chat-modal__action" onClick={handleCreateGroup}>
                            ساخت گروه جدید
                        </button>

                        <label className="new-chat-modal__label" style={{ marginTop: 16 }}>عضویت با لینک</label>
                        <div className="new-chat-modal__input-wrap">
                            <LinkIcon size={16} />
                            <input
                                type="text"
                                placeholder="novaroom://group/INVITE_CODE"
                                value={inviteInput}
                                onChange={(e) => setInviteInput(e.target.value)}
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
