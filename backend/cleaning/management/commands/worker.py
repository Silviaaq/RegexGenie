import time
from django.core.management.base import BaseCommand
from django.utils import timezone
from cleaning.models import CleaningJob, Workspace
from cleaning.services.jobs import work_one
from cleaning.services.files import ROOT


class Command(BaseCommand):
    help = "Run the single-container cleaning worker and temporary workspace cleanup."

    def handle(self, *args, **options):
        CleaningJob.objects.filter(status__in=["queued", "running"]).update(
            status="failed",
            error_code="INTERRUPTED",
            impact_json={"message": "The service restarted. Generate a new preview."},
        )
        last = 0
        while True:
            if time.monotonic() - last > 60:
                Workspace.objects.filter(expires_at__lte=timezone.now()).delete()
                from pathlib import Path

                paths = set()
                for w in Workspace.objects.all():
                    paths.update([w.original_path, w.current_path, w.previous_path])
                for j in CleaningJob.objects.all():
                    paths.add(j.result_path)
                for p in ROOT.glob("*"):
                    if str(p) not in paths and time.time() - p.stat().st_mtime > 1800:
                        p.unlink(missing_ok=True)
                last = time.monotonic()
            try:
                if not work_one():
                    time.sleep(0.5)
            except Exception:
                time.sleep(1)
