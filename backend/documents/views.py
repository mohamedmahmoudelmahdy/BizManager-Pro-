import io
import zipfile
from django.http import HttpResponse
from rest_framework import viewsets
from accounts.permissions import IsAdminManagerEmployee
from rest_framework.views import APIView

from .models import Document
from .serializers import DocumentSerializer


class DocumentViewSet(viewsets.ModelViewSet):
    serializer_class = DocumentSerializer
    permission_classes = [IsAdminManagerEmployee]
    pagination_class = None

    def get_queryset(self):
        queryset = Document.objects.select_related("customer", "uploaded_by").all()
        customer_id = self.request.query_params.get("customer")
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class ZipDocumentsView(APIView):
    permission_classes = [IsAdminManagerEmployee]

    def get(self, _request, company_id):
        documents = Document.objects.filter(customer_id=company_id)
        if not documents.exists():
            return HttpResponse(status=404)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for doc in documents:
                if doc.file:
                    zip_file.writestr(doc.original_name or doc.file.name, doc.file.read())

        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{company_id}-documents.zip"'
        return response
