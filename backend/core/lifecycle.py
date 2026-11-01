"""Temporary workspace cleanup; user files are not archival storage."""

from datetime import timedelta
from django.utils import timezone
from django.contrib.sessions.models import Session
from .models import Dataset


def clean_expired():
    count, _ = Dataset.objects.filter(expires_at__lte=timezone.now()).delete()
    Session.objects.filter(expire_date__lte=timezone.now()).delete()
    return count
