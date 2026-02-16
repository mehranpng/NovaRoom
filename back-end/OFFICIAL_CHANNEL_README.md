# Official Channel Feature Documentation

## Overview
The Official Channel is a special broadcast channel where verified users can post messages visible to all users. It appears as a default chat in every user's chat list.

## Database Schema

### Collection: `official_ch`
Stores all messages posted to the official channel.

```javascript
{
  _id: ObjectId,
  sender_id: String,        // User chatId who sent the message
  text: String,             // Message text
  timestamp: DateTime,      // When message was sent
  editedAt: DateTime,       // Optional: When message was last edited
  reactions: [{             // Array of reactions
    userId: String,
    emoji: String
  }],
  replyTo: {               // Optional: Reply information
    id: String,
    senderId: String,
    text: String
  },
  file: {                  // Optional: File attachment
    fileId: String,
    filename: String,
    size: Number,
    mimeType: String
  }
}
```

## API Endpoints

### 1. Get Channel Info
**GET** `/official-ch/info`

Returns basic information about the official channel.

**Authentication:** Required

**Response:**
```json
{
  "id": "official_ch",
  "name": "کانال رسمی نوا روم",
  "avatar": "/avatars/ch.png",
  "verified": true,
  "totalMessages": 123,
  "lastMessage": {
    "id": "message_id",
    "text": "Last message text",
    "senderId": "user_id",
    "timestamp": 1234567890000
  }
}
```

---

### 2. Get Channel Messages
**GET** `/official-ch/messages?limit=50`

Retrieves messages from the official channel with sender information.

**Authentication:** Required

**Query Parameters:**
- `limit` (optional): Number of messages to fetch (default: 50)

**Response:**
```json
[
  {
    "id": "message_id",
    "senderId": "user_id",
    "senderInfo": {
      "chatId": "user_id",
      "name": "John Doe",
      "username": "johndoe",
      "avatar": "/avatars/user.png",
      "verified": true
    },
    "text": "Message content",
    "timestamp": 1234567890000,
    "edited": false,
    "reactions": [
      {"emoji": "👍", "count": 5}
    ],
    "replyTo": null,
    "file": null
  }
]
```

---

### 3. Send Message to Channel
**POST** `/official-ch/send`

Send a new message to the official channel.

**Authentication:** Required  
**Permission:** Verified users only (`verified: true`)

**Request Body:**
```json
{
  "text": "Message content",
  "replyToId": "optional_message_id",
  "file": {
    "fileId": "file_id",
    "filename": "file.pdf",
    "size": 1024,
    "mimeType": "application/pdf"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "new_message_id"
}
```

**Errors:**
- `403 Forbidden`: User is not verified
- `400 Bad Request`: Empty message

---

### 4. Edit Channel Message
**PUT** `/official-ch/edit/{message_id}`

Edit an existing message in the channel.

**Authentication:** Required  
**Permission:** Only the original sender can edit their message

**Request Body:**
```json
{
  "text": "Updated message content"
}
```

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- `403 Forbidden`: User is not the message sender
- `404 Not Found`: Message doesn't exist
- `400 Bad Request`: Empty text

---

### 5. Delete Channel Message
**DELETE** `/official-ch/delete/{message_id}`

Delete a message from the channel.

**Authentication:** Required  
**Permission:** Any verified user can delete messages

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- `403 Forbidden`: User is not verified
- `404 Not Found`: Message doesn't exist

---

### 6. React to Channel Message
**POST** `/official-ch/react/{message_id}`

Add or toggle a reaction on a channel message.

**Authentication:** Required  
**Permission:** All users (including non-verified)

**Request Body:**
```json
{
  "emoji": "👍"
}
```

**Valid Emojis:** `["👍", "👎", "🤣", "😢", "❤️", "💔", "😐"]`

**Response:**
```json
{
  "reactions": [
    {"emoji": "👍", "count": 6}
  ]
}
```

---

## Permissions Summary

| Action | Verified Users | Non-Verified Users |
|--------|----------------|--------------------|
| View messages | ✅ Yes | ✅ Yes |
| Send messages | ✅ Yes | ❌ No |
| Edit own messages | ✅ Yes | ❌ No |
| Delete any message | ✅ Yes | ❌ No |
| React to messages | ✅ Yes | ✅ Yes |
| Forward messages | ✅ Yes | ✅ Yes |
| Copy message text | ✅ Yes | ✅ Yes |

## WebSocket Events

The official channel broadcasts real-time updates to all connected users:

### New Message
```json
{
  "type": "official_ch_message",
  "message": {
    "id": "message_id",
    "senderId": "user_id",
    "senderInfo": {...},
    "text": "Message content",
    "timestamp": 1234567890000,
    "edited": false,
    "reactions": [],
    "replyTo": null,
    "file": null
  }
}
```

### Message Edited
```json
{
  "type": "official_ch_edited",
  "message": {...}
}
```

### Message Deleted
```json
{
  "type": "official_ch_deleted",
  "messageId": "message_id"
}
```

### Reaction Updated
```json
{
  "type": "official_ch_reaction",
  "messageId": "message_id",
  "reactions": [{"emoji": "👍", "count": 5}]
}
```

## Integration Notes

### Frontend Integration
1. The channel should appear in the chat list with ID: `official_ch`
2. Channel info endpoint provides last message for chat list preview
3. Use `/official-ch/messages` instead of regular `/chats/{id}/messages`
4. Messages include `senderInfo` field for displaying sender details
5. Subscribe to WebSocket events with `type` starting with `official_ch_`

### Message Context Menu
For verified users:
- React, Forward, Copy, Reply, Edit (own messages only), Delete

For non-verified users:
- React, Forward, Copy

### Displaying Messages
- Show sender avatar and name next to left-aligned messages (other users)
- Current user's messages should be right-aligned without sender info
- Display verified badge next to sender names

## Example Usage

### Sending a Message (cURL)
```bash
curl -X POST http://localhost:8000/official-ch/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello from the official channel!"
  }'
```

### Fetching Messages (JavaScript)
```javascript
const response = await fetch('http://localhost:8000/official-ch/messages?limit=50', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const messages = await response.json();
```

### Reacting to a Message (JavaScript)
```javascript
const response = await fetch(`http://localhost:8000/official-ch/react/${messageId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ emoji: '👍' })
});
```

## Testing

To test the official channel endpoints:

1. Make sure at least one user has `verified: true` in the database
2. Use `/official-ch/send` to post test messages
3. Test permissions by trying actions with non-verified users
4. Verify WebSocket broadcasts by connecting multiple clients

## Migration Notes

When deploying this feature:
1. The `official_ch` collection will be created automatically on first message
2. Index on `timestamp` is created at startup for efficient queries
3. No migration scripts needed - feature is backward compatible
