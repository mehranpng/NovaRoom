import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export function useChessboardTouchGuard() {
    const [boardKey, setBoardKey] = useState(0);
    const isDraggingRef = useRef(false);
    const lastTouchAtRef = useRef(0);
    const recoveryTimerRef = useRef<number | null>(null);

    const clearRecoveryTimer = useCallback(() => {
        if (recoveryTimerRef.current !== null) {
            window.clearTimeout(recoveryTimerRef.current);
            recoveryTimerRef.current = null;
        }
    }, []);

    useEffect(() => clearRecoveryTimer, [clearRecoveryTimer]);

    const markDragStart = useCallback(() => {
        isDraggingRef.current = true;
        clearRecoveryTimer();
    }, [clearRecoveryTimer]);

    const markDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        clearRecoveryTimer();
    }, [clearRecoveryTimer]);

    const scheduleRecoveryCheck = useCallback(() => {
        clearRecoveryTimer();
        recoveryTimerRef.current = window.setTimeout(() => {
            recoveryTimerRef.current = null;
            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                setBoardKey((k) => k + 1);
            }
        }, 120);
    }, [clearRecoveryTimer]);

    const onTouchStartCapture = useCallback(() => {
        lastTouchAtRef.current = Date.now();
        clearRecoveryTimer();
    }, [clearRecoveryTimer]);

    const onMouseDownCapture = useCallback((e: React.MouseEvent) => {
        if (Date.now() - lastTouchAtRef.current < 800) {
            e.stopPropagation();
        }
    }, []);

    const wrapProps = {
        onTouchStartCapture,
        onMouseDownCapture,
        onTouchEndCapture: scheduleRecoveryCheck,
        onTouchCancelCapture: scheduleRecoveryCheck,
        onPointerUpCapture: scheduleRecoveryCheck,
        onPointerCancelCapture: scheduleRecoveryCheck,
    };

    return {
        boardKey,
        isDraggingRef,
        markDragStart,
        markDragEnd,
        wrapProps,
    };
}
