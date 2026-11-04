import { useSyncExternalStore } from 'react';

type Progress = { phase: 'uploading' | 'encrypting'; progress: number };

const values = new Map<string, Progress>();
const listeners = new Map<string, Set<() => void>>();

export function setUploadProgress(id: string, value: Progress) {
    values.set(id, value);
    listeners.get(id)?.forEach((fn) => fn());
}

export function clearUploadProgress(id: string) {
    values.delete(id);
    listeners.get(id)?.forEach((fn) => fn());
    listeners.delete(id);
}

export function useUploadProgress(id: string): Progress | undefined {
    return useSyncExternalStore(
        (fn) => {
            const set = listeners.get(id) || new Set();
            set.add(fn);
            listeners.set(id, set);
            return () => set.delete(fn);
        },
        () => values.get(id),
    );
}
