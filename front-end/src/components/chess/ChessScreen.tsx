import { useEffect, useState } from 'react';
import type { Chat, ChessLeaderboardEntry, User } from '../../types';
import { ContactInfo } from '../ContactInfo';
import { ChessAIGame } from './ai/ChessAIGame';
import { ChessGame } from './ChessGame';
import { ChessHome, resetChessLobbyScroll } from './ChessHome';
import { ChessUserProfile } from './ChessUserProfile';

interface ChessScreenProps {
    currentUser: User;
    gameId: string | null;
    aiMode?: boolean;
    authToken: string | null;
    chats: Chat[];
    interactiveOnlineUsers?: Record<string, number>;
    isUserBlocked?: (user: Partial<User> | null | undefined) => boolean;
    onToggleBlockUser?: (user: User) => void | Promise<void>;
    onOpenDirectChat?: (user: User) => void;
    onOpenProfile?: () => void;
    onContactOpenChange?: (open: boolean) => void;
    onOpenGame: (gameId: string) => void;
    onOpenAiGame: () => void;
    onExitGame: () => void;
}

export function ChessScreen({
    currentUser,
    gameId,
    aiMode,
    authToken,
    chats,
    interactiveOnlineUsers,
    isUserBlocked,
    onToggleBlockUser,
    onOpenDirectChat,
    onOpenProfile,
    onContactOpenChange,
    onOpenGame,
    onOpenAiGame,
    onExitGame,
}: ChessScreenProps) {
    const [selectedEntry, setSelectedEntry] = useState<ChessLeaderboardEntry | null>(null);
    const [contactInfoOpen, setContactInfoOpen] = useState(false);

    useEffect(() => () => resetChessLobbyScroll(), []);

    useEffect(() => {
        onContactOpenChange?.(Boolean(selectedEntry));
    }, [selectedEntry, onContactOpenChange]);

    useEffect(() => () => onContactOpenChange?.(false), [onContactOpenChange]);

    if (aiMode) {
        return <ChessAIGame currentUser={currentUser} onExitGame={onExitGame} />;
    }

    if (gameId) {
        return (
            <ChessGame
                key={gameId}
                currentUser={currentUser}
                gameId={gameId}
                authToken={authToken}
                chats={chats}
                onExitGame={onExitGame}
            />
        );
    }

    if (selectedEntry && contactInfoOpen) {
        const contactUser = selectedEntry.user;
        const blocked = Boolean(isUserBlocked?.(contactUser));
        return (
            <ContactInfo
                key={`chess-contact-${contactUser.chatId}`}
                user={contactUser}
                isBlocked={blocked}
                hideOnlineStatus={Boolean(contactUser.blockedByOther) || blocked}
                isInteractiveOnline={Boolean(interactiveOnlineUsers?.[contactUser.chatId])}
                onToggleBlock={
                    onToggleBlockUser
                        ? async (user) => {
                              await onToggleBlockUser(user);
                          }
                        : undefined
                }
                onBack={() => setContactInfoOpen(false)}
                onOpenChat={(user) => {
                    setContactInfoOpen(false);
                    setSelectedEntry(null);
                    if (user.chatId === currentUser.chatId) {
                        onOpenProfile?.();
                        return;
                    }
                    onOpenDirectChat?.(user);
                }}
            />
        );
    }

    if (selectedEntry) {
        return (
            <ChessUserProfile
                key={`chess-user-${selectedEntry.user.chatId}`}
                entry={selectedEntry}
                onBack={() => {
                    setContactInfoOpen(false);
                    setSelectedEntry(null);
                }}
                onOpenContactInfo={() => {
                    if (selectedEntry.user.chatId === currentUser.chatId && onOpenProfile) {
                        setSelectedEntry(null);
                        onOpenProfile();
                        return;
                    }
                    setContactInfoOpen(true);
                }}
                onOpenGame={onOpenGame}
            />
        );
    }

    return (
        <ChessHome
            key="lobby"
            currentUser={currentUser}
            chats={chats}
            onOpenGame={onOpenGame}
            onOpenAiGame={onOpenAiGame}
            onSelectLeaderboardEntry={(entry) => {
                setContactInfoOpen(false);
                setSelectedEntry(entry);
            }}
        />
    );
}
