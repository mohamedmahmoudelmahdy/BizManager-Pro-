import uuid
from pathlib import Path
from django.conf import settings
from django.db import models

from customers.models import Customer


def document_upload_path(instance: "Document", filename: str) -> str:
    return f"documents/{instance.customer_id}/{filename}"


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="documents")
    file = models.FileField(upload_to=document_upload_path)
    original_name = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.original_name:
            self.original_name = Path(self.file.name).name
        super().save(*args, **kwargs)

    def __str__(self):
        return self.original_name or str(self.id)
