from decimal import Decimal

from django.db import transaction
from rest_framework import status, viewsets, permissions
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from banking.models import BankCard
from expenses.models import Expense
from expenses.serializers import ExpenseSerializer

from .models import User, EmployeeProfile
from .permissions import (
    IsAdmin,
    IsAdminOrManager,
    IsAdminManagerEmployee,
    IsAdminManagerEmployeeMarketer,
)
from .serializers import UserSerializer, MeSerializer, EmployeeProfileSerializer
from .services import employee_performance as perf
from .services import pay_salary as pay_salary_svc
from .services.performance_period import resolve_performance_period
from .services.role_groups import sync_role_managed_groups, sync_role_managed_groups_if_needed


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def perform_create(self, serializer):
        user = serializer.save()
        sync_role_managed_groups(user)

    def perform_update(self, serializer):
        user = serializer.save()
        sync_role_managed_groups(user)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # Keep role-managed groups aligned, but skip full seed when already correct.
        sync_role_managed_groups_if_needed(request.user)
        serializer = MeSerializer(request.user)
        return Response(serializer.data)


class EmployeeProfileViewSet(viewsets.ModelViewSet):
    queryset = EmployeeProfile.objects.select_related("user").all()
    serializer_class = EmployeeProfileSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in [
            "create",
            "update",
            "partial_update",
            "destroy",
        ]:
            return [IsAdminOrManager()]
        if self.action in [
            "pay_salary",
            "pay_commission",
            "reverse_salary_payment",
        ]:
            return [IsAdmin()]
        if self.action in ["list", "retrieve"]:
            # Marketers need active employee lists for follow-up assignee selectors.
            return [IsAdminManagerEmployeeMarketer()]
        return [IsAdminManagerEmployee()]

    @action(detail=False, methods=["get"], url_path="performance")
    def performance(self, request):
        """
        Team performance for Employee Log / Financial Control.

        New contract (preferred):
          ?period_mode=month|year|all_time&year=&month=&role=&performance=

        Legacy (Financial Control):
          ?period=YYYY-MM → returns a bare list for backward compatibility.
        """
        period_mode = request.query_params.get("period_mode")
        legacy_period = request.query_params.get("period")

        if not period_mode and legacy_period is not None:
            return Response(perf.team_performance(legacy_period or None))

        if not period_mode and legacy_period is None:
            # Default: current month report envelope for Employee Log.
            today = __import__("django.utils.timezone", fromlist=["timezone"]).timezone.localdate()
            resolved = resolve_performance_period(
                period_mode="month", year=today.year, month=today.month
            )
        else:
            resolved = resolve_performance_period(
                period_mode=period_mode or "month",
                year=request.query_params.get("year"),
                month=request.query_params.get("month"),
                period=legacy_period,
            )
        report = perf.build_team_performance_report(
            resolved,
            role=request.query_params.get("role"),
            performance_level=request.query_params.get("performance"),
        )
        return Response(report)

    @action(detail=False, methods=["get"], url_path="my-score")
    def my_score(self, request):
        """
        Authenticated employee's authoritative performance score for the dashboard.

        Identity comes only from request.user. Optional employee_id query/body is ignored.
        Defaults to the current calendar month (same default period as Employee Log).
        """
        period = request.query_params.get("period")
        return Response(perf.score_payload_for_user(request.user, period))

    @action(detail=True, methods=["get"], url_path="dashboard")
    def dashboard(self, request, pk=None):
        profile = self.get_object()
        period = request.query_params.get("period")
        period_mode = request.query_params.get("period_mode")
        group_by = request.query_params.get("group_by", "month")

        if period_mode:
            resolved = resolve_performance_period(
                period_mode=period_mode,
                year=request.query_params.get("year"),
                month=request.query_params.get("month"),
                period=period,
            )
            metrics = perf.employee_metrics(profile.user, profile, resolved)
            start, end = resolved.start, resolved.end_inclusive
            team = perf.team_performance(resolved)
        else:
            metrics = perf.employee_metrics(profile.user, profile, period)
            start, end, _ = perf._parse_period(period)
            team = perf.team_performance(period)

        proc_qs = perf.procedures_for_user(profile.user, start, end)
        pay_qs = perf.payments_for_user(profile.user, start, end)

        from procedures.serializers import ProcedureSerializer
        from payments.serializers import PaymentSerializer

        procedures = ProcedureSerializer(proc_qs.order_by("-date")[:500], many=True).data
        payments = PaymentSerializer(pay_qs.order_by("-date")[:500], many=True).data

        grouped = []
        if group_by in ("day", "month", "year"):
            buckets: dict[str, list] = {}
            for p in proc_qs:
                d = p.date
                if group_by == "day":
                    key = d.isoformat()
                elif group_by == "month":
                    key = d.strftime("%Y-%m")
                else:
                    key = d.strftime("%Y")
                buckets.setdefault(key, []).append(p)
            for key in sorted(buckets.keys(), reverse=True):
                subset = buckets[key]
                total = len(subset)
                closed = sum(1 for x in subset if x.status == "done")
                open_c = sum(1 for x in subset if x.status in perf.OPEN_STATUSES)
                done_subset = [x for x in subset if x.status == "done"]
                net = sum(
                    max(Decimal(str(x.selling_price)) - Decimal(str(x.cost)), Decimal("0"))
                    for x in done_subset
                )
                grouped.append(
                    {
                        "key": key,
                        "total_procedures": total,
                        "open_procedures": open_c,
                        "closed_procedures": closed,
                        "closure_ratio": round(closed / total, 4) if total else 0,
                        "revenue": float(sum(x.selling_price for x in subset)),
                        "payments_collected": float(sum(x.paid for x in subset)),
                        "net_profit": float(net),
                    }
                )

        rank_row = next((r for r in team if r["employee_id"] == str(profile.id)), None)

        return Response(
            {
                "metrics": metrics,
                "rank": rank_row.get("rank") if rank_row else None,
                "performance_score": rank_row.get("performance_score") if rank_row else 0,
                "performance_level": rank_row.get("performance_level") if rank_row else "Low",
                "maximum_score": perf.PERFORMANCE_SCORE_MAXIMUM,
                "procedures": procedures,
                "payments": payments,
                "period_groups": grouped,
            }
        )

    def _create_payroll_expense(self, profile, payroll_type, period, amount, paid_by_id, pay_date, notes, force):
        start, _, period_key = perf._parse_period(period)
        if not period_key or not start:
            raise ValidationError({"period": "Invalid period. Use YYYY-MM."})
        if not paid_by_id:
            raise ValidationError({"paid_by": "Payment method is required."})
        if amount <= 0:
            raise ValidationError({"amount": "Amount must be greater than zero."})

        if perf.payroll_exists(profile.user, payroll_type, period_key) and not force:
            return None, period_key

        marker = f"[payroll:{payroll_type}:{period_key}]"
        full_notes = f"{marker} {notes}".strip() if notes else marker

        try:
            paid_by = BankCard.objects.get(pk=paid_by_id)
        except BankCard.DoesNotExist as exc:
            raise ValidationError({"paid_by": "Invalid payment method."}) from exc

        with transaction.atomic():
            locked = BankCard.objects.select_for_update().get(pk=paid_by.pk)
            amount_dec = Decimal(str(amount))
            if locked.balance - amount_dec < 0:
                raise ValidationError({"amount": "Insufficient balance for this expense."})
            locked.balance = locked.balance - amount_dec
            locked.save(update_fields=["balance"])

            expense = Expense.objects.create(
                category=Expense.Category.SALARIES,
                date=pay_date,
                amount=amount_dec,
                paid_by=paid_by,
                assigned_employee=profile.user,
                payroll_type=payroll_type,
                payroll_period=start,
                notes=full_notes,
            )
        return expense, period_key

    @action(detail=True, methods=["post"], url_path="pay-salary")
    def pay_salary(self, request, pk=None):
        profile = self.get_object()
        period = request.data.get("period")
        force = bool(request.data.get("force"))
        from django.utils import timezone as tz

        pay_date = request.data.get("date") or tz.localdate()
        notes = request.data.get("notes", "")
        payment_mode = request.data.get("payment_mode", "full")
        manual_deduction_amount = request.data.get("manual_deduction_amount", 0)
        manual_deduction_reason = request.data.get("manual_deduction_reason", "")
        paid_amount_input = request.data.get("paid_amount")

        start, _, period_key = perf._parse_period(period)
        if not period_key or not start:
            raise ValidationError({"period": "Invalid period. Use YYYY-MM."})
        paid_by_id = request.data.get("paid_by")
        if not paid_by_id:
            raise ValidationError({"paid_by": "Payment method is required."})

        settlement = pay_salary_svc.salary_settlement_status(profile.user, profile, period_key)
        mode = (payment_mode or "full").lower()
        if (
            mode == "full"
            and settlement["salary_status"] == "paid"
            and not force
        ):
            return Response(
                {
                    "detail": "Salary already paid for this period.",
                    "code": "duplicate_payroll",
                    "period": period_key,
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            expense, result = pay_salary_svc.execute_salary_payment(
                profile=profile,
                period_key=period_key,
                paid_by_id=paid_by_id,
                pay_date=pay_date,
                notes=notes,
                payment_mode=mode,
                manual_deduction_amount=manual_deduction_amount,
                manual_deduction_reason=manual_deduction_reason,
                paid_amount_input=paid_amount_input,
                created_by=request.user,
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        data = ExpenseSerializer(expense).data
        data.update(result)
        return Response(data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["post"],
        url_path=r"salary-payments/(?P<expense_id>[^/.]+)/reverse",
    )
    def reverse_salary_payment(self, request, pk=None, expense_id=None):
        profile = self.get_object()
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Reason is required."})
        try:
            expense = Expense.objects.get(pk=expense_id)
        except Expense.DoesNotExist as exc:
            raise ValidationError({"detail": "Salary payment not found."}) from exc
        try:
            reversed_expense, settlement = pay_salary_svc.reverse_salary_payment(
                expense, profile, request.user, reason=reason
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        data = ExpenseSerializer(reversed_expense).data
        data["salary_settlement"] = settlement
        return Response(data)

    @action(detail=True, methods=["post"], url_path="pay-commission")
    def pay_commission(self, request, pk=None):
        profile = self.get_object()
        period = request.data.get("period")
        force = bool(request.data.get("force"))
        from django.utils import timezone as tz

        pay_date = request.data.get("date") or tz.localdate()
        notes = request.data.get("notes", "")

        metrics = perf.employee_metrics(profile.user, profile, period)
        amount = metrics["commission_amount"]

        result, period_key = self._create_payroll_expense(
            profile,
            Expense.PayrollType.COMMISSION,
            period,
            amount,
            request.data.get("paid_by"),
            pay_date,
            notes,
            force,
        )
        if result is None:
            return Response(
                {
                    "detail": "Commission already paid for this period.",
                    "code": "duplicate_payroll",
                    "period": period_key,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(ExpenseSerializer(result).data, status=status.HTTP_201_CREATED)
