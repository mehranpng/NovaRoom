# File Upload Feature Documentation

## Overview
This feature allows users to upload and share files (up to 3MB) in chats, saved messages, and AI conversations.

## Technical Implementation

### Architecture
- **File Storage**: Files are stored on the file system in the `uploads/` directory
- **Database**: Only file metadata (ID, name, size, MIME type) is stored in MongoDB
- **Security**: File validation, sanitization, and access control implemented

### Key Components

#### 1. `file_service.py`
Core file management module containing:
- `save_uploaded_file()`: Handles file upload, validation, and storage
- `delete_file()`: Removes files from disk
- `validate_file_access()`: Checks if file exists
- `get_file_path()`: Returns file path with path traversal protection
- `cleanup_orphaned_files()`: Maintenance function for orphaned files

#### 2. API Endpoints

**POST /files/upload**
- Upload a file (max 3MB)
- Requires authentication
- Returns file metadata
- Request: `multipart/form-data` with `file` field
- Response:
```json
{
  "success": true,
  "file": {
    "fileId": "abc123.pdf",
    "fileName": "document.pdf",
    "fileSize": 1024000,
    "mimeType": "application/pdf",
    "uploadedAt": "2026-02-16T00:20:00Z"
  }
}
```

**GET /files/{file_id}**
- Download a file
- Requires authentication
- Returns file as download

#### 3. WebSocket Message Structure

Messages can now include file data:
```json
{
  "type": "message",
  "chatId": "chat_abc_xyz",
  "text": "Check this file",
  "file": {
    "fileId": "abc123.pdf",
    "fileName": "document.pdf",
    "fileSize": 1024000,
    "mimeType": "application/pdf",
    "uploadedAt": "2026-02-16T00:20:00Z"
  }
}
```

### Message Document Schema

Messages in MongoDB now support an optional `file` field:
```python
{
  "_id": ObjectId,
  "chatId": str,
  "senderId": str,
  "text": str,  # Optional if file is present
  "timestamp": datetime,
  "seenBy": [str],
  "replyTo": dict | None,
  "reactions": [dict],
  "forwardedFrom": dict | None,
  "file": {  # NEW FIELD
    "fileId": str,
    "fileName": str,
    "fileSize": int,
    "mimeType": str,
    "uploadedAt": datetime
  } | None
}
```

## Security Features

1. **File Size Limit**: 3MB maximum
2. **Type Validation**: Dangerous executables (.exe, .bat, etc.) are blocked
3. **Filename Sanitization**: Prevents path traversal attacks
4. **Authentication**: All endpoints require valid JWT token
5. **Access Control**: Users can only download files they have access to

## Usage Flow

### Upload Flow
1. Client uploads file to `POST /files/upload`
2. Server validates size and type
3. File is saved with unique ID
4. Server returns metadata
5. Client sends message via WebSocket with file metadata
6. Message is broadcast to participants

### Download Flow
1. Client clicks download button
2. Client requests `GET /files/{file_id}`
3. Server validates access
4. File is streamed to client

### Delete Flow
1. User deletes message with file
2. Server deletes message from database
3. Server deletes associated file from disk
4. Delete event is broadcast to participants

## Supported Features

✅ Upload files in regular chats
✅ Upload files in saved messages
✅ Forward messages with files
✅ Delete messages with files (auto-deletes file)
✅ Edit message text (file remains)
✅ React to messages with files
✅ Reply to messages with files

## Installation

1. Install dependencies:
```bash
cd back-end
pip install -r requirements.txt
```

2. The `uploads/` directory will be created automatically on first run

3. Ensure proper file permissions for the uploads directory

## Maintenance

### Cleanup Orphaned Files

You can periodically clean up files that are no longer referenced in the database:

```python
from file_service import cleanup_orphaned_files
from motor.motor_asyncio import AsyncIOMotorClient

# Get all file IDs from database
db_file_ids = set()
async for msg in cl_messages.find({"file": {"$exists": True}}):
    if msg.get("file", {}).get("fileId"):
        db_file_ids.add(msg["file"]["fileId"])

# Clean up orphaned files
deleted_count = await cleanup_orphaned_files(db_file_ids)
print(f"Deleted {deleted_count} orphaned files")
```

## Environment Variables

No additional environment variables required. Files are stored in the `uploads/` directory relative to the `back-end` folder.

## Notes

- Files are NOT stored in MongoDB (only metadata)
- File IDs are UUIDs with original extension preserved
- Original filenames are sanitized but preserved for display
- Forward messages preserve file references (no duplication)
- Deleting a chat deletes all associated files

## Future Enhancements

- [ ] Chunk upload for larger files
- [ ] Image thumbnails
- [ ] Video/audio preview
- [ ] Cloud storage integration (S3, etc.)
- [ ] Virus scanning
- [ ] File compression
