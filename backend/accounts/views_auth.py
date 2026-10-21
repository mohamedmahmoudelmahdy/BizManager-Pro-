"""Throttled JWT obtain view (generic failure messages via SimpleJWT)."""

from rest_framework_simplejwt.views import TokenObtainPairView

from attestation.throttles import LoginRateThrottle


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]
