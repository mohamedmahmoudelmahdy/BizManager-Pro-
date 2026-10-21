"""Tests for activities, follow-ups, assignments, and operations visibility."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from marketing.exceptions import (
    AssignmentNotOwnedError,
    DuplicateActiveAssignmentError,
    FollowUpCompletedError,
    InvalidAssignmentTransitionError,
)
from marketing.models import LeadActivity, LeadAssignment, LeadFollowUp
from marketing.permissions import GROUP_OPERATIONS_CRM_USER
from marketing.services.activities import create_activity
from marketing.services.assignments import (
    accept_assignment,
    assign_lead,
    cancel_assignment,
    complete_assignment,
    get_active_assignment,
    reassign_lead,
    reject_assignment,
)
from marketing.services.followups import complete_followup, create_followup, update_followup
from marketing.services.lead_create import create_lead
from marketing.services.operations_visibility import visible_leads_for

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class OperationsFixtures(TestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username="ops-mgr", password="pass", role=User.Roles.MANAGER
        )
        self.assigner = User.objects.create_user(
            username="assigner", password="pass", role=User.Roles.EMPLOYEE
        )
        self.assigner = _grant(
            self.assigner,
            "view_lead",
            "add_lead",
            "change_lead",
            "assign_lead",
            "view_leadassignment",
            "change_leadassignment",
            "add_leadassignment",
            "manage_lead_activity",
            "view_leadactivity",
            "add_leadactivity",
            "view_leadfollowup",
            "add_leadfollowup",
            "change_leadfollowup",
        )
        self.ops1 = User.objects.create_user(
            username="ops1", password="pass", role=User.Roles.EMPLOYEE
        )
        self.ops2 = User.objects.create_user(
            username="ops2", password="pass", role=User.Roles.EMPLOYEE
        )
        ops_group, _ = Group.objects.get_or_create(name=GROUP_OPERATIONS_CRM_USER)
        self.ops1.groups.add(ops_group)
        self.ops2.groups.add(ops_group)
        for ops in (self.ops1, self.ops2):
            _grant(
                ops,
                "view_lead",
                "change_lead",
                "manage_lead_activity",
                "view_leadactivity",
                "add_leadactivity",
                "view_leadfollowup",
                "add_leadfollowup",
                "change_leadfollowup",
                "view_leadassignment",
                "change_leadassignment",
            )
            # refresh after grants
        self.ops1 = User.objects.get(pk=self.ops1.pk)
        self.ops2 = User.objects.get(pk=self.ops2.pk)
        self.assigner = User.objects.get(pk=self.assigner.pk)

        self.lead_unassigned = create_lead(
            actor=self.assigner, name="Unassigned", raw_phone="0509001001"
        )
        self.lead_ops1 = create_lead(
            actor=self.assigner, name="Ops1 Lead", raw_phone="0509001002"
        )
        self.lead_ops2 = create_lead(
            actor=self.assigner, name="Ops2 Lead", raw_phone="0509001003"
        )
        assign_lead(
            actor=self.assigner,
            lead_id=self.lead_ops1.pk,
            operations_employee_id=self.ops1.pk,
        )
        assign_lead(
            actor=self.assigner,
            lead_id=self.lead_ops2.pk,
            operations_employee_id=self.ops2.pk,
        )


class ActivityServiceTests(OperationsFixtures):
    def test_create_append_only(self):
        activity = create_activity(
            actor=self.assigner,
            lead_id=self.lead_unassigned.pk,
            activity_type=LeadActivity.ActivityType.CALL,
            notes="Called",
            subject="First call",
        )
        self.assertEqual(activity.created_by_id, self.assigner.pk)
        self.assertEqual(LeadActivity.objects.filter(lead=self.lead_unassigned).count(), 1)


class FollowUpServiceTests(OperationsFixtures):
    def test_create_update_complete_immutable(self):
        fu = create_followup(
            actor=self.assigner,
            lead_id=self.lead_unassigned.pk,
            scheduled_for=timezone.now() + timedelta(days=1),
            notes="Call back",
        )
        updated = update_followup(
            followup=fu, actor=self.assigner, updates={"notes": "Updated note"}
        )
        self.assertEqual(updated.notes, "Updated note")

        completed = complete_followup(followup=fu, actor=self.assigner)
        self.assertEqual(completed.status, LeadFollowUp.Status.COMPLETED)
        self.assertIsNotNone(completed.completed_at)
        self.assertEqual(completed.completed_by_id, self.assigner.pk)

        with self.assertRaises(FollowUpCompletedError):
            update_followup(followup=completed, actor=self.assigner, updates={"notes": "x"})


class AssignmentServiceTests(OperationsFixtures):
    def test_assign_accept_complete_history(self):
        lead = create_lead(actor=self.assigner, name="Flow", raw_phone="0509002001")
        a1 = assign_lead(
            actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops1.pk
        )
        self.assertEqual(a1.status, LeadAssignment.Status.PENDING)
        self.assertEqual(get_active_assignment(lead_id=lead.pk).pk, a1.pk)

        with self.assertRaises(DuplicateActiveAssignmentError):
            assign_lead(
                actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops2.pk
            )

        accepted = accept_assignment(actor=self.ops1, assignment_id=a1.pk)
        self.assertEqual(accepted.status, LeadAssignment.Status.ACCEPTED)

        with self.assertRaises(AssignmentNotOwnedError):
            complete_assignment(actor=self.ops2, assignment_id=a1.pk)

        completed = complete_assignment(actor=self.ops1, assignment_id=a1.pk)
        self.assertEqual(completed.status, LeadAssignment.Status.COMPLETED)
        self.assertIsNone(get_active_assignment(lead_id=lead.pk))

        # History preserved
        self.assertEqual(LeadAssignment.objects.filter(lead=lead).count(), 1)
        # Assignment activity recorded
        self.assertTrue(
            LeadActivity.objects.filter(
                lead=lead, activity_type=LeadActivity.ActivityType.ASSIGNMENT
            ).exists()
        )

    def test_reject_and_cancel(self):
        lead = create_lead(actor=self.assigner, name="Reject", raw_phone="0509002002")
        a = assign_lead(
            actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops1.pk
        )
        rejected = reject_assignment(actor=self.ops1, assignment_id=a.pk, notes="busy")
        self.assertEqual(rejected.status, LeadAssignment.Status.REJECTED)

        lead2 = create_lead(actor=self.assigner, name="Cancel", raw_phone="0509002003")
        a2 = assign_lead(
            actor=self.assigner, lead_id=lead2.pk, operations_employee_id=self.ops1.pk
        )
        cancelled = cancel_assignment(actor=self.assigner, assignment_id=a2.pk)
        self.assertEqual(cancelled.status, LeadAssignment.Status.CANCELLED)

    def test_reassign_closes_previous(self):
        lead = create_lead(actor=self.assigner, name="Re", raw_phone="0509002004")
        a1 = assign_lead(
            actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops1.pk
        )
        accept_assignment(actor=self.ops1, assignment_id=a1.pk)
        a2 = reassign_lead(
            actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops2.pk
        )
        a1.refresh_from_db()
        self.assertEqual(a1.status, LeadAssignment.Status.REASSIGNED)
        self.assertEqual(a2.status, LeadAssignment.Status.PENDING)
        self.assertEqual(get_active_assignment(lead_id=lead.pk).pk, a2.pk)
        self.assertEqual(LeadAssignment.objects.filter(lead=lead).count(), 2)

    def test_invalid_complete_from_pending(self):
        lead = create_lead(actor=self.assigner, name="Inv", raw_phone="0509002005")
        a = assign_lead(
            actor=self.assigner, lead_id=lead.pk, operations_employee_id=self.ops1.pk
        )
        with self.assertRaises(InvalidAssignmentTransitionError):
            complete_assignment(actor=self.ops1, assignment_id=a.pk)


class VisibilityTests(OperationsFixtures):
    def test_ops_sees_self_and_unassigned_only(self):
        visible = list(visible_leads_for(self.ops1).values_list("name", flat=True))
        self.assertIn("Unassigned", visible)
        self.assertIn("Ops1 Lead", visible)
        self.assertNotIn("Ops2 Lead", visible)

    def test_manager_sees_all(self):
        visible = list(visible_leads_for(self.manager).values_list("name", flat=True))
        self.assertIn("Unassigned", visible)
        self.assertIn("Ops1 Lead", visible)
        self.assertIn("Ops2 Lead", visible)

    def test_api_ops_lead_list_filtered(self):
        client = APIClient()
        client.force_authenticate(self.ops1)
        response = client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 200)
        names = [r["name"] for r in response.json()["results"]]
        self.assertIn("Unassigned", names)
        self.assertIn("Ops1 Lead", names)
        self.assertNotIn("Ops2 Lead", names)


class OperationsAPITests(OperationsFixtures):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.assigner)

    def test_activity_api_no_patch_delete(self):
        created = self.client.post(
            "/api/marketing/activities/",
            {
                "lead_id": str(self.lead_unassigned.pk),
                "activity_type": "note",
                "notes": "hello",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        aid = created.json()["id"]
        self.assertEqual(
            self.client.patch(f"/api/marketing/activities/{aid}/", {"notes": "x"}, format="json").status_code,
            405,
        )
        self.assertEqual(self.client.delete(f"/api/marketing/activities/{aid}/").status_code, 405)
        self.assertEqual(self.client.put(f"/api/marketing/activities/{aid}/", {}, format="json").status_code, 405)

    def test_followup_complete_api(self):
        created = self.client.post(
            "/api/marketing/followups/",
            {
                "lead_id": str(self.lead_unassigned.pk),
                "scheduled_for": (timezone.now() + timedelta(days=2)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        fid = created.json()["id"]
        done = self.client.post(f"/api/marketing/followups/{fid}/complete/", {}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["status"], "completed")

    def test_assignment_workflow_api_and_errors(self):
        lead = create_lead(actor=self.assigner, name="API Flow", raw_phone="0509003001")
        assigned = self.client.post(
            "/api/marketing/assignments/assign/",
            {
                "lead_id": str(lead.pk),
                "operations_employee_id": self.ops1.pk,
            },
            format="json",
        )
        self.assertEqual(assigned.status_code, 201, assigned.content)
        self.assertEqual(assigned.json()["status"], "pending")
        aid = assigned.json()["id"]

        dup = self.client.post(
            "/api/marketing/assignments/assign/",
            {
                "lead_id": str(lead.pk),
                "operations_employee_id": self.ops2.pk,
            },
            format="json",
        )
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["error"]["code"], "duplicate_active_assignment")

        ops_client = APIClient()
        ops_client.force_authenticate(self.ops1)
        accepted = ops_client.post(f"/api/marketing/assignments/{aid}/accept/", {}, format="json")
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["status"], "accepted")

        other = APIClient()
        other.force_authenticate(self.ops2)
        stolen = other.post(f"/api/marketing/assignments/{aid}/complete/", {}, format="json")
        self.assertEqual(stolen.status_code, 403)
        self.assertEqual(stolen.json()["error"]["code"], "assignment_not_owned")

        completed = ops_client.post(f"/api/marketing/assignments/{aid}/complete/", {}, format="json")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["status"], "completed")

        # No DELETE / PATCH on assignments
        self.assertEqual(self.client.delete(f"/api/marketing/assignments/{aid}/").status_code, 405)
        self.assertEqual(
            self.client.patch(f"/api/marketing/assignments/{aid}/", {}, format="json").status_code,
            405,
        )
