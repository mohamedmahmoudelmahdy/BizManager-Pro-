from decimal import Decimal
from django.db import transaction
from django.db.models import Sum, F, Case, When, Value, DecimalField
from django.utils import timezone
from rest_framework import serializers
from procedures.models import Procedure
from .models import User, EmployeeProfile
from .services.role_groups import sync_role_managed_groups


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role"]
        read_only_fields = ["id", "username"]


class MeSerializer(UserSerializer):
    """Authenticated profile payload for /api/me/, including Django permissions."""

    permissions = serializers.SerializerMethodField()
    groups = serializers.SerializerMethodField()
    portal_type = serializers.SerializerMethodField()
    customer = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = list(UserSerializer.Meta.fields) + [
            "permissions",
            "groups",
            "portal_type",
            "customer",
        ]

    def get_permissions(self, obj):
        return sorted(obj.get_all_permissions())

    def get_groups(self, obj):
        return sorted(obj.groups.values_list("name", flat=True))

    def get_portal_type(self, obj):
        if getattr(obj, "role", None) == User.Roles.HR_CLIENT:
            return "hr"
        return "internal"

    def get_customer(self, obj):
        if getattr(obj, "role", None) != User.Roles.HR_CLIENT:
            return None
        from attestation.models import HRPortalProfile

        try:
            profile = obj.hr_portal_profile
        except HRPortalProfile.DoesNotExist:
            return None
        if not profile.is_active:
            return None
        customer = profile.customer
        return {
            "id": str(customer.pk),
            "display_name": customer.company_name or customer.name or str(customer.pk),
        }

class EmployeeProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username")
    email = serializers.EmailField(source="user.email")
    role = serializers.ChoiceField(choices=User.Roles.choices, source="user.role")
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    commission_month = serializers.SerializerMethodField()
    commission_total = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "user_id",
            "full_name",
            "salary",
            "debit",
            "credit",
            "target_monthly",
            "commission_rate",
            "commission_month",
            "commission_total",
            "username",
            "email",
            "role",
            "password",
        ]

    @transaction.atomic
    def create(self, validated_data):
        user_data = validated_data.pop("user")
        password = validated_data.pop("password")
        user = User(
            username=user_data.get("username"),
            email=user_data.get("email", ""),
            role=user_data.get("role", User.Roles.EMPLOYEE),
        )
        user.set_password(password)
        user.save()
        sync_role_managed_groups(user)
        return EmployeeProfile.objects.create(user=user, **validated_data)

    def _apply_user_fields(self, instance, validated_data):
        """Apply nested or flat user fields from validated_data."""
        password = validated_data.pop("password", None)
        user_data = validated_data.pop("user", None) or {}
        for attr in ("username", "email", "role"):
            if attr in validated_data:
                user_data[attr] = validated_data.pop(attr)
        user_changed = False
        role_touched = "role" in user_data
        for attr, value in user_data.items():
            setattr(instance.user, attr, value)
            user_changed = True
        if password and str(password).strip():
            instance.user.set_password(password)
            user_changed = True
        if user_changed:
            instance.user.save()
        if role_touched:
            sync_role_managed_groups(instance.user)

    @transaction.atomic
    def update(self, instance, validated_data):
        self._apply_user_fields(instance, validated_data)
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if data.get("commission_rate") is not None:
            data["commission_rate"] = float(instance.commission_rate or 0)
        if data.get("commission_month") is not None:
            data["commission_month"] = float(data["commission_month"])
        if data.get("commission_total") is not None:
            data["commission_total"] = float(data["commission_total"])
        return data

    def _net_profit_sum(self, queryset):
        profit_expression = Case(
            When(
                selling_price__gt=F("cost"),
                then=F("selling_price") - F("cost"),
            ),
            default=Value(0),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )
        agg = queryset.aggregate(total=Sum(profit_expression))
        return agg.get("total") or Decimal("0")

    def _commission_value(self, net_profit, rate):
        rate_dec = Decimal(str(rate or 0))
        return net_profit * rate_dec / Decimal("100")

    def get_commission_month(self, obj):
        today = timezone.localdate()
        month_start = today.replace(day=1)
        base_qs = Procedure.objects.filter(
            assigned_employee=obj.user,
            status=Procedure.Status.DONE,
            date__gte=month_start,
            date__lte=today,
        )
        net_profit = self._net_profit_sum(base_qs)
        return self._commission_value(net_profit, obj.commission_rate)

    def get_commission_total(self, obj):
        base_qs = Procedure.objects.filter(
            assigned_employee=obj.user,
            status=Procedure.Status.DONE,
        )
        net_profit = self._net_profit_sum(base_qs)
        return self._commission_value(net_profit, obj.commission_rate)
