# type: ignore
"""
Mail Scheduler API - Extended Mail API with Scheduled Send Support

This module provides API endpoints that wrap the mail app's API
to add scheduled email functionality without modifying the core app.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, add_to_date, random_string


@frappe.whitelist()
def create_mail(
	from_email: str,
	to: list[str],
	cc: list[str],
	bcc: list[str],
	subject: str | None,
	html_body: str | None,
	from_name: str = "",
	attachments: list[dict] | None = None,
	in_reply_to: str | None = None,
	in_reply_to_id: str | None = None,
	forwarded_from_id: str | None = None,
	save_as_draft: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Create and send/schedule an email.

	This wraps the mail app's create_mail API and adds scheduled_at support.
	The API signature matches mail.api.mail.create_mail exactly, with an
	additional scheduled_at parameter.

	Args:
		from_email: Sender email address
		to: List of To recipients
		cc: List of CC recipients
		bcc: List of BCC recipients
		subject: Email subject
		html_body: HTML body content
		from_name: Display name for sender
		attachments: List of attachment dicts with file_url, type, size, filename
		in_reply_to: Message-ID being replied to
		in_reply_to_id: Mail Message ID being replied to
		forwarded_from_id: Mail Message ID being forwarded
		save_as_draft: If True, save as draft instead of sending
		scheduled_at: Datetime string for scheduled delivery (ISO format or Frappe datetime)

	Returns:
		dict with id, status, error, and scheduled_at if scheduled
	"""
	from mail.client.doctype.mail_queue.mail_queue import MailQueue
	from mail.api.mail import convert_img_src_from_file_url_to_cid

	# Validate schedule time if provided
	if scheduled_at and not save_as_draft:
		_validate_schedule_time(scheduled_at)

	# Process attachments (same as mail.api.mail.create_mail)
	doc_attachments = []
	for d in attachments or []:
		cid = random_string(10)
		doc_attachments.append(
			{
				"file_url": d.get("file_url", ""),
				"blob_id": d.get("blob_id", ""),
				"filename": d.get("file_name") or d.get("filename", ""),
				"type": d.get("type", ""),
				"size": d.get("size", ""),
				"disposition": d.get("disposition"),
				"cid": cid,
			}
		)
		if d.get("disposition") == "inline" and html_body:
			html_body = convert_img_src_from_file_url_to_cid(html_body, d.get("file_url"), cid)

	# Build recipients list
	recipients = [{"type": "To", "email": email} for email in (to or [])]
	recipients += [{"type": "Cc", "email": email} for email in (cc or [])]
	recipients += [{"type": "Bcc", "email": email} for email in (bcc or [])]

	# Set scheduled_at flag so our hook can pick it up
	if scheduled_at and not save_as_draft:
		frappe.flags.mail_scheduler_scheduled_at = get_datetime(scheduled_at)

	try:
		# Create mail queue using the standard method
		doc = MailQueue._create(
			user=frappe.session.user,
			from_email=from_email,
			from_name=from_name,
			subject=subject,
			html_body=html_body,
			in_reply_to=in_reply_to,
			in_reply_to_id=in_reply_to_id,
			forwarded_from_id=forwarded_from_id,
			attachments=doc_attachments,
			recipients=recipients,
			save_as_draft=save_as_draft,
		)

		result = {"id": doc.id, "status": doc.status, "error": doc.error_message}

		if scheduled_at and not save_as_draft:
			result["scheduled_at"] = str(scheduled_at)
			# Update status to indicate scheduled
			if doc.status == "Submitted":
				result["status"] = "Scheduled"

		return result
	finally:
		# Clean up flag
		frappe.flags.pop("mail_scheduler_scheduled_at", None)


@frappe.whitelist()
def update_draft_mail(
	id: str,
	from_email: str,
	to: list[str],
	cc: list[str],
	bcc: list[str],
	subject: str | None,
	html_body: str | None,
	from_name: str = "",
	attachments: list[dict] | None = None,
	submit: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Update a draft email and optionally submit/schedule it.

	This wraps the mail app's update_draft_mail API and adds scheduled_at support.

	Args:
		id: The JMAP email ID of the draft
		from_email: Sender email address
		to: List of To recipients
		cc: List of CC recipients
		bcc: List of BCC recipients
		subject: Email subject
		html_body: HTML body content
		from_name: Display name for sender
		attachments: List of attachment dicts
		submit: If True, submit the email after updating
		scheduled_at: Datetime string for scheduled delivery

	Returns:
		dict with id, status, error, and scheduled_at if scheduled
	"""
	from mail.utils import convert_html_to_text
	from mail.api.mail import convert_img_src_from_base64_to_cid, convert_img_src_from_file_url_to_cid

	# Validate schedule time if submitting with schedule
	if scheduled_at and submit:
		_validate_schedule_time(scheduled_at)

	# Get the draft document
	doc = frappe.get_doc("Mail Message", f"{frappe.session.user}|{id}")
	doc.check_permission(permtype="write")

	# Update fields
	doc.from_email = from_email
	doc.from_name = from_name
	doc.subject = subject

	# Process attachments
	doc.attachments = []
	for d in attachments or []:
		cid = d.get("cid", random_string(10))
		doc.append(
			"attachments",
			{
				"blob_id": d.get("blob_id", ""),
				"file_url": d.get("file_url", ""),
				"type": d.get("type", ""),
				"size": d.get("size", ""),
				"filename": d.get("filename", ""),
				"disposition": d.get("disposition"),
				"cid": cid,
			},
		)
		if d.get("disposition") == "inline" and html_body:
			html_body = convert_img_src_from_file_url_to_cid(html_body, d.get("file_url"), cid)

	doc.html_body = convert_img_src_from_base64_to_cid(html_body) if html_body else None
	doc.text_body = convert_html_to_text(doc.html_body) if doc.html_body else None

	# Update recipients
	doc.recipients = []
	for email in to or []:
		doc.append("recipients", {"type": "To", "email": email})
	for email in cc or []:
		doc.append("recipients", {"type": "Cc", "email": email})
	for email in bcc or []:
		doc.append("recipients", {"type": "Bcc", "email": email})

	# Set scheduled_at flag if submitting with schedule
	if scheduled_at and submit:
		frappe.flags.mail_scheduler_scheduled_at = get_datetime(scheduled_at)

	try:
		if submit:
			new_doc = doc.submit()
		else:
			new_doc = doc.save_draft()

		result = {"id": new_doc.id, "status": new_doc.status, "error": new_doc.error_message}

		if scheduled_at and submit:
			result["scheduled_at"] = str(scheduled_at)
			if new_doc.status == "Submitted":
				result["status"] = "Scheduled"

		return result
	finally:
		frappe.flags.pop("mail_scheduler_scheduled_at", None)


@frappe.whitelist()
def cancel_scheduled_mail(mail_queue_name: str) -> dict:
	"""
	Cancel a scheduled email.

	Args:
		mail_queue_name: Name of the Mail Queue document

	Returns:
		dict with success status and message
	"""
	doc = frappe.get_doc("Mail Queue", mail_queue_name)
	doc.check_permission(permtype="write")

	# Check if email is actually scheduled
	scheduled_at = doc.get("scheduled_at")
	if not scheduled_at:
		frappe.throw(_("This email is not scheduled"))

	# Check if already sent
	if doc.status in ["Sent", "Delivered"]:
		frappe.throw(_("Cannot cancel an email that has already been sent"))

	# Check if past schedule time
	if get_datetime(scheduled_at) <= now_datetime():
		frappe.throw(_("Cannot cancel an email past its scheduled time"))

	# Try to cancel via JMAP if submission_id exists
	submission_id = doc.get("submission_id")
	if submission_id:
		try:
			from mail_scheduler.jmap.futurerelease import email_submission_cancel
			email_submission_cancel(doc.user, submission_id)
		except Exception as e:
			frappe.log_error(f"Failed to cancel JMAP submission: {e}")

	# Update the document
	doc.db_set({
		"status": "Cancelled",
		"scheduled_at": None,
		"submission_id": None,
	})

	return {"success": True, "message": _("Scheduled email cancelled successfully")}


@frappe.whitelist()
def reschedule_mail(mail_queue_name: str, new_scheduled_at: str) -> dict:
	"""
	Reschedule a scheduled email to a new time.

	Args:
		mail_queue_name: Name of the Mail Queue document
		new_scheduled_at: New datetime string for scheduled delivery

	Returns:
		dict with success status and new schedule time
	"""
	# Validate new schedule time
	_validate_schedule_time(new_scheduled_at)

	doc = frappe.get_doc("Mail Queue", mail_queue_name)
	doc.check_permission(permtype="write")

	# Check if email is actually scheduled
	old_scheduled_at = doc.get("scheduled_at")
	if not old_scheduled_at:
		frappe.throw(_("This email is not scheduled"))

	# Check if already sent
	if doc.status in ["Sent", "Delivered"]:
		frappe.throw(_("Cannot reschedule an email that has already been sent"))

	# For now, we cancel and resubmit
	# In the future, Stalwart may support updating HOLDUNTIL directly
	submission_id = doc.get("submission_id")
	if submission_id:
		try:
			from mail_scheduler.jmap.futurerelease import email_submission_cancel
			email_submission_cancel(doc.user, submission_id)
		except Exception:
			pass  # Continue even if cancel fails

	# Update scheduled time and reprocess
	new_dt = get_datetime(new_scheduled_at)
	doc.db_set("scheduled_at", new_dt)

	# Set flag and reprocess
	frappe.flags.mail_scheduler_scheduled_at = new_dt
	try:
		doc._process()
	finally:
		frappe.flags.pop("mail_scheduler_scheduled_at", None)

	return {
		"success": True,
		"scheduled_at": str(new_scheduled_at),
		"message": _("Email rescheduled successfully"),
	}


@frappe.whitelist()
def get_scheduled_mails(
	page_length: int = 20,
	start: int = 0,
	status: str | None = None,
) -> list[dict]:
	"""
	Get list of scheduled emails for the current user.

	Args:
		page_length: Number of results to return
		start: Offset for pagination
		status: Filter by status (Scheduled, Pending, etc.)

	Returns:
		List of scheduled email dicts
	"""
	filters = {
		"user": frappe.session.user,
		"scheduled_at": ["is", "set"],
	}

	if status:
		filters["status"] = status

	scheduled_mails = frappe.get_all(
		"Mail Queue",
		filters=filters,
		fields=[
			"name",
			"subject",
			"from_email",
			"recipients",
			"scheduled_at",
			"status",
			"creation",
			"submission_id",
		],
		order_by="scheduled_at asc",
		start=start,
		page_length=page_length,
	)

	return scheduled_mails


def _validate_schedule_time(scheduled_at: str) -> None:
	"""
	Validate that the scheduled time is valid.

	Args:
		scheduled_at: Datetime string to validate

	Raises:
		frappe.ValidationError: If the time is invalid
	"""
	try:
		schedule_dt = get_datetime(scheduled_at)
	except Exception:
		frappe.throw(_("Invalid datetime format for scheduled_at"))

	now = now_datetime()

	# Must be in the future (with 1 minute grace period)
	min_schedule_time = add_to_date(now, minutes=1)
	if schedule_dt < min_schedule_time:
		frappe.throw(_("Scheduled time must be at least 1 minute in the future"))

	# Must be within Stalwart's maxDelayedSend limit (30 days)
	max_schedule_time = add_to_date(now, days=30)
	if schedule_dt > max_schedule_time:
		frappe.throw(_("Scheduled time cannot be more than 30 days in the future"))


def get_max_schedule_days() -> int:
	"""
	Get the maximum number of days an email can be scheduled in advance.

	Returns:
		Maximum days (default 30 based on Stalwart's maxDelayedSend)
	"""
	return 30
