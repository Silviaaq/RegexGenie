from django.urls import path
from core import views as v

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
    path("", v.index),
]
