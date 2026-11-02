from django.urls import path
from core import views as v
from cleaning import views as c

urlpatterns = [
    path("api/health", v.health),
    path("api/config", v.config),
    path("api/datasets", v.upload),
    path("api/datasets/<uuid:id>/select-sheet", v.select),
    path("api/datasets/<uuid:id>/rows", v.original_rows),
    path("api/datasets/<uuid:id>", v.delete),
    path("api/transformations", v.transform),
    path("api/transformations/<uuid:id>", v.result),
    path("api/transformations/<uuid:id>/rows", v.result_rows),
    path("api/transformations/<uuid:id>/targets/<int:ordinal>", v.target),
    path("api/transformations/<uuid:id>/download", v.download),
    path("api/health/", v.health),
    path("api/workspaces/", c.create),
    path("api/workspaces/<uuid:id>/upload/", c.upload),
    path("api/workspaces/<uuid:id>/data/", c.data),
    path("api/workspaces/<uuid:id>/jobs/", c.submit),
    path("api/workspaces/<uuid:id>/values/", c.distinct),
    path("api/workspaces/<uuid:id>/action/", c.action),
    path("api/workspaces/<uuid:id>/export/", c.export),
    path("api/jobs/<uuid:id>/", c.status),
    path("api/jobs/<uuid:id>/scope-consent/", c.consent),
    path("api/jobs/<uuid:id>/suggestions/", c.suggestions),
    path("api/jobs/<uuid:id>/apply/", c.apply),
    path("app", v.index),
    path("", v.index),
]
