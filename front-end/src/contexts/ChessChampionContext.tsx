import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../config/api';
import type { ChessChampionInfo } from '../types';

interface ChessChampionContextValue {
    champion: ChessChampionInfo | null;
    championId: string | null;
    isChampion: (userId?: string) => boolean;
    refreshChampion: () => Promise<void>;
}

const STORAGE_KEY = 'novaroom_chess_champion_v1';

let globalChampion: ChessChampionInfo | null = null;
const listeners = new Set<(champ: ChessChampionInfo | null) => void>();

export const getGlobalChessChampion = (): ChessChampionInfo | null => globalChampion;

export const isUserChessChampion = (userId?: string): boolean => {
    if (!userId || !globalChampion?.chatId) return false;
    return userId === globalChampion.chatId;
};

export const setGlobalChessChampion = (champ: ChessChampionInfo | null) => {
    globalChampion = champ;
    try {
        if (typeof window !== 'undefined') {
            if (champ) {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(champ));
            } else {
                window.localStorage.removeItem(STORAGE_KEY);
            }
        }
    } catch {
        // ignore storage errors
    }
    listeners.forEach((fn) => fn(champ));
};

// Try hydrating from localStorage on module load
if (typeof window !== 'undefined') {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            globalChampion = JSON.parse(raw);
        }
    } catch {
        // ignore
    }
}

const ChessChampionContext = createContext<ChessChampionContextValue>({
    champion: globalChampion,
    championId: globalChampion?.chatId || null,
    isChampion: (userId?: string) => isUserChessChampion(userId),
    refreshChampion: async () => {},
});

export const ChessChampionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [champion, setChampion] = useState<ChessChampionInfo | null>(globalChampion);

    useEffect(() => {
        const handler = (champ: ChessChampionInfo | null) => {
            setChampion(champ);
        };
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    }, []);

    const refreshChampion = useCallback(async () => {
        try {
            const res = await apiFetch('/chess/champion');
            const champ: ChessChampionInfo | null = res?.champion || null;
            setGlobalChessChampion(champ);
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        void refreshChampion();
        // Check periodically every 60s
        const timer = setInterval(() => {
            void refreshChampion();
        }, 60_000);
        return () => clearInterval(timer);
    }, [refreshChampion]);

    const isChampion = useCallback(
        (userId?: string) => {
            if (!userId || !champion?.chatId) return false;
            return userId === champion.chatId;
        },
        [champion?.chatId],
    );

    return (
        <ChessChampionContext.Provider
            value={{
                champion,
                championId: champion?.chatId || null,
                isChampion,
                refreshChampion,
            }}
        >
            {children}
        </ChessChampionContext.Provider>
    );
};

export const useChessChampion = (): ChessChampionContextValue => {
    const ctx = useContext(ChessChampionContext);
    if (!ctx) {
        return {
            champion: globalChampion,
            championId: globalChampion?.chatId || null,
            isChampion: isUserChessChampion,
            refreshChampion: async () => {},
        };
    }
    return ctx;
};
