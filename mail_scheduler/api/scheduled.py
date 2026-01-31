# type: ignore
"""
Scheduled Emails API - Enterprise Grade

API endpoints for managing scheduled emails with comprehensive
security, validation, and error handling.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, cint, cstr
from frappe.rate_limiter import rate_limit
from typing import Any


# Import validation helpers from mail module
from mail_scheduler.api.mail import (
	SchedulerValidationError,
	SchedulerSecurityError,
	_validate_user_permissions,
	_validate_schedule_time,
	_sanitize_input,
	_log_scheduler_event,
	MAX_SCHEDULE_DAYS,
)


def _get_logger():
	"""Get the mail scheduler logger."""
	return frappe.logger("mail_scheduler", allow_site=True, file_count=10)


def _validate_ownership(doc, allow_admin: bool = True) -> None:
	"""
	Validate that the current user owns the document.
	
	Args:
		doc: The document to check
		allow_admin: If True, allow System Managers to access any doc
	"""
	user = frappe.session.user
	
	if doc.user != user:
		if allow_admin and "System Manager" in frappe.get_roles(user):
			return
		raise SchedulerSecurityError(_("You do not have permission to access this email"))


@frappe.whitelist()
@rate_limit(limit=120, seconds=60)
def get_scheduled_emails(
	limit: int = 20,
	offset: int = 0,
	status: str | None = None,
	sort_by: str = "scheduled_at",
	sort_order: str = "asc",
) -> dict:
	"""
	Get list of scheduled emails for the current user.
	
	Args:
		limit: Maximum number of emails to return (max 100)
		offset: Offset for pagination
		status: Filter by status (Submitted, Cancelled, etc.)
		sort_by: Field to sort by (scheduled_at, creation, subject)
		sort_order: Sort order (asc, desc)
		
	Returns:
		dict with emails list, total count, and pagination info
	"""
	_validate_user_permissions()
	
	user = frappe.session.user
	
	# Sanitize and validate pagination
	limit = min(max(cint(limit) or 20, 1), 100)
	offset = max(cint(offset) or 0, 0)
	
	# Validate sort parameters
	allowed_sort_fields = ["scheduled_at", "creation", "subject", "from_email"]
	sort_by = sort_by if sort_by in allowed_sort_fields else "scheduled_at"
	sort_order = "desc" if sort_order.lower() == "desc" else "asc"
	
	# Build filters
	filters = {
		"user": user,
		"scheduled_at": ["is", "set"],
	}
	
	if status:
		status = _sanitize_input(cstr(status).strip())
		if status in ["Submitted", "Cancelled", "Sent", "Delivered", "Failed"]:
			filters["status"] = status
	
	try:
		# Get emails
		emails = frappe.get_all(
			"Mail Queue",
			filters=filters,
			fields=[
				"name",
				"id",
				"from_email",
				"from_name",
				"subject",
				"scheduled_at",
				"creation",
				"status",
				"error_message",
			],
			order_by=f"{sort_by} {sort_order}",
			limit=limit,
			start=offset,
		)
		
		# Get recipients for each email (batched for efficiency)
		if emails:
			email_names = [e.name for e in emails]
			
			all_recipients = frappe.get_all(
				"Mail Queue Recipient",
				filters={"parent": ["in", email_names]},
				fields=["parent", "email", "type"],
			)
			
			# Group recipients by parent
			recipients_map = {}
			for r in all_recipients:
				if r.parent not in recipients_map:
					recipients_map[r.parent] = []
				recipients_map[r.parent].append(r)
			
			# Attach recipients to emails
			for email in emails:
				email_recipients = recipients_map.get(email.name, [])
				email["recipients"] = email_recipients
				email["to"] = [r["email"] for r in email_recipients if r["type"] == "To"]
				email["cc"] = [r["email"] for r in email_recipients if r["type"] == "Cc"]
				email["recipient_count"] = len(email_recipients)
		
		# Get total count
		total = frappe.db.count("Mail Queue", filters)
		
		return {
			"emails": emails,
			"total": total,
			"limit": limit,
			"offset": offset,
			"has_more": offset + len(emails) < total,
		}
		
	except Exception as e:
		_get_logger().error(f"Error fetching scheduled emails: {e}")
		raise


@frappe.whitelist()
@rate_limit(limit=60, seconds=60)
def get_scheduled_email(email_id: str) -> dict:
	"""
	Get details of a single scheduled email.
	
	Args:
		email_id: The JMAP email ID or Mail Queue name
		
	Returns:
		dict with email details
	"""
	_validate_user_permissions()
	
	email_id = _sanitize_input(cstr(email_id).strip())
	user = frappe.session.user
	
	# Try to find by ID first, then by name
	email = None
	
	for field in ["id", "name"]:
		email = frappe.get_value(
			"Mail Queue",
			{"user": user, field: email_id},
			[
				"name", "id", "from_email", "from_name", "subject",
				"html_body", "text_body", "scheduled_at", "creation",
				"status", "error_message", "submission_id"
			],
			as_dict=True,
		)
		if email:
			break
	
	if not email:
		raise SchedulerValidationError(_("Email not found"))
	
	# Get recipients
	recipients = frappe.get_all(
		"Mail Queue Recipient",
		filters={"parent": email.name},
		fields=["email", "type", "display_name"],
	)
	
	email["recipients"] = recipients
	email["to"] = [r["email"] for r in recipients if r["type"] == "To"]
	email["cc"] = [r["email"] for r in recipients if r["type"] == "Cc"]
	email["bcc"] = [r["email"] for r in recipients if r["type"] == "Bcc"]
	
	# Get attachments
	attachments = frappe.get_all(
		"Mail Queue Attachment",
		filters={"parent": email.name},
		fields=["filename", "type", "size", "blob_id", "disposition"],
	)
	email["attachments"] = attachments
	
	# Calculate time until send
	if email.scheduled_at:
		delta = get_datetime(email.scheduled_at) - now_datetime()
		email["seconds_until_send"] = max(0, int(delta.total_seconds()))
	
	return email


@frappe.whitelist()
@rate_limit(limit=30, seconds=60)
def cancel_scheduled_email(email_id: str) -> dict:
	"""
	Cancel a scheduled email.
	
	Args:
		email_id: The JMAP email ID or Mail Queue name
		
	Returns:
		dict with success status and message
	"""
	_validate_user_permissions()
	
	email_id = _sanitize_input(cstr(email_id).strip())
	user = frappe.session.user
	
	# Find the email
	mail_queue = None
	for field in ["id", "name"]:
		mail_queue = frappe.get_value(
			"Mail Queue",
			{"user": user, field: email_id},
			["name", "id", "from_email", "scheduled_at", "status", "submission_id"],
			as_dict=True,
		)
		if mail_queue:
			break
	
	if not mail_queue:
		raise SchedulerValidationError(_("Scheduled email not found"))
	
	# Validate state
	if not mail_queue.scheduled_at:
		raise SchedulerValidationError(_("This email is not scheduled"))
	
	if mail_queue.status in ["Sent", "Delivered"]:
		raise SchedulerValidationError(_("Cannot cancel an email that has already been sent"))
	
	if mail_queue.status == "Cancelled":
		raise SchedulerValidationError(_("This email is already cancelled"))
	
	# Check if past schedule time (with 30 second grace period)
	schedule_time = get_datetime(mail_queue.scheduled_at)
	if schedule_time <= now_datetime():
		# Check if very recently passed
		delta = (now_datetime() - schedule_time).total_seconds()
		if delta > 30:
			raise SchedulerValidationError(_("Cannot cancel an email past its scheduled time"))
	
	_log_scheduler_event("cancel_attempt", {
		"email_id": email_id,
		"mail_queue": mail_queue.name,
		"scheduled_at": str(mail_queue.scheduled_at),
	})
	
	# Try to cancel via JMAP
	jmap_cancelled = False
	jmap_error = None
	
	if mail_queue.submission_id:
		try:
			from mail_scheduler.jmap.futurerelease import email_submission_cancel
			email_submission_cancel(user, mail_queue.id)
			jmap_cancelled = True
		except Exception as e:
			jmap_error = str(e)
			_get_logger().warning(f"JMAP cancel failed for {mail_queue.name}: {e}")
	
	# Update Mail Queue status
	try:
		frappe.db.set_value("Mail Queue", mail_queue.name, {
			"status": "Cancelled",
			"error_message": "Cancelled by user" + (f" (JMAP: {jmap_error})" if jmap_error else ""),
		})
		frappe.db.commit()
	except Exception as e:
		_get_logger().error(f"Failed to update Mail Queue status: {e}")
		raise
	
	_log_scheduler_event("cancel_success", {
		"email_id": email_id,
		"mail_queue": mail_queue.name,
		"jmap_cancelled": jmap_cancelled,
	})
	
	return {
		"success": True,
		"message": _("Scheduled email cancelled successfully"),
		"jmap_cancelled": jmap_cancelled,
		"jmap_error": jmap_error,
	}


@frappe.whitelist()
@rate_limit(limit=30, seconds=60)
def reschedule_email(email_id: str, new_scheduled_at: str) -> dict:
	"""
	Reschedule a scheduled email to a new time.
	
	Note: Due to JMAP limitations, rescheduling may involve cancelling
	and resubmitting the email.
	
	Args:
		email_id: The JMAP email ID or Mail Queue name
		new_scheduled_at: New scheduled datetime (ISO format)
		
	Returns:
		dict with success status and new schedule time
	"""
	_validate_user_permissions()
	
	email_id = _sanitize_input(cstr(email_id).strip())
	new_scheduled_at = _sanitize_input(cstr(new_scheduled_at).strip())
	user = frappe.session.user
	
	# Validate new time
	_validate_schedule_time(new_scheduled_at)
	new_datetime = get_datetime(new_scheduled_at)
	
	# Find the email
	mail_queue = None
	for field in ["id", "name"]:
		mail_queue = frappe.get_value(
			"Mail Queue",
			{"user": user, field: email_id},
			["name", "id", "from_email", "scheduled_at", "status", "submission_id"],
			as_dict=True,
		)
		if mail_queue:
			break
	
	if not mail_queue:
		raise SchedulerValidationError(_("Scheduled email not found"))
	
	# Validate state
	if not mail_queue.scheduled_at:
		raise SchedulerValidationError(_("This email is not scheduled"))
	
	if mail_queue.status in ["Sent", "Delivered"]:
		raise SchedulerValidationError(_("Cannot reschedule an email that has already been sent"))
	
	if mail_queue.status == "Cancelled":
		raise SchedulerValidationError(_("Cannot reschedule a cancelled email"))
	
	old_scheduled_at = mail_queue.scheduled_at
	
	_log_scheduler_event("reschedule_attempt", {
		"email_id": email_id,
		"mail_queue": mail_queue.name,
		"old_scheduled_at": str(old_scheduled_at),
		"new_scheduled_at": new_scheduled_at,
	})
	
	# Note: JMAP doesn't support changing HOLDUNTIL after submission
	# We update our local record for display purposes
	# The email will still be sent at the original time by Stalwart
	
	try:
		frappe.db.set_value("Mail Queue", mail_queue.name, {
			"scheduled_at": new_datetime,
		})
		frappe.db.commit()
	except Exception as e:
		_get_logger().error(f"Failed to update scheduled_at: {e}")
		raise
	
	_log_scheduler_event("reschedule_success", {
		"email_id": email_id,
		"mail_queue": mail_queue.name,
		"new_scheduled_at": str(new_datetime),
	})
	
	return {
		"success": True,
		"message": _("Schedule updated. Note: Server may still send at original time due to JMAP limitations."),
		"old_scheduled_at": str(old_scheduled_at),
		"new_scheduled_at": str(new_datetime),
		"warning": _("JMAP does not support changing HOLDUNTIL after submission. For guaranteed rescheduling, cancel and create a new scheduled email."),
	}


@frappe.whitelist()
@rate_limit(limit=120, seconds=60)
def get_scheduled_count() -> dict:
	"""
	Get count of scheduled emails for the current user.
	
	Returns:
		dict with counts by status
	"""
	_validate_user_permissions()
	
	user = frappe.session.user
	
	# Get counts by status
	base_filters = {
		"user": user,
		"scheduled_at": ["is", "set"],
	}
	
	total = frappe.db.count("Mail Queue", base_filters)
	
	pending = frappe.db.count("Mail Queue", {
		**base_filters,
		"status": "Submitted",
		"scheduled_at": [">", now_datetime()],
	})
	
	sent = frappe.db.count("Mail Queue", {
		**base_filters,
		"status": ["in", ["Sent", "Delivered"]],
	})
	
	cancelled = frappe.db.count("Mail Queue", {
		**base_filters,
		"status": "Cancelled",
	})
	
	failed = frappe.db.count("Mail Queue", {
		**base_filters,
		"status": "Failed",
	})
	
	return {
		"total": total,
		"pending": pending,
		"sent": sent,
		"cancelled": cancelled,
		"failed": failed,
	}


@frappe.whitelist()
def get_scheduler_config() -> dict:
	"""
	Get scheduler configuration for the frontend.
	
	Returns:
		dict with scheduler settings
	"""
	return {
		"enabled": True,
		"max_schedule_days": MAX_SCHEDULE_DAYS,
		"min_schedule_minutes": 1,
		"max_recipients": 500,
		"max_attachments": 25,
		"max_attachment_size_mb": 25,
	}
