from decimal import Decimal, InvalidOperation

from rest_framework import serializers
from rest_framework.exceptions import APIException

from .models import Procedure, ProcedureCategory

PROCEDURE_PAID_DIRECT_UPDATE_CODE = "procedure_paid_direct_update_not_allowed"
PROCEDURE_PAID_DIRECT_UPDATE_DETAIL = (
    "Paid amount cannot be edited directly. Record a payment or refund instead."
)


class ProcedurePaidDirectUpdateNotAllowed(APIException):
    status_code = 400
    default_code = PROCEDURE_PAID_DIRECT_UPDATE_CODE
    default_detail = PROCEDURE_PAID_DIRECT_UPDATE_DETAIL

    def __init__(self):
        self.detail = {
            "code": PROCEDURE_PAID_DIRECT_UPDATE_CODE,
            "detail": PROCEDURE_PAID_DIRECT_UPDATE_DETAIL,
            "paid": PROCEDURE_PAID_DIRECT_UPDATE_DETAIL,
        }


class ProcedureCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcedureCategory
        fields = ["id", "name", "order"]


class ProcedureSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    assigned_employee_name = serializers.SerializerMethodField()
    customer_card_mode = serializers.BooleanField(write_only=True, required=False, default=False)

    def get_assigned_employee_name(self, obj):
        user = obj.assigned_employee
        if not user:
            return ""
        profile = getattr(user, "employee_profile", None)
        if profile and profile.full_name:
            return profile.full_name
        return user.get_full_name() or user.username or ""

    def validate(self, attrs):
        """Reject any attempt to change Procedure.paid on update (PUT/PATCH)."""
        if self.instance is None:
            return attrs

        raw = getattr(self, "initial_data", None) or {}
        if not isinstance(raw, dict) or "paid" not in raw:
            attrs.pop("paid", None)
            return attrs

        try:
            incoming = Decimal(str(raw.get("paid")))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ProcedurePaidDirectUpdateNotAllowed() from exc

        current = Decimal(str(self.instance.paid or 0)).quantize(Decimal("0.01"))
        incoming_q = incoming.quantize(Decimal("0.01"))
        if incoming_q != current:
            raise ProcedurePaidDirectUpdateNotAllowed()

        # Same value — drop so perform_update never treats it as a mutation.
        attrs.pop("paid", None)
        return attrs

    class Meta:
        model = Procedure
        fields = [
            "id",
            "customer",
            "customer_name",
            "category",
            "description",
            "notes",
            "cost",
            "selling_price",
            "cash_in",
            "cash_out_type",
            "cash_in_type",
            "customer_card_mode",
            "status",
            "assigned_employee",
            "assigned_employee_name",
            "date",
            "paid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at", "customer_name", "assigned_employee_name"]
