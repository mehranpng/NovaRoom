import { ArrowLeft, Copy, Check, Pencil, X, Save } from 'lucide-react';
import { useState } from 'react';
import { User } from '@/types';
import { Avatar } from './Avatar';
import { cn } from '@/utils/cn';

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
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-xl p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        <div className="flex-1" />
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100"
          >
            <Pencil size={14} />
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              <Save size={14} />
              Save
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar & Name Section */}
        <div className="flex flex-col items-center px-6 pt-8 pb-6">
          <Avatar name={user.name} size="xl" online={true} />
          <h2 className="mt-4 text-2xl font-bold text-gray-900">{user.name}</h2>
          <p className="text-sm text-gray-500">@{user.username}</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Online
          </span>
        </div>

        <div className="mx-auto max-w-lg px-4 pb-8">
          {/* Chat ID */}
          <div className="mb-6 rounded-2xl bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                  Chat ID
                </p>
                <p className="mt-1 font-mono text-sm font-semibold text-gray-900">
                  {user.chatId}
                </p>
              </div>
              <button
                onClick={() => handleCopy(user.chatId, 'chatId')}
                className={cn(
                  'rounded-xl p-2 transition-colors',
                  copiedField === 'chatId'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                )}
              >
                {copiedField === 'chatId' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Editable Fields */}
          <div className="space-y-5">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-400">
                Name
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Your name"
                  maxLength={50}
                />
              ) : (
                <div className="rounded-xl bg-gray-50 px-4 py-2.5">
                  <p className="text-[15px] text-gray-900">{user.name}</p>
                </div>
              )}
            </div>

            {/* Username */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-400">
                Username
              </label>
              {isEditing ? (
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-8 pr-4 text-[15px] text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="username"
                    maxLength={30}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5">
                  <p className="text-[15px] text-gray-900">@{user.username}</p>
                  <button
                    onClick={() => handleCopy(`@${user.username}`, 'username')}
                    className={cn(
                      'rounded-lg p-1 transition-colors',
                      copiedField === 'username'
                        ? 'text-emerald-600'
                        : 'text-gray-400 hover:text-gray-600'
                    )}
                  >
                    {copiedField === 'username' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              )}
            </div>

            {/* Bio */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-400">
                Bio
              </label>
              {isEditing ? (
                <div>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Tell something about yourself..."
                    rows={3}
                    maxLength={150}
                  />
                  <p className="mt-1 text-right text-xs text-gray-400">{bio.length}/150</p>
                </div>
              ) : (
                <div className="rounded-xl bg-gray-50 px-4 py-2.5">
                  <p className="text-[15px] text-gray-900">
                    {user.bio || (
                      <span className="italic text-gray-400">No bio yet</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Info Note */}
          <div className="mt-8 rounded-2xl bg-blue-50 p-4">
            <p className="text-center text-xs leading-relaxed text-blue-600">
              Your Chat ID is unique and cannot be changed. Share it with others so they can find
              and message you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
