import { ArrowLeft, Send, MoreVertical } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { Message, User } from '../types';
import { Avatar } from './Avatar';
import { cx } from '../utils/cx';

interface ChatRoomProps {
  chatId: string;
  contact: User;
  messages: Message[];
  currentUserId: string;
  onSendMessage: (text: string) => void;
  onBack: () => void;
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateSeparator(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function shouldShowDateSeparator(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].timestamp).toDateString();
  const curr = new Date(messages[index].timestamp).toDateString();
  return prev !== curr;
}

export function ChatRoom({
  messages,
  contact,
  currentUserId,
  onSendMessage,
  onBack,
}: ChatRoomProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getMessageShape = (index: number): string => {
    const msg = messages[index];
    const showDate = shouldShowDateSeparator(messages, index);
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const nextMsg = index < messages.length - 1 ? messages[index + 1] : null;
    const isFirst = !prevMsg || prevMsg.senderId !== msg.senderId || showDate;
    const isLast = !nextMsg || nextMsg.senderId !== msg.senderId;

    if (isFirst && isLast) return 'msg-shape--single';
    if (isFirst) return 'msg-shape--first';
    if (isLast) return 'msg-shape--last';
    return 'msg-shape--middle';
  };

  const isFirstInGroup = (index: number): boolean => {
    const msg = messages[index];
    const showDate = shouldShowDateSeparator(messages, index);
    const prevMsg = index > 0 ? messages[index - 1] : null;
    return !prevMsg || prevMsg.senderId !== msg.senderId || showDate;
  };

  return (
    <div className="chat-room">
      {/* Header */}
      <div className="chat-room__header">
        <button onClick={onBack} className="chat-room__back-btn">
          <ArrowLeft size={22} />
        </button>
        <Avatar name={contact.name} size="sm" online={contact.online} />
        <div className="chat-room__header-info">
          <h2 className="chat-room__contact-name">{contact.name}</h2>
          <p
            className={cx(
              'chat-room__contact-status',
              contact.online && 'chat-room__contact-status--online'
            )}
          >
            {contact.online ? 'Online' : 'Last seen recently'}
          </p>
        </div>
        <button className="icon-btn">
          <MoreVertical size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-room__messages">
        <div className="chat-room__messages-inner">
          {messages.map((message, index) => {
            const isMine = message.senderId === currentUserId;
            const showDate = shouldShowDateSeparator(messages, index);

            return (
              <div key={message.id}>
                {showDate && (
                  <div className="chat-room__date-separator">
                    <span className="chat-room__date-label">
                      {formatDateSeparator(message.timestamp)}
                    </span>
                  </div>
                )}
                <div
                  className={cx(
                    'message-row',
                    isMine ? 'message-row--mine' : 'message-row--theirs',
                    isFirstInGroup(index) && 'message-row--first'
                  )}
                >
                  <div
                    className={cx(
                      'message-bubble',
                      isMine ? 'message-bubble--mine' : 'message-bubble--theirs',
                      getMessageShape(index)
                    )}
                  >
                    <p className="message-text">{message.text}</p>
                    <div
                      className={cx(
                        'message-meta',
                        isMine ? 'message-meta--mine' : 'message-meta--theirs'
                      )}
                    >
                      <span className="message-time">
                        {formatMessageTime(message.timestamp)}
                      </span>
                      {isMine && (
                        <span className="message-seen">
                          {message.seen ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="chat-room__input-area">
        <div className="chat-room__input-wrapper">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="chat-room__text-input"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className={cx(
              'chat-room__send-btn',
              inputText.trim() ? 'chat-room__send-btn--active' : 'chat-room__send-btn--disabled'
            )}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
