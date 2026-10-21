from rest_framework import serializers

from payments.models import Payment, PaymentRefund
from payments.services.refunds import payment_refund_totals


class PaymentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    recorded_by_name = serializers.SerializerMethodField()
    procedure_category = serializers.CharField(source="procedure.category", read_only=True, default="")
    original_amount = serializers.SerializerMethodField()
    refunded_amount = serializers.SerializerMethodField()
    refundable_amount = serializers.SerializerMethodField()

    def get_recorded_by_name(self, obj):
        if not obj.recorded_by:
            return ""
        profile = getattr(obj.recorded_by, "employee_profile", None)
        if profile and profile.full_name:
            return profile.full_name
        return obj.recorded_by.get_full_name() or obj.recorded_by.username or ""

    def _refund_totals(self, obj):
        # One totals compute per serialized row (three fields share the result).
        cached = getattr(obj, "_serializer_refund_totals", None)
        if cached is None:
            cached = payment_refund_totals(obj)
            setattr(obj, "_serializer_refund_totals", cached)
        return cached

    def get_original_amount(self, obj):
        return f"{self._refund_totals(obj)['original_amount']:.2f}"

    def get_refunded_amount(self, obj):
        return f"{self._refund_totals(obj)['refunded_amount']:.2f}"

    def get_refundable_amount(self, obj):
        return f"{self._refund_totals(obj)['refundable_amount']:.2f}"

    class Meta:
        model = Payment
        fields = [
            "id",
            "amount",
            "original_amount",
            "refunded_amount",
            "refundable_amount",
            "date",
            "type",
            "customer",
            "customer_name",
            "procedure",
            "procedure_category",
            "bank_card",
            "recorded_by",
            "recorded_by_name",
            "notes",
        ]
        extra_kwargs = {"recorded_by": {"read_only": True}}


class PaymentRefundSerializer(serializers.ModelSerializer):
    payment_method_name = serializers.CharField(
        source="payment_method.bank_name", read_only=True, default=""
    )
    created_by_name = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ""
        profile = getattr(obj.created_by, "employee_profile", None)
        if profile and profile.full_name:
            return profile.full_name
        return obj.created_by.get_full_name() or obj.created_by.username or ""

    class Meta:
        model = PaymentRefund
        fields = [
            "id",
            "payment",
            "customer",
            "amount",
            "date",
            "payment_method",
            "payment_method_name",
            "reason",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class PaymentRefundCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    payment_method = serializers.CharField(max_length=16)
    date = serializers.DateField()
    reason = serializers.CharField(allow_blank=False, trim_whitespace=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
