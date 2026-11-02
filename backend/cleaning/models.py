import uuid
from django.db import models
from django.conf import settings


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session_key_hash = models.CharField(max_length=64, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=[("empty", "Empty"), ("ready", "Ready"), ("expired", "Expired")],
        default="empty",
    )
    original_path = models.CharField(max_length=512, null=True, blank=True)
    current_path = models.CharField(max_length=512, null=True, blank=True)
    previous_path = models.CharField(max_length=512, null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)
    last_applied_job_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Workspace {self.id}"


class UploadedFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="uploaded_file"
    )
    original_name = models.CharField(max_length=255)
    format = models.CharField(max_length=10, choices=[("csv", "CSV"), ("xlsx", "XLSX")])
    storage_path = models.CharField(max_length=512)
    sha256 = models.CharField(max_length=64)
    sheet_name = models.CharField(max_length=255, null=True, blank=True)
    columns_json = models.JSONField()
    row_count = models.IntegerField()
    column_count = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class CleaningJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="jobs"
    )
    base_revision = models.PositiveIntegerField()
    instruction = models.TextField()
    operation = models.CharField(
        max_length=50,
        choices=[
            ("regex_replace", "Regex Replace"),
            ("normalise_values", "Normalise Values"),
            ("normalise_missing", "Normalise Missing"),
        ],
        null=True,
        blank=True,
    )
    target_column_id = models.CharField(max_length=100, null=True, blank=True)
    action = models.CharField(
        max_length=20,
        choices=[("replace", "Replace"), ("remove", "Remove")],
        null=True,
        blank=True,
    )
    replacement_value = models.TextField(null=True, blank=True)
    status = models.CharField(
        max_length=30,
        choices=[
            ("queued", "Queued"),
            ("running", "Running"),
            ("needs_input", "Needs Input"),
            ("awaiting_consent", "Awaiting Consent"),
            ("ready", "Ready"),
            ("failed", "Failed"),
            ("applied", "Applied"),
            ("undone", "Undone"),
            ("cancelled", "Cancelled"),
        ],
        default="queued",
    )
    plan_json = models.JSONField(null=True, blank=True)
    impact_json = models.JSONField(null=True, blank=True)
    plan_hash = models.CharField(max_length=64, null=True, blank=True)
    scope_json = models.JSONField(null=True, blank=True)
    consent_json = models.JSONField(null=True, blank=True)
    risk_ack_hash = models.CharField(max_length=64, null=True, blank=True)
    result_path = models.CharField(max_length=512, null=True, blank=True)
    error_code = models.CharField(max_length=100, null=True, blank=True)
    attempt_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class CleaningSuggestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        CleaningJob, on_delete=models.CASCADE, related_name="suggestions"
    )
    candidate_id = models.CharField(max_length=100)
    original_value = models.TextField(null=True, blank=True)
    proposed_value = models.TextField(null=True, blank=True)
    ai_status = models.CharField(
        max_length=30,
        choices=[
            ("proposed", "Proposed"),
            ("needs_review", "Needs Review"),
            ("unchanged", "Unchanged"),
            ("missing", "Missing"),
            ("valid", "Valid"),
            ("uncertain", "Uncertain"),
        ],
    )
    reason = models.TextField(null=True, blank=True)
    occurrences = models.IntegerField(default=0)
    selected = models.BooleanField(default=False)

    class Meta:
        unique_together = ("job", "candidate_id")
