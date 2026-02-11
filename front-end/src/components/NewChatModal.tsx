import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUserSelected: (user: User) => void;
}

export function NewChatModal({ isOpen, onClose, onUserSelected }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setResults([]);
        setLoading(false);
    }, [isOpen]);

    useEffect(() => {
        if (!query || query.length < 2) {
            setResults([]);
            return;
        }

        const search = async () => {
            setLoading(true);
            try {
                const users = await apiFetch(`/users/search?query=${encodeURIComponent(query)}`);
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
        <div className="modal-overlay" role="dialog" aria-modal="true">
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
                        type="text"
                        placeholder="Search by username or name..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="results">
                    {loading ? (
                        <p className="loading">Searching...</p>
                    ) : results.length === 0 && query.length >= 2 ? (
                        <p className="no-results">No users found</p>
                    ) : (
                        results.map((user) => (
                            <button
                                key={user.chatId}
                                className="user-item"
                                onClick={() => handleSelectUser(user)}
                            >
                                <Avatar name={user.name} size="md" online={user.online} />
                                <div>
                                    <div className="user-name">{user.name}</div>
                                    <div className="user-username">@{user.username}</div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
