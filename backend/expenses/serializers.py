"""Expense serializers — operational ledger + employee claim workflow."""

from __future__ import annotations

from rest_framework import serializers

from expenses.exceptions import ExpenseBusinessError, raise_expense_error
from expenses.models import Expense, ExpenseAttachment, ExpenseAuditEvent
from expenses.services.workflow import (
    add_receipt,
    approve_expense,
    create_employee_expense,
    mark_expense_paid,
    reject_expense,
    return_expense,
    submit_expense,
    update_employee_expense,
    withdraw_expense,
)


def _user_summary(user) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
    }


class ExpenseAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseAttachment
        fields = [
            "id",
            "original_name",
            "content_type",
            "size_bytes",
            "created_at",
        ]
        read_only_fields = fields


class ExpenseAuditEventSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseAuditEvent
        fields = [
            "id",
            "action",
            "actor",
            "from_status",
            "to_status",
            "message",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields

    def get_actor(self, obj):
        return _user_summary(obj.actor)


class ExpenseSerializer(serializers.ModelSerializer):
    """Legacy operational expense serializer (admin/FC paid path)."""

    employee_name = serializers.CharField(source="assigned_employee.username", read_only=True)
    paid_by_name = serializers.CharField(source="paid_by.bank_name", read_only=True)
    linked_source_type = serializers.SerializerMethodField()
    linked_source_label = serializers.SerializerMethodField()
    workflow_status = serializers.CharField(read_only=True)
    expense_number = serializers.CharField(read_only=True)
    merchant = serializers.CharField(required=False, allow_blank=True)
    business_purpose = serializers.CharField(required=False, allow_blank=True)
    submitted_by = serializers.SerializerMethodField()
    expense_for_user = serializers.SerializerMethodField()
    approved_by_user = serializers.SerializerMethodField()
    payment_recorded_by_user = serializers.SerializerMethodField()
    attachments = ExpenseAttachmentSerializer(many=True, read_only=True)

    def get_submitted_by(self, obj):
        return _user_summary(obj.submitted_by)

    def get_expense_for_user(self, obj):
        return _user_summary(obj.expense_for or obj.assigned_employee)

    def get_approved_by_user(self, obj):
        return _user_summary(obj.approved_by)

    def get_payment_recorded_by_user(self, obj):
        return _user_summary(obj.payment_recorded_by)

    def get_linked_source_type(self, obj):
        if obj.payroll_type:
            return "payroll"

        debt_labels = self.context.get("expense_debt_labels")
        check_labels = self.context.get("expense_check_labels")
        if debt_labels is not None or check_labels is not None:
            if debt_labels and obj.pk in debt_labels:
                return "debt"
            if check_labels and obj.pk in check_labels:
                return "check"
            return "manual"

        from financial_control.models import DebtPayment, LedgerEntry

        if DebtPayment.objects.filter(linked_expense_id=obj.pk).exists():
            return "debt"
        if LedgerEntry.objects.filter(
            related_expense_id=obj.pk, source_type=LedgerEntry.SourceType.CHECK
        ).exists():
            return "check"
        return "manual"

    def get_linked_source_label(self, obj):
        if obj.payroll_type:
            label = obj.get_payroll_type_display()
            if obj.payroll_period:
                return f"{label} · {obj.payroll_period}"
            return label

        debt_labels = self.context.get("expense_debt_labels")
        check_labels = self.context.get("expense_check_labels")
        if debt_labels is not None or check_labels is not None:
            if debt_labels and obj.pk in debt_labels:
                return debt_labels[obj.pk] or ""
            if check_labels and obj.pk in check_labels:
                return check_labels[obj.pk] or ""
            return ""

        from financial_control.models import DebtPayment, LedgerEntry

        payment = (
            DebtPayment.objects.filter(linked_expense_id=obj.pk)
            .select_related("debt")
            .first()
        )
        if payment:
            return payment.debt.name
        entry = (
            LedgerEntry.objects.filter(
                related_expense_id=obj.pk, source_type=LedgerEntry.SourceType.CHECK
            )
            .first()
        )
        if entry and entry.description:
            return entry.description
        return ""

    class Meta:
        model = Expense
        fields = [
            "id",
            "expense_number",
            "category",
            "date",
            "amount",
            "paid_by",
            "paid_by_name",
            "assigned_employee",
            "employee_name",
            "expense_for",
            "expense_for_user",
            "submitted_by",
            "merchant",
            "business_purpose",
            "workflow_status",
            "submitted_at",
            "approved_at",
            "approved_by_user",
            "rejected_at",
            "rejection_reason",
            "returned_at",
            "return_reason",
            "paid_at",
            "payment_recorded_by_user",
            "payment_reference",
            "payroll_type",
            "payroll_period",
            "salary_gross",
            "salary_advance_deduction",
            "salary_manual_deduction",
            "salary_remaining_due",
            "salary_payment_mode",
            "salary_manual_deduction_reason",
            "linked_source_type",
            "linked_source_label",
            "notes",
            "payroll_status",
            "reversed_at",
            "reversal_reason",
            "attachments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "expense_number",
            "workflow_status",
            "submitted_at",
            "approved_at",
            "rejected_at",
            "rejection_reason",
            "returned_at",
            "return_reason",
            "paid_at",
            "payment_reference",
            "attachments",
            "created_at",
            "updated_at",
        ]


class EmployeeExpenseCreateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=Expense.Category.choices)
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    merchant = serializers.CharField(required=False, allow_blank=True, default="")
    business_purpose = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    submit = serializers.BooleanField(required=False, default=False)

    def create(self, validated_data):
        try:
            return create_employee_expense(actor=self.context["request"].user, **validated_data)
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)

    def to_representation(self, instance):
        return ExpenseSerializer(instance, context=self.context).data


class EmployeeExpenseUpdateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=Expense.Category.choices, required=False)
    date = serializers.DateField(required=False)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    merchant = serializers.CharField(required=False, allow_blank=True)
    business_purpose = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)

    def update(self, instance, validated_data):
        try:
            return update_employee_expense(
                actor=self.context["request"].user,
                expense_id=instance.pk,
                updates=validated_data,
            )
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)

    def to_representation(self, instance):
        return ExpenseSerializer(instance, context=self.context).data


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField()


class MarkPaidSerializer(serializers.Serializer):
    paid_by = serializers.CharField()
    payment_reference = serializers.CharField(required=False, allow_blank=True, default="")


class ExpenseDetailSerializer(ExpenseSerializer):
    audit_events = ExpenseAuditEventSerializer(many=True, read_only=True)

    class Meta(ExpenseSerializer.Meta):
        fields = ExpenseSerializer.Meta.fields + ["audit_events"]
