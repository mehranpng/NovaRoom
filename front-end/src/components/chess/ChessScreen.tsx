import { useEffect, useState } from 'react';
import type { Chat, User } from '../../types';
import { ContactInfo } from '../ContactInfo';
import { ChessGame } from './ChessGame';
import { ChessHome, resetChessLobbyScroll } from './ChessHome';

type ChessContactUser = User & { blockedByMe?: boolean; blockedByOther?: boolean };

interface ChessScreenProps {
    currentUser: User;
    gameId: string | null;
    authToken: string | null;
    chats: Chat[];
    interactiveOnlineUsers?: Record<string, number>;
    isUserBlocked?: (user: Partial<User> | null | undefined) => boolean;
    onToggleBlockUser?: (user: User) => void | Promise<void>;
    onOpenDirectChat?: (user: User) => void;
    onOpenProfile?: () => void;
    onContactOpenChange?: (open: boolean) => void;
    onOpenGame: (gameId: string) => void;
    onExitGame: () => void;
}

export function ChessScreen({
    currentUser,
    gameId,
    authToken,
    chats,
    interactiveOnlineUsers,
    isUserBlocked,
    onToggleBlockUser,
    onOpenDirectChat,
    onOpenProfile,
    onContactOpenChange,
    onOpenGame,
    onExitGame,
}: ChessScreenProps) {
    const [selectedContact, setSelectedContact] = useState<ChessContactUser | null>(null);

    useEffect(() => () => resetChessLobbyScroll(), []);

    useEffect(() => {
        onContactOpenChange?.(Boolean(selectedContact));
    }, [selectedContact, onContactOpenChange]);

    useEffect(() => () => onContactOpenChange?.(false), [onContactOpenChange]);

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

    if (selectedContact) {
        const blocked = Boolean(isUserBlocked?.(selectedContact));
        return (
            <ContactInfo
                key={`chess-contact-${selectedContact.chatId}`}
                user={selectedContact}
                isBlocked={blocked}
                hideOnlineStatus={Boolean(selectedContact.blockedByOther) || blocked}
                isInteractiveOnline={Boolean(interactiveOnlineUsers?.[selectedContact.chatId])}
                onToggleBlock={
                    onToggleBlockUser
                        ? async (user) => {
                              await onToggleBlockUser(user);
                          }
                        : undefined
                }
                onBack={() => setSelectedContact(null)}
                onOpenChat={(user) => {
                    setSelectedContact(null);
                    if (user.chatId === currentUser.chatId) {
                        onOpenProfile?.();
                        return;
                    }
                    onOpenDirectChat?.(user);
                }}
            />
        );
    }

    return (
        <ChessHome
            key="lobby"
            currentUser={currentUser}
            chats={chats}
            onOpenGame={onOpenGame}
            onSelectUser={(user) => {
                if (user.chatId === currentUser.chatId) return;
                setSelectedContact(user);
            }}
        />
    );
}
