"""
Mail Queue Overrides for Mail Scheduler

These hooks extend Mail Queue behavior to support scheduled sending
without modifying the core mail app's doctype.
"""

import frappe
from frappe import _


def before_insert(doc, method=None):
	"""
	Before inserting Mail Queue, check for scheduled_at in context.

	The scheduled_at value is passed via frappe.flags when creating
	mail queue entries for scheduled emails.
	"""
	scheduled_at = frappe.flags.get("mail_scheduler_scheduled_at")
	if scheduled_at:
		# Store in custom field (must be created via fixtures)
		doc.scheduled_at = scheduled_at


def validate(doc, method=None):
	"""
	Validate Mail Queue for scheduled emails.

	Ensures scheduled_at is within valid range.
	"""
	scheduled_at = getattr(doc, "scheduled_at", None)
	if not scheduled_at:
		return

	from frappe.utils import get_datetime, now_datetime

	from mail_scheduler.jmap.futurerelease import get_max_schedule_seconds

	scheduled_datetime = get_datetime(scheduled_at)
	now = now_datetime()

	if scheduled_datetime <= now:
		frappe.throw(_("Scheduled time must be in the future"))

	max_seconds = get_max_schedule_seconds()
	max_datetime = now + frappe.utils.datetime.timedelta(seconds=max_seconds)

	if scheduled_datetime > max_datetime:
		max_days = max_seconds // 86400
		frappe.throw(_("Scheduled time cannot be more than {0} days in the future").format(max_days))
