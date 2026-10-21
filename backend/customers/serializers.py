from rest_framework import serializers
from .models import Customer, CompanyEmployee, CustomerFinancialAdjustment


class CustomerSerializer(serializers.ModelSerializer):
    debt_status_display = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = [
            "balance",
            "debt_status",
            "last_activity",
            "account_status",
            "closed_at",
            "closed_by",
            "closure_reason",
            "attestation_apply_slug",
            "created_at",
            "updated_at",
            "debt_status_display",
        ]

    def get_debt_status_display(self, obj):
        balance = obj.balance or 0
        if balance > 0:
            return "in_debt"
        if balance < 0:
            return "credit"
        return "clear"


class CustomerFinancialAdjustmentSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    reversed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomerFinancialAdjustment
        fields = [
            "id",
            "customer",
            "customer_name",
            "adjustment_type",
            "amount",
            "date",
            "reason",
            "notes",
            "created_by",
            "created_by_name",
            "status",
            "reversed_at",
            "reversed_by",
            "reversed_by_name",
            "reversal_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "customer",
            "customer_name",
            "created_by",
            "created_by_name",
            "status",
            "reversed_at",
            "reversed_by",
            "reversed_by_name",
            "reversal_reason",
            "created_at",
            "updated_at",
        ]

    def _user_name(self, user):
        if not user:
            return ""
        profile = getattr(user, "employee_profile", None)
        if profile and profile.full_name:
            return profile.full_name
        return user.get_full_name() or user.username or ""

    def get_created_by_name(self, obj):
        return self._user_name(obj.created_by)

    def get_reversed_by_name(self, obj):
        return self._user_name(obj.reversed_by)

    def get_customer_name(self, obj):
        return str(obj.customer) if obj.customer else ""


class CustomerFinancialAdjustmentCreateSerializer(serializers.Serializer):
    adjustment_type = serializers.ChoiceField(
        choices=[(CustomerFinancialAdjustment.AdjustmentType.DISCOUNT, "Discount")]
    )
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    date = serializers.DateField()
    reason = serializers.CharField(max_length=255, trim_whitespace=True)
    notes = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)


class CustomerFinancialAdjustmentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)


class CustomerAccountActionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)


class CompanyEmployeeSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = CompanyEmployee
        fields = ["id", "company", "company_name", "name", "residency_expiry", "no_health_insurance", "insurance_expiry"]
