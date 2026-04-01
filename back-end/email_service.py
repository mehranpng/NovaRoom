import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import ssl
import random
import string
import asyncio
from typing import Optional
from datetime import datetime, timedelta, timezone

SMTP_SERVER = "mc.mailfa.com"
SMTP_PORT = 587
EMAIL_SENDER = "novaroom@mailfa.com"
APP_PASSWORD = "AyHQyuWKiX5zZsji"

verification_codes = {}
password_reset_codes = {}


def generate_verification_code(length: int = 6) -> str:
    """Generate a random verification code"""
    return "".join(random.choices(string.digits, k=length))


async def send_email_async(receiver_email: str, subject: str, body: str) -> bool:
    """Send email asynchronously"""

    def _send_email():
        try:
            message = MIMEMultipart()
            message["From"] = EMAIL_SENDER
            message["To"] = receiver_email
            message["Subject"] = subject
            message.attach(MIMEText(body, "plain", "utf-8"))

            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.starttls(context=context)
                server.login(EMAIL_SENDER, APP_PASSWORD)
                server.send_message(message)
            return True
        except Exception as e:
            print(f"Email sending error: {e}")
            return False

    return await asyncio.to_thread(_send_email)


async def send_verification_email(email: str) -> Optional[str]:
    """Send verification code to email and store it temporarily"""
    code = generate_verification_code()

    subject = "کد تأیید ثبت‌نام NovaRoom"
    body = f"""
سلام،

کد تأیید شما برای ثبت‌نام در NovaRoom:

{code}

این کد تا 10 دقیقه دیگر معتبر است.

اگر شما درخواست ثبت‌نام نکرده‌اید، این ایمیل را نادیده بگیرید.

با احترام،
تیم NovaRoom
    """

    success = await send_email_async(email, subject, body)

    if success:
        verification_codes[email] = {
            "code": code,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }
        return code

    return None


async def verify_code(email: str, code: str) -> bool:
    """Verify if the code is correct and not expired"""
    if email not in verification_codes:
        return False

    stored_data = verification_codes[email]

    if datetime.now(timezone.utc) > stored_data["expires_at"]:
        del verification_codes[email]
        return False

    if stored_data["code"] != code:
        return False

    del verification_codes[email]
    return True


async def send_password_reset_email(email: str) -> Optional[str]:
    """Send password reset code to email"""
    code = generate_verification_code()

    subject = "کد بازیابی رمز عبور NovaRoom"
    body = f"""
سلام،

کد بازیابی رمز عبور شما:

{code}

این کد تا 10 دقیقه دیگر معتبر است.

اگر شما درخواست بازیابی رمز عبور نکرده‌اید، این ایمیل را نادیده بگیرید و رمز عبور خود را تغییر دهید.

با احترام،
تیم NovaRoom
    """

    success = await send_email_async(email, subject, body)

    if success:
        password_reset_codes[email] = {
            "code": code,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }
        return code

    return None


async def verify_reset_code(email: str, code: str) -> bool:
    """Verify if the password reset code is correct and not expired"""
    if email not in password_reset_codes:
        return False

    stored_data = password_reset_codes[email]

    if datetime.now(timezone.utc) > stored_data["expires_at"]:
        del password_reset_codes[email]
        return False

    if stored_data["code"] != code:
        return False

    return True


async def clear_reset_code(email: str):
    """Clear the password reset code after successful password change"""
    if email in password_reset_codes:
        del password_reset_codes[email]
