import { ArrowLeft, Copy, Check, Pencil, X, Save } from 'lucide-react';
import { useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { cx } from '../utils/cx';

interface ProfileProps {
  user: User;
  onBack: () => void;
  onUpdateProfile: (updates: Partial<Pick<User, 'name' | 'username' | 'bio'>>) => void;
}

export function Profile({ user, onBack, onUpdateProfile }: ProfileProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedUsername = username.trim();
    if (!trimmedName || !trimmedUsername) return;
    onUpdateProfile({
      name: trimmedName,
      username: trimmedUsername,
      bio: bio.trim(),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setName(user.name);
    setUsername(user.username);
    setBio(user.bio);
    setIsEditing(false);
  };

  return (
    <div className="profile">
      {/* Header */}
      <div className="profile__header">
        <button onClick={onBack} className="profile__header-back">
          <ArrowLeft size={22} />
        </button>
        <h1 className="profile__header-title">Profile</h1>
        <div className="profile__header-spacer" />
        {!isEditing ? (
          <button onClick={() => setIsEditing(true)} className="profile__edit-btn">
            <Pencil size={14} />
            Edit
          </button>
        ) : (
          <div className="profile__header-actions">
            <button onClick={handleCancel} className="profile__cancel-btn">
              <X size={14} />
              Cancel
            </button>
            <button onClick={handleSave} className="profile__save-btn">
              <Save size={14} />
              Save
            </button>
          </div>
        )}
      </div>

      <div className="profile__content">
        {/* Avatar & Name Section */}
        <div className="profile__avatar-section">
          <Avatar name={user.name} size="xl" online={true} />
          <h2 className="profile__name">{user.name}</h2>
          <p className="profile__username-display">@{user.username}</p>
          <span className="profile__online-badge">
            <span className="profile__online-dot" />
            Online
          </span>
        </div>

        <div className="profile__fields">
          {/* Chat ID */}
          <div className="profile__chat-id-card">
            <div className="profile__chat-id-row">
              <div>
                <p className="profile__field-label">Chat ID</p>
                <p className="profile__chat-id-value">{user.chatId}</p>
              </div>
              <button
                onClick={() => handleCopy(user.chatId, 'chatId')}
                className={cx(
                  'profile__copy-btn',
                  copiedField === 'chatId' && 'profile__copy-btn--copied'
                )}
              >
                {copiedField === 'chatId' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Editable Fields */}
          {/* Name */}
          <div className="profile__field-group">
            <label className="profile__field-label">Name</label>
            {isEditing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="profile__field-input"
                placeholder="Your name"
                maxLength={50}
              />
            ) : (
              <div className="profile__field-static">
                <p>{user.name}</p>
              </div>
            )}
          </div>

          {/* Username */}
          <div className="profile__field-group">
            <label className="profile__field-label">Username</label>
            {isEditing ? (
              <div className="profile__username-wrapper">
                <span className="profile__username-at">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  className="profile__field-input profile__field-input--username"
                  placeholder="username"
                  maxLength={30}
                />
              </div>
            ) : (
              <div className="profile__field-static profile__field-static--with-copy">
                <p>@{user.username}</p>
                <button
                  onClick={() => handleCopy(`@${user.username}`, 'username')}
                  className={cx(
                    'profile__small-copy-btn',
                    copiedField === 'username' && 'profile__small-copy-btn--copied'
                  )}
                >
                  {copiedField === 'username' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </div>

          {/* Bio */}
          <div className="profile__field-group">
            <label className="profile__field-label">Bio</label>
            {isEditing ? (
              <div>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="profile__textarea"
                  placeholder="Tell something about yourself..."
                  rows={3}
                  maxLength={150}
                />
                <p className="profile__char-count">{bio.length}/150</p>
              </div>
            ) : (
              <div className="profile__field-static">
                <p className={!user.bio ? 'profile__bio-empty' : ''}>
                  {user.bio || 'No bio yet'}
                </p>
              </div>
            )}
          </div>

          {/* Info Note */}
          <div className="profile__info-note">
            <p>
              Your Chat ID is unique and cannot be changed. Share it with others so they can find
              and message you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
