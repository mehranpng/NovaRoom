import { useState, useEffect } from 'react';
import { Search, X, UserPlus } from 'lucide-react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { Avatar } from './Avatar';

interface NewChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onChatCreated: (chatId: string) => void;
    currentUserChatId: string;
}

export function NewChatModal({ isOpen, onClose, onChatCreated, currentUserChatId }: NewChatModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);

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

    const handleSelectUser = async (targetChatId: string) => {
        try {
            const res = await apiFetch('/chats', {
                method: 'POST',
                body: JSON.stringify({ targetChatId }),
            });
            onChatCreated(res.chatId);
            onClose();
        } catch (err) {
            alert('Failed to create chat');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="new-chat-modal">
                <div className="modal-header">
                    <h2>New Chat</h2>
                    <button onClick={onClose} className="close-btn">
                        <X size={24} />
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
                                onClick={() => handleSelectUser(user.chatId)}
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
