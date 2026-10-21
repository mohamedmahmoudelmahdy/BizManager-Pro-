import csv
from decimal import Decimal
from zipfile import BadZipFile

from django.http import HttpResponse
from django.utils import timezone
from openpyxl.utils.exceptions import InvalidFileException
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    CheckPDC,
    DebtLiability,
    DebtPayment,
    EmployeeAdvance,
    FinancialImportJob,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)
from .permissions import IsFinancialControlReadOrWrite
from .serializers import (
    CheckPDCSerializer,
    DebtLiabilitySerializer,
    DebtPaymentSerializer,
    EmployeeAdvanceSerializer,
    FinancialImportJobListSerializer,
    FinancialImportJobSerializer,
    FinancialImportRowSerializer,
    LedgerAccountSerializer,
    LedgerEntrySerializer,
)
from .services import employee_advances as advances_svc
from .services import ledger as ledger_svc
from .services import ledger_import_delete as ledger_import_delete_svc
from .services.checks import cancel_check, deduct_check, refresh_check_meta, replace_check
from .services.debts import pay_debt, refresh_debt_risk
from .services.import_confirm import confirm_import_job
from .services.import_excel import run_import_preview
from .services.import_mapping import (
    PROFILES,
    SHEET_TYPES,
    SYSTEM_FIELDS,
    summarize_sheets,
    validate_with_mapping,
)
from .services.overview import build_alerts_payload, build_overview_payload
from .services.reports import build_reports_payload

SUPPORTED_IMPORT_FORMATS = [".xlsx", ".xlsm"]


class FinancialControlOverviewView(APIView):
    permission_classes = [IsFinancialControlReadOrWrite]

    def get(self, request):
        return Response(build_overview_payload())


class FinancialControlAlertsView(APIView):
    permission_classes = [IsFinancialControlReadOrWrite]

    def get(self, request):
        return Response(build_alerts_payload())


class FinancialControlReportsView(APIView):
    permission_classes = [IsFinancialControlReadOrWrite]

    def get(self, request):
        return Response(
            build_reports_payload(
                period_start=request.query_params.get("period_start"),
                period_end=request.query_params.get("period_end"),
            )
        )


class LedgerAccountViewSet(viewsets.ModelViewSet):
    queryset = LedgerAccount.objects.select_related(
        "linked_customer",
        "linked_employee",
        "linked_payment_method",
        "created_by",
    ).all()
    serializer_class = LedgerAccountSerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None

    def perform_create(self, serializer):
        opening = serializer.validated_data.get("opening_balance_amount") or Decimal("0")
        ob_type = serializer.validated_data.get(
            "opening_balance_type", LedgerAccount.OpeningBalanceType.DEBIT
        )
        if ob_type == LedgerAccount.OpeningBalanceType.CREDIT:
            balance = opening
        else:
            balance = -opening
        account = serializer.save(created_by=self.request.user, current_balance=balance)
        if opening > 0:
            entry_type = (
                LedgerEntry.EntryType.CREDIT
                if ob_type == LedgerAccount.OpeningBalanceType.CREDIT
                else LedgerEntry.EntryType.DEBIT
            )
            entry = LedgerEntry.objects.create(
                ledger_account=account,
                date=timezone.localdate(),
                description="Opening balance",
                entry_type=entry_type,
                amount=opening,
                previous_balance=Decimal("0"),
                resulting_balance=balance,
                running_balance=balance,
                status=LedgerEntry.Status.POSTED,
                source_type=LedgerEntry.SourceType.MANUAL,
                created_by=self.request.user,
            )
            account.last_activity_at = timezone.now()
            account.save(update_fields=["last_activity_at", "updated_at"])

    @action(detail=True, methods=["post"], url_path="close")
    def close_account(self, request, pk=None):
        account = self.get_object()
        try:
            account = ledger_svc.close_ledger_account(
                account, reason=request.data.get("reason", "")
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(LedgerAccountSerializer(account).data)

    @action(detail=True, methods=["post"], url_path="reopen")
    def reopen_account(self, request, pk=None):
        account = self.get_object()
        account.status = LedgerAccount.Status.ACTIVE
        account.closed_at = None
        account.closed_reason = ""
        account.save(update_fields=["status", "closed_at", "closed_reason", "updated_at"])
        return Response(LedgerAccountSerializer(account).data)

    @action(detail=True, methods=["post"], url_path="reconcile")
    def reconcile_account(self, request, pk=None):
        account = self.get_object()
        account = ledger_svc.reconcile_account_entries(account)
        return Response(LedgerAccountSerializer(account).data)

    @action(detail=True, methods=["post"], url_path="delete-imported")
    def delete_imported(self, request, pk=None):
        if getattr(request.user, "role", "") != "admin":
            return Response(
                {"detail": "Only admins can delete imported ledger accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )
        account = self.get_object()
        try:
            result = ledger_import_delete_svc.delete_imported_ledger_account(account)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(result)

    @action(detail=True, methods=["get", "post"], url_path="entries")
    def entries(self, request, pk=None):
        account = self.get_object()
        if request.method == "GET":
            qs = (
                account.entries.select_related("created_by", "ledger_account")
                .order_by("-date", "-created_at")
            )
            return Response(LedgerEntrySerializer(qs, many=True).data)

        # The account comes from the URL, so inject it before validation —
        # the client does not (and should not) send ledger_account in the body.
        data = request.data.copy()
        data["ledger_account"] = account.id
        serializer = LedgerEntrySerializer(data=data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.save(ledger_account=account, created_by=request.user)

        if request.data.get("post_now", True) and entry.status == LedgerEntry.Status.DRAFT:
            try:
                entry = ledger_svc.post_ledger_entry(entry)
            except ValueError as exc:
                raise ValidationError({"detail": str(exc)}) from exc
        elif entry.status == LedgerEntry.Status.DRAFT:
            entry.previous_balance = account.current_balance
            entry.resulting_balance = account.current_balance
            entry.running_balance = account.current_balance
            entry.save(update_fields=["previous_balance", "resulting_balance", "running_balance"])

        account.refresh_from_db()
        return Response(LedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class LedgerEntryViewSet(viewsets.ModelViewSet):
    queryset = LedgerEntry.objects.select_related(
        "ledger_account", "created_by", "related_payment_method"
    ).all()
    serializer_class = LedgerEntrySerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_create(self, serializer):
        account = serializer.validated_data["ledger_account"]
        entry = serializer.save(created_by=self.request.user, status=LedgerEntry.Status.DRAFT)
        entry.previous_balance = account.current_balance
        entry.resulting_balance = account.current_balance
        entry.running_balance = account.current_balance
        entry.save(update_fields=["previous_balance", "resulting_balance", "running_balance"])

    @action(detail=True, methods=["post"], url_path="post")
    def post_entry(self, request, pk=None):
        entry = self.get_object()
        try:
            entry = ledger_svc.post_ledger_entry(entry)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(LedgerEntrySerializer(entry).data)

    @action(detail=True, methods=["post"], url_path="reconcile")
    def reconcile_entry(self, request, pk=None):
        entry = self.get_object()
        try:
            entry = ledger_svc.reconcile_ledger_entry(entry)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(LedgerEntrySerializer(entry).data)

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse_entry(self, request, pk=None):
        entry = self.get_object()
        allowed, block_reason = ledger_svc.can_reverse_ledger_entry_generically(entry)
        if not allowed:
            raise ValidationError({"detail": block_reason})
        try:
            original, reversal = ledger_svc.reverse_ledger_entry(
                entry, request.user, reason=request.data.get("reason", "")
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(
            {
                "original": LedgerEntrySerializer(original).data,
                "reversal": LedgerEntrySerializer(reversal).data,
            }
        )


class CheckPDCViewSet(viewsets.ModelViewSet):
    queryset = CheckPDC.objects.select_related(
        "bank_account", "linked_ledger_account", "created_by"
    ).all()
    serializer_class = CheckPDCSerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None

    def perform_create(self, serializer):
        check = serializer.save(created_by=self.request.user)
        refresh_check_meta(check)

    def perform_update(self, serializer):
        check = serializer.save()
        refresh_check_meta(check)

    @action(detail=True, methods=["post"], url_path="deduct")
    def deduct(self, request, pk=None):
        check = self.get_object()
        try:
            result = deduct_check(
                check,
                request.user,
                payment_method_id=request.data.get("payment_method_id")
                or request.data.get("bank_account_id"),
                expense_category=request.data.get("expense_category", "misc"),
                create_expense=request.data.get("create_expense", True) is not False,
                create_ledger_entry=request.data.get("create_ledger_entry", True) is not False,
                notes=request.data.get("notes", ""),
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(
            {
                "check": CheckPDCSerializer(result["check"]).data,
                "expense_id": result.get("expense_id"),
                "ledger_entry_id": result.get("ledger_entry_id"),
            }
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        check = self.get_object()
        try:
            check = cancel_check(check, reason=request.data.get("reason", ""))
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(CheckPDCSerializer(check).data)

    @action(detail=True, methods=["post"], url_path="replace")
    def replace(self, request, pk=None):
        check = self.get_object()
        required = ["check_number"]
        missing = [f for f in required if not request.data.get(f)]
        if missing:
            raise ValidationError({f: "This field is required." for f in missing})
        try:
            old, new = replace_check(check, request.user, request.data)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(
            {
                "original": CheckPDCSerializer(old).data,
                "replacement": CheckPDCSerializer(new).data,
            }
        )


class DebtLiabilityViewSet(viewsets.ModelViewSet):
    queryset = DebtLiability.objects.select_related(
        "linked_ledger_account", "default_payment_method", "created_by"
    ).all()
    serializer_class = DebtLiabilitySerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None

    def perform_create(self, serializer):
        original = serializer.validated_data.get("original_amount") or Decimal("0")
        debt = serializer.save(
            created_by=self.request.user,
            paid_amount=Decimal("0"),
            remaining_balance=original,
        )
        refresh_debt_risk(debt)

    def perform_update(self, serializer):
        debt = serializer.save()
        refresh_debt_risk(debt)

    @action(detail=True, methods=["post"], url_path="pay")
    def pay(self, request, pk=None):
        debt = self.get_object()
        amount = request.data.get("amount")
        payment_method_id = request.data.get("payment_method_id")
        if not amount:
            raise ValidationError({"amount": "Payment amount is required."})
        if not payment_method_id:
            raise ValidationError({"payment_method_id": "Payment method is required."})
        try:
            result = pay_debt(
                debt,
                request.user,
                amount=Decimal(str(amount)),
                payment_method_id=payment_method_id,
                payment_date=request.data.get("payment_date"),
                reference_number=request.data.get("reference_number", ""),
                notes=request.data.get("notes", ""),
                expense_category=request.data.get("expense_category", "misc"),
                create_expense=request.data.get("create_expense", True) is not False,
                create_ledger_entry=request.data.get("create_ledger_entry", True) is not False,
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(
            {
                "debt": DebtLiabilitySerializer(result["debt"]).data,
                "payment": DebtPaymentSerializer(result["payment"]).data,
                "expense_id": result.get("expense_id"),
                "ledger_entry_id": result.get("ledger_entry_id"),
            }
        )


class DebtPaymentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = DebtPayment.objects.select_related("debt", "payment_method", "created_by").all()
    serializer_class = DebtPaymentSerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None


class FinancialImportJobViewSet(viewsets.ModelViewSet):
    queryset = FinancialImportJob.objects.prefetch_related("rows").select_related("created_by").all()
    serializer_class = FinancialImportJobSerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "delete", "head", "options"]

    # Statuses that represent an unconfirmed job safe to delete (no records created).
    DELETABLE_STATUSES = {
        FinancialImportJob.Status.PENDING,
        FinancialImportJob.Status.PREVIEW,
        FinancialImportJob.Status.VALIDATED,
        FinancialImportJob.Status.FAILED,
        FinancialImportJob.Status.CANCELLED,
    }

    def get_serializer_class(self):
        if self.action == "list":
            return FinancialImportJobListSerializer
        return FinancialImportJobSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.prefetch_related(None)
            if self.request.query_params.get("include_archived") not in ("1", "true", "True"):
                qs = qs.filter(archived=False)
        return qs

    def _import_error(self, detail, field_errors=None, status_code=status.HTTP_400_BAD_REQUEST):
        return Response(
            {
                "detail": detail,
                "field_errors": field_errors or {},
                "supported_formats": SUPPORTED_IMPORT_FORMATS,
            },
            status=status_code,
        )

    def _run_preview_safe(self, job):
        """Run preview parsing, translating workbook errors into a structured response.

        Returns None on success, or a Response describing the failure.
        """
        try:
            run_import_preview(job)
            return None
        except (InvalidFileException, BadZipFile) as exc:
            job.status = FinancialImportJob.Status.FAILED
            job.summary_json = {"error": str(exc)}
            job.save(update_fields=["status", "summary_json"])
            return self._import_error(
                "The file could not be opened. It may be corrupted, password-protected, "
                "or an old .xls file. Please re-save it as .xlsx and try again.",
                {"file": "Unreadable workbook."},
            )
        except Exception as exc:
            job.status = FinancialImportJob.Status.FAILED
            job.summary_json = {"error": str(exc)}
            job.save(update_fields=["status", "summary_json"])
            return self._import_error(f"Could not parse the workbook: {exc}")

    def create(self, request, *args, **kwargs):
        uploaded = request.FILES.get("file")
        if not uploaded:
            return self._import_error(
                "No file was uploaded. Please choose an Excel file.",
                {"file": "Excel file is required."},
            )

        name = (uploaded.name or "").lower()
        if name.endswith(".xls") and not name.endswith((".xlsx", ".xlsm")):
            return self._import_error(
                ".xls is not supported yet. Please save the file as .xlsx and upload again.",
                {"file": "Unsupported format: .xls"},
            )
        if not name.endswith((".xlsx", ".xlsm")):
            return self._import_error(
                "Unsupported file type. Only .xlsx and .xlsm files are supported.",
                {"file": "Unsupported format."},
            )

        profile = request.data.get("profile") or "generic"
        if profile not in PROFILES:
            profile = "generic"
        job = FinancialImportJob.objects.create(
            created_by=request.user,
            original_filename=uploaded.name,
            file=uploaded,
            status=FinancialImportJob.Status.PENDING,
            profile=profile,
        )
        error_response = self._run_preview_safe(job)
        if error_response is not None:
            return error_response

        job.refresh_from_db()
        return Response(
            FinancialImportJobSerializer(job).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="validate")
    def validate(self, request, pk=None):
        job = self.get_object()
        use_mapping = bool((job.mapping_json or {}).get("sheets")) or job.profile in (
            "bizmanager_legacy",
            "custom",
        )
        if use_mapping:
            try:
                validate_with_mapping(job)
            except (InvalidFileException, BadZipFile):
                return self._import_error(
                    "The file could not be opened. Please re-save it as .xlsx and try again.",
                    {"file": "Unreadable workbook."},
                )
            except Exception as exc:  # noqa: BLE001
                job.status = FinancialImportJob.Status.FAILED
                job.summary_json = {**(job.summary_json or {}), "error": str(exc)}
                job.save(update_fields=["status", "summary_json"])
                return self._import_error(f"Could not validate with mapping: {exc}")
        else:
            error_response = self._run_preview_safe(job)
            if error_response is not None:
                return error_response
        job.refresh_from_db()
        return Response(FinancialImportJobSerializer(job).data)

    @action(detail=True, methods=["get"], url_path="sheets")
    def sheets(self, request, pk=None):
        job = self.get_object()
        try:
            data = summarize_sheets(job)
        except (InvalidFileException, BadZipFile):
            return self._import_error(
                "The file could not be opened. Please re-save it as .xlsx and try again.",
                {"file": "Unreadable workbook."},
            )
        except Exception as exc:  # noqa: BLE001
            return self._import_error(f"Could not analyze sheets: {exc}")
        return Response(data)

    @action(detail=True, methods=["post"], url_path="mapping")
    def mapping(self, request, pk=None):
        """Save the per-sheet/column mapping and workbook profile (no row creation)."""
        job = self.get_object()
        profile = request.data.get("profile")
        if profile in PROFILES:
            job.profile = profile
        sheets = request.data.get("sheets")
        if sheets is not None and not isinstance(sheets, dict):
            return self._import_error("`sheets` must be an object keyed by sheet name.")
        mapping = dict(job.mapping_json or {})
        if sheets is not None:
            mapping["sheets"] = sheets
        job.mapping_json = mapping
        job.save(update_fields=["profile", "mapping_json"])
        return Response(
            {
                "detail": "Mapping saved.",
                "profile": job.profile,
                "fields": SYSTEM_FIELDS,
                "sheet_types": SHEET_TYPES,
                "job": FinancialImportJobSerializer(job).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="confirm")
    def confirm(self, request, pk=None):
        job = self.get_object()
        try:
            result = confirm_import_job(job, request.user)
        except ValueError as exc:
            # Roll back already happened inside the atomic service. Persist the
            # failure on the job in a fresh (autocommit) save so the error is kept.
            job.refresh_from_db()
            if job.status not in (
                FinancialImportJob.Status.COMPLETED,
                FinancialImportJob.Status.CONFIRMED,
            ):
                job.status = FinancialImportJob.Status.FAILED
                job.summary_json = {
                    **(job.summary_json or {}),
                    "confirm_disabled": True,
                    "error": str(exc),
                }
                job.save(update_fields=["status", "summary_json"])
            return Response(
                {"detail": str(exc), "code": "import_confirm_failed"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        job.refresh_from_db()
        return Response(
            {
                "detail": "Import completed.",
                "result": result,
                "job": FinancialImportJobSerializer(job).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"], url_path="rows")
    def rows(self, request, pk=None):
        """Paginated preview rows. Never returns the whole 36k-row payload."""
        job = self.get_object()
        qs = FinancialImportRow.objects.filter(job=job).select_related("linked_ledger_entry")
        row_status = request.query_params.get("status")
        if row_status and row_status != "all":
            qs = qs.filter(status=row_status)
        detected = request.query_params.get("detected_type")
        if detected and detected != "all":
            qs = qs.filter(detected_type=detected)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", 100))
        except (TypeError, ValueError):
            page_size = 100
        page_size = max(1, min(page_size, 200))

        count = qs.count()
        start = (page - 1) * page_size
        rows = qs[start : start + page_size]
        total_pages = (count + page_size - 1) // page_size if count else 0
        return Response(
            {
                "count": count,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "results": FinancialImportRowSerializer(rows, many=True).data,
            }
        )

    def destroy(self, request, *args, **kwargs):
        job = self.get_object()
        if job.status not in self.DELETABLE_STATUSES:
            return Response(
                {
                    "detail": "Completed imports cannot be deleted because they created "
                    "financial records. Archive it instead.",
                    "code": "import_delete_blocked",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._delete_job(job)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _delete_job(job):
        """Delete preview rows, the uploaded file, and the job record."""
        if job.file:
            try:
                job.file.delete(save=False)
            except Exception:  # noqa: BLE001 — storage backend issues must not block delete
                pass
        job.delete()  # rows cascade

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        job = self.get_object()
        job.archived = True
        job.save(update_fields=["archived"])
        return Response({"detail": "Import archived.", "id": str(job.id)})

    @action(detail=False, methods=["post"], url_path="clear-unconfirmed")
    def clear_unconfirmed(self, request):
        """Admin-only bulk delete of unconfirmed import jobs to reset after bad tests."""
        if getattr(request.user, "role", "") != "admin":
            return Response(
                {"detail": "Only admins can clear unconfirmed imports."},
                status=status.HTTP_403_FORBIDDEN,
            )
        jobs = FinancialImportJob.objects.filter(status__in=self.DELETABLE_STATUSES)
        deleted = 0
        for job in jobs:
            self._delete_job(job)
            deleted += 1
        return Response({"detail": "Unconfirmed imports cleared.", "deleted": deleted})

    @action(detail=True, methods=["get"], url_path="report")
    def report(self, request, pk=None):
        """Download a validation report CSV (sheet, row, type, status, message)."""
        job = self.get_object()
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="import_report_{job.id}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(["sheet", "row_number", "detected_type", "status", "message"])
        rows = (
            FinancialImportRow.objects.filter(job=job)
            .values_list(
                "sheet_name",
                "row_number",
                "detected_type",
                "status",
                "error_message",
                "warning_message",
            )
            .iterator(chunk_size=1000)
        )
        for sheet, row_no, dtype, st, err, warn in rows:
            writer.writerow([sheet, row_no, dtype, st, err or warn or ""])
        return response


class EmployeeAdvanceViewSet(viewsets.ModelViewSet):
    queryset = (
        EmployeeAdvance.objects.select_related(
            "employee", "source_account", "created_by", "linked_expense", "linked_ledger_account"
        )
        .prefetch_related("deductions", "repayments")
        .all()
    )
    serializer_class = EmployeeAdvanceSerializer
    permission_classes = [IsFinancialControlReadOrWrite]
    pagination_class = None
    # No hard delete — advances are reversed/cancelled via dedicated states.
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        employee = self.request.query_params.get("employee")
        if employee:
            qs = qs.filter(employee_id=employee)
        status_filter = self.request.query_params.get("status")
        if status_filter and status_filter != "all":
            qs = qs.filter(status=status_filter)
        return qs

    def create(self, request, *args, **kwargs):
        employee_id = request.data.get("employee")
        amount = request.data.get("amount")
        paid_by_id = request.data.get("paid_by") or request.data.get("source_account")
        if not employee_id:
            raise ValidationError({"employee": "Employee is required."})
        if not amount:
            raise ValidationError({"amount": "Advance amount is required."})
        if not paid_by_id:
            raise ValidationError({"paid_by": "Payment method is required."})

        from accounts.models import User

        try:
            employee_user = User.objects.get(pk=employee_id)
        except (User.DoesNotExist, ValueError, TypeError) as exc:
            raise ValidationError({"employee": "Invalid employee."}) from exc

        try:
            advance = advances_svc.give_advance(
                employee_user=employee_user,
                amount=Decimal(str(amount)),
                paid_by_id=paid_by_id,
                date=request.data.get("date"),
                reason=request.data.get("reason", ""),
                created_by=request.user,
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        return Response(
            self.get_serializer(advance).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse(self, request, pk=None):
        advance = self.get_object()
        try:
            result = advances_svc.reverse_advance(
                advance, request.user, reason=request.data.get("reason", "")
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(result).data)

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        """Outstanding totals + recent advances/deductions for one employee."""
        employee_id = request.query_params.get("employee")
        if not employee_id:
            raise ValidationError({"employee": "employee query param is required."})
        advances = list(self.get_queryset().filter(employee_id=employee_id))
        outstanding = sum(
            (a.outstanding_balance for a in advances if a.status == EmployeeAdvance.Status.ACTIVE),
            Decimal("0"),
        )
        active_count = sum(1 for a in advances if a.status == EmployeeAdvance.Status.ACTIVE)
        return Response(
            {
                "employee": employee_id,
                "outstanding_total": str(outstanding),
                "active_count": active_count,
                "advances": EmployeeAdvanceSerializer(advances, many=True).data,
            }
        )

    @action(
        detail=False,
        methods=["post"],
        url_path=r"deductions/(?P<deduction_id>[^/.]+)/reverse",
    )
    def reverse_deduction(self, request, deduction_id=None):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Reason is required."})
        from financial_control.models import EmployeeAdvanceDeduction

        try:
            deduction = EmployeeAdvanceDeduction.objects.get(pk=deduction_id)
        except EmployeeAdvanceDeduction.DoesNotExist as exc:
            raise ValidationError({"detail": "Deduction not found."}) from exc
        try:
            result = advances_svc.reverse_advance_deduction(
                deduction, request.user, reason=reason
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        from .serializers import EmployeeAdvanceDeductionSerializer, LedgerEntrySerializer

        reversal = result.get("reversal_ledger_entry")
        return Response(
            {
                "deduction": EmployeeAdvanceDeductionSerializer(result["deduction"]).data,
                "advance": self.get_serializer(result["advance"]).data,
                "reversal_ledger_entry": (
                    LedgerEntrySerializer(reversal).data if reversal else None
                ),
                "salary_settlement": result.get("salary_settlement"),
            }
        )

    @action(detail=False, methods=["post"], url_path="repayments")
    def create_repayment(self, request):
        employee_id = request.data.get("employee")
        amount = request.data.get("amount")
        payment_method_id = (
            request.data.get("payment_method")
            or request.data.get("paid_by")
            or request.data.get("received_by")
        )
        if not employee_id:
            raise ValidationError({"employee": "Employee is required."})
        if not amount:
            raise ValidationError({"amount": "Amount is required."})
        if not payment_method_id:
            raise ValidationError({"payment_method": "Payment method is required."})

        from accounts.models import User

        try:
            employee_user = User.objects.get(pk=employee_id)
        except (User.DoesNotExist, ValueError, TypeError) as exc:
            raise ValidationError({"employee": "Invalid employee."}) from exc

        try:
            result = advances_svc.record_advance_repayment(
                employee_user=employee_user,
                amount=Decimal(str(amount)),
                payment_method_id=payment_method_id,
                advance_id=request.data.get("advance"),
                date=request.data.get("date"),
                notes=request.data.get("notes", ""),
                created_by=request.user,
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        from .serializers import EmployeeAdvanceRepaymentSerializer, LedgerEntrySerializer

        return Response(
            {
                "repayments": EmployeeAdvanceRepaymentSerializer(
                    result["repayments"], many=True
                ).data,
                "ledger_entry": LedgerEntrySerializer(result["ledger_entry"]).data,
                "total": str(result["total"]),
                "outstanding_remaining": str(result["outstanding_remaining"]),
            },
            status=status.HTTP_201_CREATED,
        )
