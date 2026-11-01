import time
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from core.lifecycle import clean_expired


class Command(BaseCommand):
    help = "Delete expired temporary datasets and results; --loop sweeps every minute."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true")

    def handle(self, *args, **options):
        while True:
            close_old_connections()
            clean_expired()
            if not options["loop"]:
                break
            time.sleep(60)
