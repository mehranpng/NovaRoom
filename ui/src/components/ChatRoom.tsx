import { ArrowLeft, Send, MoreVertical } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Message, User } from '@/types';
import { Avatar } from './Avatar';
import { cn } from '@/utils/cn';

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

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-3 py-2.5 shadow-sm">
        <button
          onClick={onBack}
          className="rounded-xl p-1.5 text-gray-500 transition-colors hover:bg-gray-100 lg:hidden"
        >
          <ArrowLeft size={22} />
        </button>
        <Avatar name={contact.name} size="sm" online={contact.online} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-gray-900">{contact.name}</h2>
          <p className="text-xs text-gray-500">
            {contact.online ? (
              <span className="text-emerald-600">Online</span>
            ) : (
              'Last seen recently'
            )}
          </p>
        </div>
        <button className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100">
          <MoreVertical size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-1">
          {messages.map((message, index) => {
            const isMine = message.senderId === currentUserId;
            const showDate = shouldShowDateSeparator(messages, index);

            // Group consecutive messages from same sender
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const nextMsg = index < messages.length - 1 ? messages[index + 1] : null;
            const isFirstInGroup = !prevMsg || prevMsg.senderId !== message.senderId || showDate;
            const isLastInGroup = !nextMsg || nextMsg.senderId !== message.senderId;

            return (
              <div key={message.id}>
                {showDate && (
                  <div className="flex justify-center py-4">
                    <span className="rounded-full bg-white px-4 py-1 text-xs font-medium text-gray-500 shadow-sm">
                      {formatDateSeparator(message.timestamp)}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    'flex',
                    isMine ? 'justify-end' : 'justify-start',
                    isFirstInGroup && 'mt-3',
                    !isFirstInGroup && 'mt-0.5'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] px-3.5 py-2 sm:max-w-[70%]',
                      isMine
                        ? cn(
                            'bg-blue-500 text-white',
                            isFirstInGroup && isLastInGroup && 'rounded-2xl',
                            isFirstInGroup && !isLastInGroup && 'rounded-2xl rounded-br-lg',
                            !isFirstInGroup && !isLastInGroup && 'rounded-2xl rounded-r-lg',
                            !isFirstInGroup && isLastInGroup && 'rounded-2xl rounded-tr-lg'
                          )
                        : cn(
                            'bg-white text-gray-900 shadow-sm',
                            isFirstInGroup && isLastInGroup && 'rounded-2xl',
                            isFirstInGroup && !isLastInGroup && 'rounded-2xl rounded-bl-lg',
                            !isFirstInGroup && !isLastInGroup && 'rounded-2xl rounded-l-lg',
                            !isFirstInGroup && isLastInGroup && 'rounded-2xl rounded-tl-lg'
                          )
                    )}
                  >
                    <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                    <div
                      className={cn(
                        'mt-0.5 flex items-center justify-end gap-1',
                        isMine ? 'text-blue-100' : 'text-gray-400'
                      )}
                    >
                      <span className="text-[10px]">{formatMessageTime(message.timestamp)}</span>
                      {isMine && (
                        <span className="text-[10px]">
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
      <div className="border-t border-gray-100 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 rounded-2xl bg-gray-100 px-4 py-3 text-[15px] text-gray-900 placeholder-gray-500 outline-none transition-colors focus:bg-gray-50 focus:ring-2 focus:ring-blue-500/20"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all',
              inputText.trim()
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25 hover:bg-blue-600 active:scale-95'
                : 'bg-gray-100 text-gray-400'
            )}
          >
            <Send size={18} className={inputText.trim() ? '-ml-0.5' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
}
