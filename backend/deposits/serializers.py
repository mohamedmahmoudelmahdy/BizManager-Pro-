from rest_framework import serializers

from .models import Deposit


class DepositSerializer(serializers.ModelSerializer):
    from_method_name = serializers.CharField(source="from_method.bank_name", read_only=True, default="")
    to_method_name = serializers.CharField(source="to_method.bank_name", read_only=True, default="")

    class Meta:
        model = Deposit
        fields = [
            "id",
            "date",
            "amount",
            "from_method",
            "from_method_name",
            "to_method",
            "to_method_name",
            "notes",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "from_method_name", "to_method_name"]
