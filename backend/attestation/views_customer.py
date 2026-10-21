"""Internal staff APIs for per-customer attestation setup (Customer profile)."""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from attestation.exceptions import AttestationBusinessError, raise_api_error
from attestation.serializers_customer import (
    CustomerAttestationEnableSerializer,
    CustomerAttestationHrUserCreateSerializer,
    CustomerAttestationSetActiveSerializer,
)
from attestation.services.customer_portal import (
    build_customer_attestation_status,
    create_customer_hr_portal_user,
    enable_customer_attestation,
    require_manage_attestation,
    set_customer_attestation_active,
    set_customer_hr_portal_user_active,
)
from customers.models import Customer


class CustomerAttestationStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, customer_id):
        try:
            require_manage_attestation(request.user)
            customer = Customer.objects.get(pk=customer_id)
            return Response(build_customer_attestation_status(customer))
        except Customer.DoesNotExist:
            return Response(
                {
                    "error": {
                        "code": "customer_not_found",
                        "message": "customer_not_found",
                        "details": {},
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        except AttestationBusinessError as exc:
            raise_api_error(exc)


class CustomerAttestationEnableView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, customer_id):
        try:
            ser = CustomerAttestationEnableSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            data = enable_customer_attestation(
                actor=request.user,
                customer_id=customer_id,
                expected_applicant_count=ser.validated_data.get(
                    "expected_applicant_count"
                ),
                title=ser.validated_data.get("title"),
                slug=ser.validated_data.get("slug"),
            )
            return Response(data, status=status.HTTP_201_CREATED)
        except AttestationBusinessError as exc:
            raise_api_error(exc)


class CustomerAttestationSetActiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, customer_id):
        try:
            ser = CustomerAttestationSetActiveSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            data = set_customer_attestation_active(
                actor=request.user,
                customer_id=customer_id,
                is_active=ser.validated_data["is_active"],
            )
            return Response(data)
        except AttestationBusinessError as exc:
            raise_api_error(exc)


class CustomerAttestationHrUsersView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, customer_id):
        try:
            ser = CustomerAttestationHrUserCreateSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            data = create_customer_hr_portal_user(
                actor=request.user,
                customer_id=customer_id,
                username=ser.validated_data["username"],
                password=ser.validated_data["password"],
                email=ser.validated_data.get("email") or "",
            )
            return Response(data, status=status.HTTP_201_CREATED)
        except AttestationBusinessError as exc:
            raise_api_error(exc)


class CustomerAttestationHrUserActiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, customer_id, user_id):
        try:
            ser = CustomerAttestationSetActiveSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            data = set_customer_hr_portal_user_active(
                actor=request.user,
                customer_id=customer_id,
                user_id=user_id,
                is_active=ser.validated_data["is_active"],
            )
            return Response(data)
        except AttestationBusinessError as exc:
            raise_api_error(exc)
