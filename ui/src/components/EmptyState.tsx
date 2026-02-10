import { MessageCircle } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-50 p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
        <MessageCircle size={36} className="text-white" />
      </div>
      <h2 className="mt-6 text-2xl font-bold text-gray-900">Welcome to QuickChat</h2>
      <p className="mt-2 max-w-sm text-center text-gray-500">
        Select a conversation from the sidebar to start messaging, or create a new one.
      </p>
      <div className="mt-8 flex items-center gap-2 text-sm text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        End-to-end encrypted
      </div>
    </div>
  );
}
