# 🎉 راهنمای کامل پیاده‌سازی قابلیت ری‌اکشن

این سند راهنمای جامع برای اضافه کردن قابلیت ری‌اکشن به پیام‌های چت است.

## ✅ بک‌اند (کامل شده)

بک‌اند کامل شده و شامل:
- API endpoint: `POST /messages/{message_id}/react`
- WebSocket event: `reaction_updated`
- Database: reactions array در Message model

## 🎨 فرانت‌اند (نیاز به پیاده‌سازی)

### 1️⃣ افزودن State برای ری‌اکشن پیکر

در `ChatRoom.tsx` بعد از state های موجود:

```typescript
// Add reaction picker state
const [reactionPicker, setReactionPicker] = useState<null | { id: string; top: number; left: number }>(null);
const reactionPickerRef = useRef<HTMLDivElement | null>(null);

// Available reaction emojis
const REACTION_EMOJIS = ['👍', '👎', '🤣', '❤️', '💔', '😐', '😭'];
```

### 2️⃣ تابع Toggle ری‌اکشن

اضافه کردن تابع برای ارسال ری‌اکشن به سرور:

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

### 3️⃣ تابع بستن منوها با کلیک بیرون

به‌روزرسانی `useEffect` برای بستن reaction picker:

```typescript
useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
        const target = e.target as Node;
        if (menuRef.current && menuRef.current.contains(target)) return;
        if (msgMenuRef.current && msgMenuRef.current.contains(target)) return;
        if (reactionPickerRef.current && reactionPickerRef.current.contains(target)) return;
        
        // ... rest of modal checks
        
        setChatMenuOpen(false);
        setMsgMenu(null);
        setReactionPicker(null); // ← Add this
    };

    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
}, []);
```

### 4️⃣ باز کردن ری‌اکشن پیکر به جای منو

تغییر handler کلیک روی پیام:

```typescript
// در بخش render message bubble
onClick={(e) => {
    if (Date.now() < swipeRef.current.blockClickUntil) return;
    
    const room = roomRef.current;
    if (!room) return;

    const roomRect = room.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();

    // Calculate position for reaction picker (above message)
    let top = r.top - roomRect.top - 60; // 60px above message
    let left = r.left - roomRect.left;

    // Adjust to keep picker within viewport
    const pickerWidth = 320;
    const maxLeft = roomRect.width - pickerWidth - 16;
    left = Math.max(12, Math.min(left, maxLeft));
    
    // Make sure picker doesn't go above header
    top = Math.max(70, top);

    setReactionPicker({ id: m.id, top, left });
}}
```

### 5️⃣ UI ری‌اکشن پیکر

اضافه کردن JSX برای نمایش reaction picker (بعد از msgMenu):

```tsx
{reactionPicker && (
    <div
        ref={reactionPickerRef}
        className="reaction-picker"
        style={{ 
            top: reactionPicker.top, 
            left: reactionPicker.left, 
            position: 'absolute', 
            zIndex: 100 
        }}
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
            <button 
                className="reaction-picker__menu-item" 
                onClick={() => {
                    const msg = messages.find(m => m.id === reactionPicker.id);
                    if (msg) beginReply(msg);
                    setReactionPicker(null);
                }} 
                type="button"
            >
                <Reply size={16} />
                پاسخ
            </button>
            
            {messages.find(m => m.id === reactionPicker.id)?.senderId === currentUserId && (
                <>
                    <button 
                        className="reaction-picker__menu-item" 
                        onClick={() => {
                            const msg = messages.find(m => m.id === reactionPicker.id);
                            if (msg) beginEdit(msg);
                            setReactionPicker(null);
                        }} 
                        type="button"
                    >
                        <Pencil size={16} />
                        ویرایش
                    </button>
                </>
            )}
            
            <button 
                className="reaction-picker__menu-item" 
                onClick={() => {
                    const msg = messages.find(m => m.id === reactionPicker.id);
                    if (msg) doCopyMessage(msg);
                }} 
                type="button"
            >
                <Copy size={16} />
                کپی
            </button>
            
            {messages.find(m => m.id === reactionPicker.id)?.senderId === currentUserId && (
                <button 
                    className="reaction-picker__menu-item reaction-picker__menu-item--danger" 
                    onClick={() => {
                        doDeleteMessage(reactionPicker.id);
                        setReactionPicker(null);
                    }} 
                    type="button"
                >
                    <Trash2 size={16} />
                    حذف
                </button>
            )}
        </div>
    </div>
)}
```

### 6️⃣ نمایش ری‌اکشن‌های روی پیام

در بخش message bubble، بعد از `message-text` و قبل از `message-meta`:

```tsx
{/* Display reactions */}
{m.reactions && m.reactions.length > 0 && (
    <div className="message-reactions">
        {/* Group reactions by emoji */}
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

### 7️⃣ حذف msgMenu قدیمی

از آنجایی که حالا reaction picker جایگزین msgMenu شده، می‌تونی بخش `{msgMenu && activeMsg && (` رو حذف کنی یا بهتره بذاری برای بعد.

### 8️⃣ CSS Styles

اضافه کردن استایل‌ها به `App.css`:

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

/* Reactions inside mine bubbles */
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

### 9️⃣ بروزرسانی WebSocket Handler در App.tsx

اضافه کردن handler برای `reaction_updated`:

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

// در useWebSocket:
const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen } = useWebSocket({
    token: localStorage.getItem('token'),
    onNewMessage: handleNewMessage,
    onMessageEdited: handleMessageEdited,
    onMessageDeleted: handleMessageDeleted,
    onUserStatusChange: handleUserStatusChange,
    onMessagesSeen: handleMessagesSeen,
    onReactionUpdated: handleReactionUpdated, // ← Add this
});
```

## 🎯 خلاصه تغییرات

1. ✅ State برای reaction picker
2. ✅ تابع toggleReaction
3. ✅ بستن picker با کلیک بیرون
4. ✅ تغییر onClick روی message bubble
5. ✅ UI reaction picker با ایموجی‌ها و منو
6. ✅ نمایش ری‌اکشن‌های روی پیام
7. ✅ CSS استایل‌ها
8. ✅ WebSocket handler در App.tsx

## 🚀 نتیجه نهایی

- وقتی روی پیام کلیک می‌کنی → باکس ری‌اکشن با ایموجی‌ها + منو نمایش داده می‌شه
- ایموجی انتخاب شده هایلایت میشه
- ری‌اکشن‌ها زیر پیام نمایش داده می‌شن
- تعداد ری‌اکشن‌ها کنار ایموجی نمایش داده میشه
- کاربر می‌تونه با کلیک روی ری‌اکشن، آن را حذف/اضافه کنه
- همه چیز real-time با WebSocket آپدیت میشه

---
**نوشته شده برای پروژه Messenger - © 2026**
