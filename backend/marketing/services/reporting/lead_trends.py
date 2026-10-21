"""Lead creation / conversion / lost trend series."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek

from marketing.models import Lead
from marketing.services.reporting.filters import parse_report_filters
from marketing.services.reporting.querysets import (
    CONVERTED_Q,
    base_operational_leads,
    filter_assigned_to,
)
from marketing.services.reporting.visibility import (
    ensure_report_permission,
    visible_report_leads,
)

User = get_user_model()


def _period_key(bucket: date | Any, interval: str) -> str:
    if hasattr(bucket, "date"):
        bucket = bucket.date()
    if interval == "month":
        return bucket.strftime("%Y-%m")
    return bucket.isoformat()


def _iter_buckets(date_from: date, date_to: date, interval: str) -> list[date]:
    buckets: list[date] = []
    if interval == "day":
        cur = date_from
        while cur <= date_to:
            buckets.append(cur)
            cur += timedelta(days=1)
        return buckets

    if interval == "week":
        # ISO week: Monday-aligned TruncWeek matches Django TruncWeek(week_start Monday on PG;
        # on SQLite TruncWeek uses Sunday start in some versions — we normalize to Monday).
        cur = date_from - timedelta(days=date_from.weekday())
        end = date_to
        while cur <= end:
            buckets.append(cur)
            cur += timedelta(days=7)
        return buckets

    # month
    cur = date_from.replace(day=1)
    while cur <= date_to:
        buckets.append(cur)
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)
    return buckets


def build_lead_trends_report(actor: User, params: dict) -> dict:
    ensure_report_permission(actor)
    filters = parse_report_filters(params, allow_interval=True)
    interval = filters.interval or "day"

    trunc = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}[interval]

    visible = visible_report_leads(actor)
    operational = filter_assigned_to(base_operational_leads(visible, filters), filters)

    # Created series (created_at in range)
    created_rows = (
        operational.filter(
            created_at__gte=filters.range_start,
            created_at__lt=filters.range_end_exclusive,
        )
        .annotate(period=trunc("created_at"))
        .values("period")
        .annotate(
            created=Count("id"),
            lost=Count("id", filter=Q(status=Lead.Status.LOST)),
            converted_cohort=Count("id", filter=CONVERTED_Q),
        )
        .order_by("period")
    )

    # Conversion events series (converted_at in range)
    converted_rows = (
        operational.filter(
            CONVERTED_Q,
            converted_at__gte=filters.range_start,
            converted_at__lt=filters.range_end_exclusive,
        )
        .annotate(period=trunc("converted_at"))
        .values("period")
        .annotate(converted=Count("id"))
        .order_by("period")
    )

    created_map: dict[str, dict] = {}
    for row in created_rows:
        key = _period_key(row["period"], interval)
        created_map[key] = row

    converted_map = {
        _period_key(row["period"], interval): row["converted"] for row in converted_rows
    }

    series = []
    for bucket in _iter_buckets(filters.date_from, filters.date_to, interval):
        key = _period_key(bucket, interval)
        created_info = created_map.get(key, {})
        series.append(
            {
                "period": key,
                "created": created_info.get("created", 0),
                "converted": converted_map.get(key, 0),
                "lost": created_info.get("lost", 0),
            }
        )

    return {
        "filters": filters.to_dict(),
        "interval": interval,
        "meta": {
            "created_basis": "lead.created_at",
            "converted_basis": "lead.converted_at",
            "lost_basis": "lead.created_at AND status=lost",
            "dense_buckets": True,
        },
        "series": series,
    }
