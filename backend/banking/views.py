from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.permissions import IsAdminManagerEmployeeCashier, IsAdminOrManager
from .models import BankCard, BankStatementComparisonJob
from .serializers import BankCardSerializer
from .services.payment_method_statement import build_payment_method_statement
from .services.statement_comparison import (
    create_statement_comparison_job,
    serialize_comparison_job,
)


class BankCardViewSet(viewsets.ModelViewSet):
    queryset = BankCard.objects.all()
    serializer_class = BankCardSerializer
    permission_classes = [IsAdminManagerEmployeeCashier]
    pagination_class = None

    def get_permissions(self):
        if self.action in ("statement_comparison_jobs", "statement_comparison_job_detail"):
            return [IsAdminOrManager()]
        return super().get_permissions()

    @action(detail=True, methods=["get"], url_path="statement")
    def statement(self, request, pk=None):
        card = self.get_object()
        data = build_payment_method_statement(
            card,
            date_from=request.query_params.get("date_from"),
            date_to=request.query_params.get("date_to"),
            source_type=request.query_params.get("source_type"),
        )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="statement-comparison/jobs")
    def statement_comparison_jobs(self, request, pk=None):
        card = self.get_object()
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            job = create_statement_comparison_job(
                card,
                upload,
                upload.name,
                request.user,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response(
                {"detail": f"Statement comparison failed: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(serialize_comparison_job(job), status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["get", "delete"],
        url_path=r"statement-comparison/jobs/(?P<job_id>[^/.]+)",
    )
    def statement_comparison_job_detail(self, request, pk=None, job_id=None):
        card = self.get_object()
        try:
            job = BankStatementComparisonJob.objects.get(pk=job_id, payment_method=card)
        except BankStatementComparisonJob.DoesNotExist:
            return Response({"detail": "Comparison job not found."}, status=status.HTTP_404_NOT_FOUND)

        if request.method == "DELETE":
            job.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(serialize_comparison_job(job))
