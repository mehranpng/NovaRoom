import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUserSelected: (user: User) => void;
}

export function NewChatModal({ isOpen, onClose, onUserSelected }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setResults([]);
        setLoading(false);
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
        onUserSelected(user);
        onClose();
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
                    <h2>New Chat</h2>
                    <button onClick={onClose} className="icon-btn" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="search-box">
                    <Search size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Search by username..."
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
                        <p className="loading">Searching...</p>
                    ) : results.length === 0 && query.trim().replace(/^@+/, '').length >= 2 ? (
                        <p className="no-results">No users found</p>
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
            </div>
        </div>
    );
}
