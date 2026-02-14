# NovaRoom API Documentation

## Authentication & Registration Endpoints

### 1. Register - Step 1: Send Email Verification Code

**Endpoint:** `POST /auth/register/email`

**Description:** Sends a 6-digit verification code to the provided email address.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "Verification code sent to email",
  "email": "user@example.com"
}
```

**Error Responses:**
- `409 Conflict`: Email already registered
- `500 Internal Server Error`: Failed to send verification email

---

### 2. Register - Step 2: Verify Code

**Endpoint:** `POST /auth/register/verify`

**Description:** Verifies the 6-digit code sent to email. Code expires after 10 minutes.

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Success Response (200):**
```json
{
  "message": "Code verified successfully",
  "email": "user@example.com"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid or expired verification code

---

### 3. Register - Step 3: Complete Registration

**Endpoint:** `POST /auth/register/complete`

**Description:** Completes the registration by creating the user account with name, username, and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "username": "johndoe",
  "password": "securePassword123"
}
```

**Success Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "chatId": "user_abc123def456",
    "username": "johndoe",
    "name": "John Doe",
    "bio": "",
    "avatar": "",
    "online": false,
    "verified": false
  }
}
```

**Error Responses:**
- `400 Bad Request`: Invalid username format (only letters, numbers, and underscores, max 32 characters)
- `409 Conflict`: Email already registered or username already taken
- `500 Internal Server Error`: Failed to create user

**Notes:**
- Username must contain only alphanumeric characters and underscores
- Username must be 1-32 characters long
- Registration date is automatically saved in Jalali (Persian) format
- Password is hashed using bcrypt before storage

---

### 4. Login

**Endpoint:** `POST /auth/login`

**Description:** Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Success Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "chatId": "user_abc123def456",
    "username": "johndoe",
    "name": "John Doe",
    "bio": "User bio",
    "avatar": "avatar_url",
    "online": false,
    "verified": false
  }
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid credentials

---

### 5. Password Reset - Step 1: Request Reset Code

**Endpoint:** `POST /auth/password-reset/request`

**Description:** Sends a 6-digit password reset code to the email if it exists in the system.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "message": "If the email exists, a reset code has been sent"
}
```

**Note:** For security reasons, the response doesn't reveal whether the email exists in the system.

---

### 6. Password Reset - Step 2: Verify Code and Reset Password

**Endpoint:** `POST /auth/password-reset/verify`

**Description:** Verifies the reset code and changes the password. Code expires after 10 minutes.

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456",
  "new_password": "newSecurePassword123"
}
```

**Success Response (200):**
```json
{
  "message": "Password reset successful"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid or expired reset code
- `404 Not Found`: User not found

---

## Registration Flow Summary

1. **User enters email** → Call `/auth/register/email`
2. **User receives email with code** → User enters code
3. **Verify code** → Call `/auth/register/verify`
4. **User enters name, username, password** → Call `/auth/register/complete`
5. **User is logged in automatically** with returned token

## Password Reset Flow Summary

1. **User clicks "Forgot Password"** on login page
2. **User enters email** → Call `/auth/password-reset/request`
3. **User receives email with code** → User enters code and new password
4. **Verify and reset** → Call `/auth/password-reset/verify`
5. **User can now login** with new password

## Security Features

- All verification codes expire after 10 minutes
- Passwords are hashed using bcrypt
- JWT tokens expire after 7 days
- Password reset doesn't reveal if email exists (security best practice)
- Username uniqueness is case-insensitive
- Email uniqueness is enforced at database level

## Dependencies Required

Make sure to install these Python packages:

```bash
pip install fastapi uvicorn motor pymongo bcrypt pyjwt python-dotenv jdatetime
```

## Email Configuration

The email service is configured in `email_service.py` with these settings:

- SMTP Server: mc.mailfa.com
- SMTP Port: 587
- Sender: novaroom@mailfa.com

**Note:** Update these credentials in production for security.

## Frontend Integration Notes

### Registration Page Flow:

1. Create a form with email input
2. After email submission, show code input field
3. After code verification, show name, username, and password fields
4. Store the returned token in localStorage/sessionStorage
5. Redirect to main app

### Login Page:

- Add a "Forgot Password?" link that opens password reset flow
- Add a "Don't have an account? Sign up" link to registration page

### Password Reset Page:

- Email input → Code input + New password input
- After successful reset, redirect to login page with success message
