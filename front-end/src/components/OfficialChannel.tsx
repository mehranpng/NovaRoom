import React, { useEffect, useState, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { API_BASE_URL } from "../config/api";
import type { User, Message } from "../types";
import { Avatar } from "./Avatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { ReactionPicker } from "./ReactionPicker";
import { FileUpload } from "./FileUpload";
import { FileMessage } from "./FileMessage";
import { ForwardModal } from "./ForwardModal";
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton";
import "./OfficialChannel.css";

interface OfficialChannelMessage extends Message {
  senderInfo?: {
    chatId: string;
    name: string;
    username: string;
    avatar: string;
    verified: boolean;
  };
}

interface OfficialChannelProps {
  currentUser: User;
  token: string;
  onBack: () => void;
  ws: WebSocket | null;
}

const OfficialChannel: React.FC<OfficialChannelProps> = ({
  currentUser,
  token,
  onBack,
  ws,
}) => {
  const [messages, setMessages] = useState<OfficialChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [replyTo, setReplyTo] = useState<OfficialChannelMessage | null>(null);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: OfficialChannelMessage;
  } | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(
    null
  );
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [messageToForward, setMessageToForward] = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Fetch channel info
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/official-ch/info`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setChannelInfo(data);
        }
      } catch (error) {
        console.error("Failed to fetch channel info:", error);
      }
    };
    fetchInfo();
  }, [token]);

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/official-ch/messages?limit=50`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (error) {
        console.error("Failed to fetch messages:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [token]);

  // WebSocket event handler
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "official_ch_message") {
          setMessages((prev) => [...prev, data.message]);
          setTimeout(() => scrollToBottom(), 100);
        } else if (data.type === "official_ch_edited") {
          setMessages((prev) =>
            prev.map((m) => (m.id === data.message.id ? data.message : m))
          );
        } else if (data.type === "official_ch_deleted") {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        } else if (data.type === "official_ch_reaction") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId
                ? { ...m, reactions: data.reactions }
                : m
            )
          );
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws]);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle file upload
  const handleFileSelect = async (file: File) => {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedFile(data.file);
      } else {
        alert("فایل آپلود نشد");
      }
    } catch (error) {
      console.error("File upload error:", error);
      alert("خطا در آپلود فایل");
    } finally {
      setUploadingFile(false);
    }
  };

  // Send message
  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || sending) return;

    if (!currentUser.verified) {
      alert("فقط کاربران تایید شده می‌توانند پیام ارسال کنند");
      return;
    }

    setSending(true);
    try {
      const response = await fetch(`${API_BASE_URL}/official-ch/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: inputText,
          replyToId: replyTo?.id || null,
          file: selectedFile,
        }),
      });

      if (response.ok) {
        setInputText("");
        setReplyTo(null);
        setSelectedFile(null);
        inputRef.current?.focus();
      } else {
        const error = await response.json();
        alert(error.detail || "خطا در ارسال پیام");
      }
    } catch (error) {
      console.error("Send error:", error);
      alert("خطا در ارسال پیام");
    } finally {
      setSending(false);
    }
  };

  // Edit message
  const handleEdit = async () => {
    if (!editText.trim() || !editingMessageId) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/official-ch/edit/${editingMessageId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text: editText }),
        }
      );

      if (response.ok) {
        setEditingMessageId(null);
        setEditText("");
      } else {
        const error = await response.json();
        alert(error.detail || "خطا در ویرایش پیام");
      }
    } catch (error) {
      console.error("Edit error:", error);
      alert("خطا در ویرایش پیام");
    }
  };

  // Delete message
  const handleDelete = async (messageId: string) => {
    if (!currentUser.verified) {
      alert("فقط کاربران تایید شده می‌توانند پیام حذف کنند");
      return;
    }

    if (!confirm("آیا از حذف این پیام مطمئن هستید؟")) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/official-ch/delete/${messageId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        alert(error.detail || "خطا در حذف پیام");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("خطا در حذف پیام");
    }
  };

  // React to message
  const handleReaction = async (messageId: string, emoji: string) => {
    try {
      await fetch(`${API_BASE_URL}/official-ch/react/${messageId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ emoji }),
      });
      setShowReactionPicker(null);
    } catch (error) {
      console.error("Reaction error:", error);
    }
  };

  // Copy message text
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("متن کپی شد");
    setContextMenu(null);
  };

  // Forward message
  const handleForward = (messageId: string) => {
    setMessageToForward(messageId);
    setForwardModalOpen(true);
    setContextMenu(null);
  };

  // Context menu
  const handleContextMenu = (
    e: React.MouseEvent,
    message: OfficialChannelMessage
  ) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message });
  };

  // Start editing
  const startEdit = (message: OfficialChannelMessage) => {
    setEditingMessageId(message.id);
    setEditText(message.text);
    setContextMenu(null);
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 24) {
      return date.toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else {
      return date.toLocaleDateString("fa-IR");
    }
  };

  // Check if message is from current user
  const isMyMessage = (message: OfficialChannelMessage) => {
    return message.senderId === currentUser.chatId;
  };

  if (loading) {
    return <ChatMessagesSkeleton />;
  }

  return (
    <div className="official-channel">
      {/* Header */}
      <div className="official-channel-header">
        <button className="back-button" onClick={onBack}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <div className="channel-info">
          <Avatar
            name=""
            size="md"
            online={false}
            src={channelInfo?.avatar || ''}
          />
          <div className="channel-details">
            <div className="channel-name-container">
              <h2>کانال رسمی نوا روم</h2>
              <VerifiedBadge />
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="official-channel-messages">
        {messages.length === 0 ? (
          <div className="no-messages">
            <p>هنوز پیامی ارسال نشده است</p>
          </div>
        ) : (
          messages.map((message) => {
            const isMine = isMyMessage(message);
            return (
              <div
                key={message.id}
                className={`message-wrapper ${isMine ? "mine" : "theirs"}`}
                onContextMenu={(e) => handleContextMenu(e, message)}
              >
                {!isMine && message.senderInfo && (
                  <Avatar
                    name={message.senderInfo.name}
                    size="sm"
                    online={false}
                    src={message.senderInfo.avatar}
                  />
                )}
                <div className="message-content">
                  {!isMine && message.senderInfo && (
                    <div className="sender-info">
                      <span className="sender-name">
                        {message.senderInfo.name}
                      </span>
                      {message.senderInfo.verified && <VerifiedBadge />}
                    </div>
                  )}

                  {editingMessageId === message.id ? (
                    <div className="edit-box">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleEdit();
                          } else if (e.key === "Escape") {
                            setEditingMessageId(null);
                          }
                        }}
                        autoFocus
                      />
                      <div className="edit-actions">
                        <button onClick={handleEdit}>ذخیره</button>
                        <button onClick={() => setEditingMessageId(null)}>
                          لغو
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {message.replyTo && (
                        <div className="reply-reference">
                          <span className="reply-sender">
                            {message.replyTo.senderId === currentUser.chatId
                              ? "شما"
                              : "پاسخ به"}
                          </span>
                          <span className="reply-text">
                            {message.replyTo.text}
                          </span>
                        </div>
                      )}

                      {message.file && <FileMessage file={message.file} token={token} />}

                      {message.text && (
                        <div className="message-text">{message.text}</div>
                      )}

                      <div className="message-footer">
                        <span className="timestamp">
                          {formatTimestamp(message.timestamp)}
                        </span>
                        {message.edited && (
                          <span className="edited-badge">ویرایش شده</span>
                        )}
                      </div>

                      {/* Reactions */}
                      {message.reactions && message.reactions.length > 0 && (
                        <div className="reactions-display">
                          {message.reactions.map((reaction: any) => (
                            <div
                              key={reaction.emoji}
                              className="reaction-item"
                              onClick={() =>
                                handleReaction(message.id, reaction.emoji)
                              }
                            >
                              <span>{reaction.emoji}</span>
                              <span>{reaction.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {currentUser.verified ? (
        <div className="official-channel-input">
          {replyTo && (
            <div className="reply-preview">
              <span>پاسخ به: {replyTo.text}</span>
              <button onClick={() => setReplyTo(null)}>×</button>
            </div>
          )}

          {selectedFile && (
            <div className="file-preview">
              <span>{selectedFile.fileName}</span>
              <button onClick={() => setSelectedFile(null)}>×</button>
            </div>
          )}

          <div className="input-row">
            <FileUpload onFileSelect={handleFileSelect} disabled={uploadingFile} />
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="پیام خود را بنویسید..."
              disabled={sending}
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={sending || uploadingFile}
              className="send-button"
            >
              {sending ? "در حال ارسال..." : "ارسال"}
            </button>
          </div>
        </div>
      ) : (
        <div className="official-channel-readonly-notice">
          این کانال فقط برای کاربران تایید شده قابل ارسال پیام است.
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => handleCopy(contextMenu.message.text)}>
            کپی متن
          </button>
          <button onClick={() => setReplyTo(contextMenu.message)}>
            پاسخ دادن
          </button>
          <button
            onClick={() => setShowReactionPicker(contextMenu.message.id)}
          >
            واکنش
          </button>
          <button onClick={() => handleForward(contextMenu.message.id)}>
            فورواد
          </button>
          {isMyMessage(contextMenu.message) && (
            <button onClick={() => startEdit(contextMenu.message)}>
              ویرایش
            </button>
          )}
          {currentUser.verified && (
            <button
              onClick={() => handleDelete(contextMenu.message.id)}
              className="delete-button"
            >
              حذف
            </button>
          )}
        </div>
      )}

      {/* Reaction Picker */}
      {showReactionPicker && (
        <div className="reaction-picker-overlay">
          <ReactionPicker
            onSelect={(emoji: string) => handleReaction(showReactionPicker, emoji)}
            onClose={() => setShowReactionPicker(null)}
          />
        </div>
      )}

      {/* Forward Modal */}
      {forwardModalOpen && messageToForward && (
        <ForwardModal
          token={token}
          messageId={messageToForward}
          onClose={() => {
            setForwardModalOpen(false);
            setMessageToForward(null);
          }}
        />
      )}
    </div>
  );
};

export default OfficialChannel;
