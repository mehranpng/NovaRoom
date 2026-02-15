# 🎯 Complete Reaction Feature Implementation Guide

## Overview
This guide shows you EXACTLY where to add code for the reaction feature.

---

## 📝 Step 1: Add CSS (App.css)

**Location**: End of `front-end/src/App.css`

```css
/* ========================================
   REACTION PICKER
   ======================================== */
.reaction-picker {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  min-width: 320px;
  animation: popover-in 0.15s ease-out;
}

.reaction-picker__emojis {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-primary);
  justify-content: center;
}

.reaction-picker__emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 20px;
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.15s;
}

.reaction-picker__emoji:hover {
  background: var(--hover-bg);
  transform: scale(1.15);
}

.reaction-picker__emoji--active {
  background: #dbeafe;
  transform: scale(1.1);
}

.dark-mode .reaction-picker__emoji--active {
  background: #1e3a8a;
}

.reaction-picker__menu {
  padding: 6px;
}

.reaction-picker__menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 14px;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-primary);
  font-family: inherit;
  transition: background 0.15s;
}

.reaction-picker__menu-item:hover {
  background: var(--hover-bg-light);
}

.reaction-picker__menu-item--danger {
  color: #dc2626;
}

.reaction-picker__menu-item--danger:hover {
  background: #fef2f2;
}

.dark-mode .reaction-picker__menu-item--danger:hover {
  background: #7f1d1d;
}

/* ========================================
   MESSAGE REACTIONS (on bubble)
   ======================================== */
.message-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.message-reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1.5px solid transparent;
  background: rgba(0, 0, 0, 0.05);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.dark-mode .message-reaction {
  background: rgba(255, 255, 255, 0.08);
}

.message-reaction:hover {
  transform: scale(1.08);
  background: rgba(0, 0, 0, 0.08);
}

.dark-mode .message-reaction:hover {
  background: rgba(255, 255, 255, 0.12);
}

.message-reaction--active {
  background: #dbeafe;
  border-color: #3b82f6;
}

.dark-mode .message-reaction--active {
  background: #1e3a8a;
  border-color: #60a5fa;
}

.message-reaction__emoji {
  line-height: 1;
}

.message-reaction__count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.message-reaction--active .message-reaction__count {
  color: #2563eb;
}

.dark-mode .message-reaction--active .message-reaction__count {
  color: #93c5fd;
}

.message-bubble--mine .message-reaction {
  background: rgba(255, 255, 255, 0.15);
}

.message-bubble--mine .message-reaction:hover {
  background: rgba(255, 255, 255, 0.25);
}

.message-bubble--mine .message-reaction--active {
  background: rgba(255, 255, 255, 0.35);
  border-color: rgba(255, 255, 255, 0.6);
}

.message-bubble--mine .message-reaction__count {
  color: rgba(255, 255, 255, 0.9);
}
```

---

## 📝 Step 2: Update ChatRoom.tsx

### 2.1: Add States (after line ~108)

**Find this line:**
```typescript
const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number }>(null);
```

**Add AFTER it:**
```typescript
const [reactionPicker, setReactionPicker] = useState<null | { id: string; top: number; left: number }>(null);
const reactionPickerRef = useRef<HTMLDivElement | null>(null);
const REACTION_EMOJIS = ['👍', '👎', '🤣', '❤️', '💔', '😐', '😭'];
```

---

### 2.2: Add toggleReaction Function (after doCopyMessage, ~line 330)

**Add this complete function:**
```typescript
const toggleReaction = async (messageId: string, emoji: string) => {
    try {
        await apiFetch(`/messages/${encodeURIComponent(messageId)}/react`, {
            method: 'POST',
            body: JSON.stringify({ emoji }),
        });
        setReactionPicker(null);
    } catch (error) {
        console.error('Failed to toggle reaction:', error);
    }
};
```

---

### 2.3: Update useEffect for Closing Menus (~line 350)

**Find:**
```typescript
if (msgMenuRef.current && msgMenuRef.current.contains(target)) return;
```

**Add AFTER it:**
```typescript
if (reactionPickerRef.current && reactionPickerRef.current.contains(target)) return;
```

**Also find:**
```typescript
setMsgMenu(null);
```

**Add AFTER it:**
```typescript
setReactionPicker(null);
```

---

### 2.4: REPLACE openMessageMenu Function (~line 510)

**Replace the ENTIRE function with:**
```typescript
const openMessageMenu = (messageId: string, targetEl: HTMLElement) => {
    const room = roomRef.current;
    if (!room) return;

    const roomRect = room.getBoundingClientRect();
    const r = targetEl.getBoundingClientRect();

    let top = r.top - roomRect.top - 60;
    let left = r.left - roomRect.left;

    const pickerWidth = 320;
    const maxLeft = roomRect.width - pickerWidth - 16;
    left = Math.max(12, Math.min(left, maxLeft));
    top = Math.max(70, top);

    setReactionPicker({ id: messageId, top, left });
};
```

---

### 2.5: Add Reaction Display in Message Bubble (~line 821)

**Find:**
```typescript
<div className="message-text">{m.text}</div>
```

**Add RIGHT AFTER (before message-meta):**
```typescript
{/* Display reactions */}
{m.reactions && m.reactions.length > 0 && (
    <div className="message-reactions">
        {Object.entries(
            m.reactions.reduce((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        ).map(([emoji, count]) => {
            const userReacted = m.reactions?.some(
                r => r.emoji === emoji && r.userId === currentUserId
            );
            return (
                <button
                    key={emoji}
                    type="button"
                    className={`message-reaction ${userReacted ? 'message-reaction--active' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleReaction(m.id, emoji);
                    }}
                >
                    <span className="message-reaction__emoji">{emoji}</span>
                    {count > 1 && (
                        <span className="message-reaction__count">{count}</span>
                    )}
                </button>
            );
        })}
    </div>
)}
```

---

### 2.6: REPLACE msgMenu Section (~line 853)

**Find and REPLACE this entire block:**
```typescript
{msgMenu && activeMsg && (
    // ... old menu code
)}
```

**With:**
```typescript
{reactionPicker && (
    <div
        ref={reactionPickerRef}
        className="reaction-picker"
        style={{ top: reactionPicker.top, left: reactionPicker.left, position: 'absolute', zIndex: 100 }}
        onClick={(e) => e.stopPropagation()}
    >
        <div className="reaction-picker__emojis">
            {REACTION_EMOJIS.map((emoji) => {
                const msg = messages.find(m => m.id === reactionPicker.id);
                const userReaction = msg?.reactions?.find(r => r.userId === currentUserId);
                const isActive = userReaction?.emoji === emoji;
                return (
                    <button
                        key={emoji}
                        type="button"
                        className={`reaction-picker__emoji ${isActive ? 'reaction-picker__emoji--active' : ''}`}
                        onClick={() => toggleReaction(reactionPicker.id, emoji)}
                    >
                        {emoji}
                    </button>
                );
            })}
        </div>
        <div className="reaction-picker__menu">
            <button className="reaction-picker__menu-item" onClick={() => {
                const msg = messages.find(m => m.id === reactionPicker.id);
                if (msg) beginReply(msg);
                setReactionPicker(null);
            }} type="button">
                <Reply size={16} />
                پاسخ
            </button>
            {messages.find(m => m.id === reactionPicker.id)?.senderId === currentUserId && (
                <button className="reaction-picker__menu-item" onClick={() => {
                    const msg = messages.find(m => m.id === reactionPicker.id);
                    if (msg) beginEdit(msg);
                    setReactionPicker(null);
                }} type="button">
                    <Pencil size={16} />
                    ویرایش
                </button>
            )}
            <button className="reaction-picker__menu-item" onClick={() => {
                const msg = messages.find(m => m.id === reactionPicker.id);
                if (msg) doCopyMessage(msg);
            }} type="button">
                <Copy size={16} />
                کپی
            </button>
            {messages.find(m => m.id === reactionPicker.id)?.senderId === currentUserId && (
                <button className="reaction-picker__menu-item reaction-picker__menu-item--danger" onClick={() => {
                    doDeleteMessage(reactionPicker.id);
                    setReactionPicker(null);
                }} type="button">
                    <Trash2 size={16} />
                    حذف
                </button>
            )}
        </div>
    </div>
)}
```

---

## 📝 Step 3: Update App.tsx

### 3.1: Add handleReactionUpdated Callback (~line 240, after handleMessagesSeen)

**Add:**
```typescript
const handleReactionUpdated = useCallback((chatId: string, messageId: string, reactions: any[]) => {
    setMessages(prev => {
        const arr = prev[chatId];
        if (!arr) return prev;
        return {
            ...prev,
            [chatId]: arr.map(m => (m.id === messageId ? { ...m, reactions } : m))
        };
    });
}, []);
```

---

### 3.2: Update useWebSocket Call (~line 255)

**Find:**
```typescript
const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen } = useWebSocket({
    token: localStorage.getItem('token'),
    onNewMessage: handleNewMessage,
    onMessageEdited: handleMessageEdited,
    onMessageDeleted: handleMessageDeleted,
    onUserStatusChange: handleUserStatusChange,
    onMessagesSeen: handleMessagesSeen
});
```

**Change to (add onReactionUpdated):**
```typescript
const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen } = useWebSocket({
    token: localStorage.getItem('token'),
    onNewMessage: handleNewMessage,
    onMessageEdited: handleMessageEdited,
    onMessageDeleted: handleMessageDeleted,
    onUserStatusChange: handleUserStatusChange,
    onMessagesSeen: handleMessagesSeen,
    onReactionUpdated: handleReactionUpdated  // ← ADD THIS
});
```

---

## ✅ Testing

After making all changes:

1. Restart dev server: `npm run dev`
2. Click on any message
3. Reaction picker should appear with emojis + menu
4. Click emoji to react
5. Click again to remove
6. Reactions appear below message text

---

## 🐛 Troubleshooting

- **Box doesn't show**: Check if `reactionPicker` state is set correctly in `openMessageMenu`
- **Reactions don't persist**: Check WebSocket `onReactionUpdated` is connected
- **Styling broken**: Make sure CSS is at the END of App.css

---

Backend is already complete! ✅
