import { useState, useEffect, useRef } from 'react';
import { Search, X, Users, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface NewChatModalProps {
    isOpen: boolean;
    mode: 'direct' | 'group';
    onClose: () => void;
    onUserSelected: (user: User) => void;
    onCreateGroup: (payload: { name: string; members: User[] }) => void;
}

export function NewChatModal({ isOpen, mode, onClose, onUserSelected, onCreateGroup }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [groupName, setGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setGroupName('');
        setSelectedMembers([]);
        setResults([]);
        setLoading(false);
    }, [isOpen, mode]);

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

    const toggleMember = (user: User) => {
        if (selectedMembers.some((m) => m.chatId === user.chatId)) {
            setSelectedMembers((prev) => prev.filter((m) => m.chatId !== user.chatId));
            return;
        }
        setSelectedMembers((prev) => [...prev, user]);
    };

    const handleSelectUser = (user: User) => {
        if (mode === 'direct') {
            onUserSelected(user);
            onClose();
            return;
        }
        toggleMember(user);
    };

    const handleCreateGroup = () => {
        if (!groupName.trim() || selectedMembers.length < 1) return;
        onCreateGroup({ name: groupName.trim(), members: selectedMembers });
    };

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="new-chat-modal">
                <div className="modal-header">
                    <h2>{mode === 'direct' ? 'گفتگوی جدید' : 'ایجاد گروه جدید'}</h2>
                    <button onClick={onClose} className="icon-btn" aria-label="Close" type="button">
                        <X size={20} />
                    </button>
                </div>

                {mode === 'group' && (
                    <div className="search-box" style={{ paddingTop: 10, paddingBottom: 10 }}>
                        <Users size={20} />
                        <input
                            type="text"
                            placeholder="اسم گروه..."
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                        />
                    </div>
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
                            setTimeout(() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
                        }}
                        autoFocus
                    />
                </div>

                {mode === 'group' && selectedMembers.length > 0 && (
                    <div style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                        اعضای انتخاب شده: {selectedMembers.map((m) => m.name).join('، ')}
                    </div>
                )}

                <div className="results">
                    {loading ? (
                        <p className="loading">در حال جستجو...</p>
                    ) : results.length === 0 && query.trim().replace(/^@+/, '').length >= 2 ? (
                        <p className="no-results">کاربری یافت نشد</p>
                    ) : (
                        results.map((user) => {
                            const selected = selectedMembers.some((m) => m.chatId === user.chatId);
                            return (
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
                                    style={selected ? { background: 'var(--hover-bg-light)' } : undefined}
                                >
                                    <Avatar name={user.name} size="md" online={user.online} avatar={user.avatar} />
                                    <div style={{ flex: 1 }}>
                                        <div className="user-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            {user.name}
                                            {user.verified ? <VerifiedBadge size={14} /> : null}
                                        </div>
                                        <div className="user-username">@{user.username}</div>
                                    </div>
                                    {mode === 'group' && selected ? <CheckCircle2 size={18} color="#2F80ED" /> : null}
                                </div>
                            );
                        })
                    )}
                </div>

                {mode === 'group' && (
                    <div style={{ padding: 12, borderTop: '1px solid var(--border-primary)' }}>
                        <button
                            type="button"
                            className="chat-room__send-btn chat-room__send-btn--active"
                            style={{ width: '100%', borderRadius: 10 }}
                            onClick={handleCreateGroup}
                            disabled={!groupName.trim() || selectedMembers.length < 1}
                        >
                            ساخت گروه
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
