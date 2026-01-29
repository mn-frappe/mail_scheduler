# type: ignore
"""
Scheduled Tasks for Mail Scheduler

Background tasks for managing scheduled emails.
"""

import frappe
from frappe import _


def check_scheduled_emails_status():
	"""
	Check status of scheduled emails and update accordingly.

	This runs every 5 minutes to:
	1. Mark sent emails as "Sent"
	2. Handle failed deliveries
	3. Clean up expired submissions
	"""
	from mail_scheduler.jmap.futurerelease import (
		email_submission_get,
		get_jmap_client,
	)

	# Get scheduled emails that might have been sent
	scheduled_emails = frappe.get_all(
		"Mail Queue",
		filters={
			"scheduled_at": ["is", "set"],
			"status": ["in", ["Scheduled", "Queued", "Pending"]],
			"submission_id": ["is", "set"],
		},
		fields=["name", "user", "submission_id", "scheduled_at"],
	)

	if not scheduled_emails:
		return

	# Group by user for efficient JMAP calls
	user_emails = {}
	for email in scheduled_emails:
		user_emails.setdefault(email.user, []).append(email)

	for user, emails in user_emails.items():
		try:
			client = get_jmap_client(user)
			submission_ids = [e.submission_id for e in emails]

			# Get submission statuses
			response = email_submission_get(client, submission_ids)
			submissions = response["methodResponses"][0][1].get("list", [])
			submission_map = {s["id"]: s for s in submissions}

			for email in emails:
				submission = submission_map.get(email.submission_id)

				if not submission:
					# Submission not found - might be sent and cleaned up
					_check_if_sent(email)
					continue

				undo_status = submission.get("undoStatus")

				if undo_status == "final":
					# Email has been sent
					frappe.db.set_value("Mail Queue", email.name, "status", "Sent")

				elif undo_status == "canceled":
					# Email was cancelled externally
					frappe.db.set_value("Mail Queue", email.name, "status", "Cancelled")

				# "pending" means still scheduled, no action needed

			frappe.db.commit()

		except Exception:
			frappe.log_error(
				_("Failed to check scheduled emails for user {0}").format(user),
				frappe.get_traceback(with_context=True)
			)


def _check_if_sent(email):
	"""
	Check if email was sent by looking at scheduled time.

	If scheduled time has passed and submission is gone, assume sent.
	"""
	from frappe.utils import get_datetime, now_datetime

	scheduled_datetime = get_datetime(email.scheduled_at)

	if scheduled_datetime < now_datetime():
		# Scheduled time has passed, mark as sent
		frappe.db.set_value("Mail Queue", email.name, "status", "Sent")
