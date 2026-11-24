from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
import secrets, hashlib, hmac

ph = PasswordHasher()

def hp(pw: str) -> str:
    """Hash password using Argon2id with salt."""
    try:
        return ph.hash(pw)
    except Exception:
        salt = secrets.token_hex(8)
        return f"pbkdf2${salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 200_000).hex()}"

def vp(pw: str, hash_str: str) -> bool:
    """Verify password against Argon2id or legacy hash."""
    if not hash_str:
        return False
    if hash_str.startswith("$argon2"):
        try:
            return ph.verify(hash_str, pw)
        except (VerifyMismatchError, VerificationError):
            return False
    elif "$" in hash_str:
        parts = hash_str.split("$")
        salt = parts[1] if parts[0] == "pbkdf2" else parts[0]
        expected = f"{salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 200_000).hex()}"
        actual = hash_str if parts[0] != "pbkdf2" else f"{salt}${parts[2]}"
        return hmac.compare_digest(expected, actual)
    return False
