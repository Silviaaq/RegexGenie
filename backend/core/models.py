import uuid
from django.db import models


class Dataset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.CharField(max_length=64, db_index=True)
    name = models.CharField(max_length=255)
    checksum = models.CharField(max_length=64)
    sheets = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)


class Transformation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(Dataset, on_delete=models.CASCADE)
    sheet = models.CharField(max_length=255)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
