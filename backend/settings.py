import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("Set DJANGO_SECRET_KEY before starting Django.")
ALLOWED_HOSTS = os.getenv(
    "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver"
).split(",")
ROOT_URLCONF = "urls"
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "core.apps.CoreConfig",
    "cleaning",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "core.views.LifecycleMiddleware",
]
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "private.sqlite3",
    }
}
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 1800
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = [x for x in os.getenv("DJANGO_CSRF_ORIGINS", "").split(",") if x]
DATA_UPLOAD_MAX_MEMORY_SIZE = 11 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Runtime data is disposable; the container uses /tmp and never backs it up.
DATABASES["default"]["NAME"] = os.getenv(
    "DATABASE_PATH", str(BASE_DIR / "private.sqlite3")
)
DATABASES["default"]["OPTIONS"] = {"timeout": 20}
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
if os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])
    CSRF_TRUSTED_ORIGINS.append("https://" + os.environ["RENDER_EXTERNAL_HOSTNAME"])
CSRF_FAILURE_VIEW = "core.views.csrf_failure"

STATIC_ROOT = BASE_DIR.parent / "dist" / "assets"
STATIC_URL = "/assets/"
WHITENOISE_USE_FINDERS = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_SAVE_EVERY_REQUEST = True
X_FRAME_OPTIONS = "DENY"
MIDDLEWARE.append("django.middleware.clickjacking.XFrameOptionsMiddleware")
