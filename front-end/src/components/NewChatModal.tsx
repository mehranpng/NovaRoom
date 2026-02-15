import { useState, useEffect, useRef } from 'react';
import { Search, X, Users, UserRoundPlus } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUserSelected: (user: User) => void;
    onCreateGroup: (payload: { name: string; members: User[]; description?: string }) => Promise<boolean> | boolean;
}

export function NewChatModal({ isOpen, onClose, onUserSelected, onCreateGroup }: NewChatModalProps) {
    const [mode, setMode] = useState<'direct' | 'group'>('direct');
    const [query, setQuery] = useState('');
    const [groupName, setGroupName] = useState('');
    const [groupDescription, setGroupDescription] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);

    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setGroupName('');
        setGroupDescription('');
        setSelectedMembers([]);
        setResults([]);
        setLoading(false);
        setMode('direct');
    }, [isOpen]);

    useEffect(() => {
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
    }, [query]);

    const handleSelectUser = (user: User) => {
        if (mode === 'direct') {
            onUserSelected(user);
            onClose();
            return;
        }

        if (selectedMembers.some((m) => m.chatId === user.chatId)) return;
        setSelectedMembers((prev) => [...prev, user]);
    };


    const handleRemoveMember = (chatId: string) => {
        setSelectedMembers((prev) => prev.filter((m) => m.chatId !== chatId));
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim() || creatingGroup) return;
        setCreatingGroup(true);
        try {
            const ok = await onCreateGroup({
                name: groupName.trim(),
                description: groupDescription.trim(),
                members: selectedMembers,
            });
            if (ok !== false) {
                onClose();
            }
        } finally {
            setCreatingGroup(false);
        }
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
                    <h2>{mode === 'direct' ? 'گفتگوی جدید' : 'ساخت گروه'}</h2>
                    <button onClick={onClose} className="icon-btn" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
                    <button type="button" className="icon-btn" onClick={() => setMode('direct')} style={{ flex: 1, height: 38 }}>
                        <UserRoundPlus size={16} /> چت
                    </button>
                    <button type="button" className="icon-btn" onClick={() => setMode('group')} style={{ flex: 1, height: 38 }}>
                        <Users size={16} /> گروه
                    </button>
                </div>

                {mode === 'group' && (
                    <>
                        <div className="search-box" style={{ paddingTop: 10, paddingBottom: 10 }}>
                            <input
                                type="text"
                                placeholder="نام گروه..."
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                            />
                        </div>
                        <div className="search-box" style={{ paddingTop: 10, paddingBottom: 10 }}>
                            <input
                                type="text"
                                placeholder="توضیحات گروه (اختیاری)..."
                                value={groupDescription}
                                onChange={(e) => setGroupDescription(e.target.value)}
                                maxLength={120}
                            />
                        </div>
                    </>
                )}

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

                {mode === 'group' && (
                    <div style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                        {selectedMembers.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {selectedMembers.map((m) => (
                                    <button
                                        key={m.chatId}
                                        type="button"
                                        onClick={() => handleRemoveMember(m.chatId)}
                                        className="message-reaction"
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                                    >
                                        {m.name}
                                        <X size={12} />
                                    </button>
                                ))}
                            </div>
                        ) : 'فعلاً فقط شما عضو گروه هستید. بعداً هم می‌تونی عضو اضافه کنی.'}
                    </div>
                )}

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
                                <Avatar name={user.name} size="md" online={user.online} avatar={user.avatar} />
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

                {mode === 'group' && (
                    <div style={{ padding: 12, borderTop: '1px solid var(--border-primary)' }}>
                        <button
                            type="button"
                            className="chat-room__send-btn chat-room__send-btn--active"
                            style={{ width: '100%', borderRadius: 10 }}
                            onClick={handleCreateGroup}
                            disabled={creatingGroup || !groupName.trim()}
                        >
                            {creatingGroup ? 'در حال ساخت گروه...' : 'ایجاد گروه'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
