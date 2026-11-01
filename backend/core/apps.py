from django.apps import AppConfig
from django.db.backends.signals import connection_created


def secure_sqlite(sender, connection, **kwargs):
    if connection.vendor == "sqlite":
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA secure_delete=ON")


class CoreConfig(AppConfig):
    name = "core"

    def ready(self):
        connection_created.connect(
            secure_sqlite, dispatch_uid="regexgenie_secure_delete"
        )
