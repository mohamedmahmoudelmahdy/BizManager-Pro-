from decimal import Decimal
from django.db import transaction
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from accounts.permissions import IsAdminManagerEmployeeCashier
from .models import Deposit
from .serializers import DepositSerializer


class DepositViewSet(viewsets.ModelViewSet):
    queryset = Deposit.objects.select_related("from_method", "to_method").all()
    serializer_class = DepositSerializer
    permission_classes = [IsAdminManagerEmployeeCashier]
    pagination_class = None

    def perform_create(self, serializer):
        from_method = serializer.validated_data.get("from_method")
        to_method = serializer.validated_data.get("to_method")
        amount = Decimal(serializer.validated_data.get("amount") or 0)

        if not from_method or not to_method:
            raise ValidationError({"detail": "Both from and to methods are required."})
        if from_method.pk == to_method.pk:
            raise ValidationError({"detail": "From and to accounts must be different."})

        with transaction.atomic():
            locked_from = from_method.__class__.objects.select_for_update().get(pk=from_method.pk)
            locked_to = to_method.__class__.objects.select_for_update().get(pk=to_method.pk)

            if locked_from.balance - amount < 0:
                raise ValidationError({"amount": "Insufficient cash balance for deposit."})

            locked_from.balance = locked_from.balance - amount
            locked_to.balance = locked_to.balance + amount
            locked_from.save(update_fields=["balance"])
            locked_to.save(update_fields=["balance"])

            serializer.save()
