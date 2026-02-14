import type { User, Message, Chat } from '../types';

export const currentUser: User = {
  chatId: 'CID-29104',
  username: 'johndoe',
  name: 'John Doe',
  bio: 'Full-stack developer. Coffee enthusiast ☕',
  avatar: '',
  online: true,
};

export const contacts: User[] = [
  {
    chatId: 'CID-10201',
    username: 'alice_w',
    name: 'Alice Walker',
    bio: 'Designer & illustrator',
    avatar: '',
    online: true,
  },
  {
    chatId: 'CID-10302',
    username: 'bob_smith',
    name: 'Bob Smith',
    bio: 'Backend engineer at TechCorp',
    avatar: '',
    online: false,
  },
  {
    chatId: 'CID-10403',
    username: 'carol_j',
    name: 'Carol Johnson',
    bio: 'Product manager & yoga lover 🧘‍♀️',
    avatar: '',
    online: true,
  },
  {
    chatId: 'CID-10504',
    username: 'david_lee',
    name: 'David Lee',
    bio: 'Mobile developer | React Native',
    avatar: '',
    online: false,
  },
  {
    chatId: 'CID-10605',
    username: 'emma_r',
    name: 'Emma Roberts',
    bio: 'Data scientist 📊',
    avatar: '',
    online: true,
  },
  {
    chatId: 'CID-10706',
    username: 'frank_m',
    name: 'Frank Miller',
    bio: 'DevOps & Cloud',
    avatar: '',
    online: false,
  },
];

const now = Date.now();

export const mockMessages: Record<string, Message[]> = {
  'chat-1': [
    { id: 'm1', chatId: 'chat-1', senderId: 'CID-10201', text: 'Hey! How are you doing?', timestamp: now - 3600000 * 2, seen: true },
    { id: 'm2', chatId: 'chat-1', senderId: 'CID-29104', text: 'I\'m great, thanks! Working on a new project.', timestamp: now - 3600000 * 1.5, seen: true },
    { id: 'm3', chatId: 'chat-1', senderId: 'CID-10201', text: 'That sounds awesome! What kind of project?', timestamp: now - 3600000, seen: true },
    { id: 'm4', chatId: 'chat-1', senderId: 'CID-29104', text: 'A messenger app, actually! Pretty cool stuff.', timestamp: now - 1800000, seen: true },
    { id: 'm5', chatId: 'chat-1', senderId: 'CID-10201', text: 'Nice! Let me know if you need any design help 🎨', timestamp: now - 900000, seen: true },
    { id: 'm6', chatId: 'chat-1', senderId: 'CID-29104', text: 'Will do! Thanks Alice!', timestamp: now - 600000, seen: false },
  ],
  'chat-2': [
    { id: 'm7', chatId: 'chat-2', senderId: 'CID-10302', text: 'Did you push the latest changes?', timestamp: now - 7200000, seen: true },
    { id: 'm8', chatId: 'chat-2', senderId: 'CID-29104', text: 'Yes, just merged to main.', timestamp: now - 7000000, seen: true },
    { id: 'm9', chatId: 'chat-2', senderId: 'CID-10302', text: 'Perfect, I\'ll review it tomorrow morning.', timestamp: now - 6800000, seen: true },
  ],
  'chat-3': [
    { id: 'm10', chatId: 'chat-3', senderId: 'CID-10403', text: 'Meeting at 3pm today?', timestamp: now - 5400000, seen: true },
    { id: 'm11', chatId: 'chat-3', senderId: 'CID-29104', text: 'Sure! I\'ll be there.', timestamp: now - 5200000, seen: true },
    { id: 'm12', chatId: 'chat-3', senderId: 'CID-10403', text: 'Great, see you then! 👋', timestamp: now - 5000000, seen: false },
  ],
  'chat-4': [
    { id: 'm13', chatId: 'chat-4', senderId: 'CID-29104', text: 'Hey David, have you tried the new React Native update?', timestamp: now - 86400000, seen: true },
    { id: 'm14', chatId: 'chat-4', senderId: 'CID-10504', text: 'Not yet, is it stable?', timestamp: now - 82800000, seen: true },
    { id: 'm15', chatId: 'chat-4', senderId: 'CID-29104', text: 'Yeah, performance is much better now.', timestamp: now - 80000000, seen: true },
  ],
  'chat-5': [
    { id: 'm16', chatId: 'chat-5', senderId: 'CID-10605', text: 'Can you share the dataset link?', timestamp: now - 43200000, seen: true },
    { id: 'm17', chatId: 'chat-5', senderId: 'CID-29104', text: 'Sure, sending it now.', timestamp: now - 42000000, seen: true },
    { id: 'm18', chatId: 'chat-5', senderId: 'CID-10605', text: 'Got it, thanks! 🙏', timestamp: now - 40000000, seen: true },
  ],
  'chat-6': [
    { id: 'm19', chatId: 'chat-6', senderId: 'CID-10706', text: 'The CI/CD pipeline is set up.', timestamp: now - 172800000, seen: true },
    { id: 'm20', chatId: 'chat-6', senderId: 'CID-29104', text: 'Awesome work Frank!', timestamp: now - 170000000, seen: true },
  ],
};

export const mockChats: Chat[] = [
  {
    id: 'chat-1',
    participantIds: ['CID-29104', 'CID-10201'],
    lastMessage: {
      id: mockMessages['chat-1'][mockMessages['chat-1'].length - 1].id,
      text: mockMessages['chat-1'][mockMessages['chat-1'].length - 1].text,
      senderId: mockMessages['chat-1'][mockMessages['chat-1'].length - 1].senderId,
      timestamp: mockMessages['chat-1'][mockMessages['chat-1'].length - 1].timestamp,
    },
    unreadCount: 1,
    otherUser: contacts[0],
  },
  {
    id: 'chat-2',
    participantIds: ['CID-29104', 'CID-10302'],
    lastMessage: {
      id: mockMessages['chat-2'][mockMessages['chat-2'].length - 1].id,
      text: mockMessages['chat-2'][mockMessages['chat-2'].length - 1].text,
      senderId: mockMessages['chat-2'][mockMessages['chat-2'].length - 1].senderId,
      timestamp: mockMessages['chat-2'][mockMessages['chat-2'].length - 1].timestamp,
    },
    unreadCount: 0,
    otherUser: contacts[1],
  },
  {
    id: 'chat-3',
    participantIds: ['CID-29104', 'CID-10403'],
    lastMessage: {
      id: mockMessages['chat-3'][mockMessages['chat-3'].length - 1].id,
      text: mockMessages['chat-3'][mockMessages['chat-3'].length - 1].text,
      senderId: mockMessages['chat-3'][mockMessages['chat-3'].length - 1].senderId,
      timestamp: mockMessages['chat-3'][mockMessages['chat-3'].length - 1].timestamp,
    },
    unreadCount: 1,
    otherUser: contacts[2],
  },
  {
    id: 'chat-4',
    participantIds: ['CID-29104', 'CID-10504'],
    lastMessage: {
      id: mockMessages['chat-4'][mockMessages['chat-4'].length - 1].id,
      text: mockMessages['chat-4'][mockMessages['chat-4'].length - 1].text,
      senderId: mockMessages['chat-4'][mockMessages['chat-4'].length - 1].senderId,
      timestamp: mockMessages['chat-4'][mockMessages['chat-4'].length - 1].timestamp,
    },
    unreadCount: 0,
    otherUser: contacts[3],
  },
  {
    id: 'chat-5',
    participantIds: ['CID-29104', 'CID-10605'],
    lastMessage: {
      id: mockMessages['chat-5'][mockMessages['chat-5'].length - 1].id,
      text: mockMessages['chat-5'][mockMessages['chat-5'].length - 1].text,
      senderId: mockMessages['chat-5'][mockMessages['chat-5'].length - 1].senderId,
      timestamp: mockMessages['chat-5'][mockMessages['chat-5'].length - 1].timestamp,
    },
    unreadCount: 0,
    otherUser: contacts[4],
  },
  {
    id: 'chat-6',
    participantIds: ['CID-29104', 'CID-10706'],
    lastMessage: {
      id: mockMessages['chat-6'][mockMessages['chat-6'].length - 1].id,
      text: mockMessages['chat-6'][mockMessages['chat-6'].length - 1].text,
      senderId: mockMessages['chat-6'][mockMessages['chat-6'].length - 1].senderId,
      timestamp: mockMessages['chat-6'][mockMessages['chat-6'].length - 1].timestamp,
    },
    unreadCount: 0,
    otherUser: contacts[5],
  },
];
