# type: ignore
"""
Mail Scheduler API - Extended Mail API with Scheduled Send Support

Enterprise-grade implementation with comprehensive error handling,
validation, security checks, and audit logging.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, add_to_date, random_string, cint, cstr
from frappe.rate_limiter import rate_limit
import re
from typing import Any

# Constants
MIN_SCHEDULE_MINUTES = 1
MAX_SCHEDULE_DAYS = 30
MAX_RECIPIENTS = 500
MAX_ATTACHMENTS = 25
MAX_ATTACHMENT_SIZE_MB = 25
MAX_SUBJECT_LENGTH = 998  # RFC 5322
MAX_BODY_SIZE_MB = 50


class SchedulerValidationError(frappe.ValidationError):
	"""Custom exception for scheduler-specific validation errors."""
	pass


class SchedulerSecurityError(frappe.PermissionError):
	"""Custom exception for scheduler security violations."""
	pass


def _log_scheduler_event(event_type: str, details: dict, level: str = "info") -> None:
	"""
	Log scheduler events for audit trail.
	
	Args:
		event_type: Type of event (create, cancel, reschedule, etc.)
		details: Event details dictionary
		level: Log level (info, warning, error)
	"""
	user = frappe.session.user
	details["user"] = user
	details["event_type"] = event_type
	details["timestamp"] = str(now_datetime())
	
	logger = frappe.logger("mail_scheduler", allow_site=True, file_count=10)
	log_msg = f"[{event_type.upper()}] User={user} | {details}"
	
	if level == "error":
		logger.error(log_msg)
	elif level == "warning":
		logger.warning(log_msg)
	else:
		logger.info(log_msg)


def _validate_user_permissions() -> None:
	"""Validate that the current user has permission to use mail scheduler."""
	user = frappe.session.user
	
	if user == "Guest":
		raise SchedulerSecurityError(_("Guest users cannot schedule emails"))
	
	# Check if user has mail permission
	if not frappe.has_permission("Mail Queue", "create"):
		raise SchedulerSecurityError(_("You do not have permission to send emails"))


def _validate_email_address(email: str) -> bool:
	"""
	Validate email address format.
	
	Args:
		email: Email address to validate
		
	Returns:
		True if valid, raises exception if invalid
	"""
	if not email:
		return False
	
	# Basic email regex pattern
	pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
	if not re.match(pattern, email.strip()):
		raise SchedulerValidationError(_("Invalid email address: {0}").format(email))
	
	return True


def _validate_recipients(to: list, cc: list, bcc: list) -> None:
	"""
	Validate recipient lists.
	
	Args:
		to: To recipients
		cc: CC recipients
		bcc: BCC recipients
	"""
	total_recipients = len(to or []) + len(cc or []) + len(bcc or [])
	
	if total_recipients == 0:
		raise SchedulerValidationError(_("At least one recipient is required"))
	
	if total_recipients > MAX_RECIPIENTS:
		raise SchedulerValidationError(
			_("Too many recipients. Maximum allowed: {0}").format(MAX_RECIPIENTS)
		)
	
	# Validate each email address
	all_emails = (to or []) + (cc or []) + (bcc or [])
	for email in all_emails:
		_validate_email_address(email)


def _validate_sender(from_email: str) -> None:
	"""
	Validate that the user can send from this email address.
	
	Args:
		from_email: Sender email address
	"""
	_validate_email_address(from_email)
	
	user = frappe.session.user
	
	# Check if user owns this identity
	identity_exists = frappe.db.exists(
		"Mail Identity",
		{"user": user, "email": from_email, "enabled": 1}
	)
	
	if not identity_exists:
		# Check for shared identities or admin override
		is_admin = "System Manager" in frappe.get_roles(user)
		if not is_admin:
			raise SchedulerSecurityError(
				_("You do not have permission to send from {0}").format(from_email)
			)


def _validate_attachments(attachments: list | None) -> None:
	"""
	Validate attachment constraints.
	
	Args:
		attachments: List of attachment dicts
	"""
	if not attachments:
		return
	
	if len(attachments) > MAX_ATTACHMENTS:
		raise SchedulerValidationError(
			_("Too many attachments. Maximum allowed: {0}").format(MAX_ATTACHMENTS)
		)
	
	total_size = 0
	for att in attachments:
		size = cint(att.get("size", 0))
		total_size += size
		
		# Check individual attachment size
		if size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024:
			raise SchedulerValidationError(
				_("Attachment {0} exceeds maximum size of {1}MB").format(
					att.get("filename", "unknown"), MAX_ATTACHMENT_SIZE_MB
				)
			)
	
	# Check total size
	if total_size > MAX_BODY_SIZE_MB * 1024 * 1024:
		raise SchedulerValidationError(
			_("Total attachment size exceeds maximum of {0}MB").format(MAX_BODY_SIZE_MB)
		)


def _validate_schedule_time(scheduled_at: str) -> None:
	"""
	Validate that the scheduled time is valid.

	Args:
		scheduled_at: Datetime string to validate

	Raises:
		SchedulerValidationError: If the time is invalid
	"""
	if not scheduled_at:
		return
	
	try:
		schedule_dt = get_datetime(scheduled_at)
	except Exception as e:
		raise SchedulerValidationError(
			_("Invalid datetime format for scheduled_at: {0}").format(str(e))
		)

	now = now_datetime()

	# Must be in the future (with grace period)
	min_schedule_time = add_to_date(now, minutes=MIN_SCHEDULE_MINUTES)
	if schedule_dt < min_schedule_time:
		raise SchedulerValidationError(
			_("Scheduled time must be at least {0} minute(s) in the future").format(MIN_SCHEDULE_MINUTES)
		)

	# Must be within maximum limit
	max_schedule_time = add_to_date(now, days=MAX_SCHEDULE_DAYS)
	if schedule_dt > max_schedule_time:
		raise SchedulerValidationError(
			_("Scheduled time cannot be more than {0} days in the future").format(MAX_SCHEDULE_DAYS)
		)


def _validate_subject(subject: str | None) -> None:
	"""Validate email subject."""
	if subject and len(subject) > MAX_SUBJECT_LENGTH:
		raise SchedulerValidationError(
			_("Subject is too long. Maximum length: {0} characters").format(MAX_SUBJECT_LENGTH)
		)


def _validate_body(html_body: str | None) -> None:
	"""Validate email body size."""
	if html_body and len(html_body.encode('utf-8')) > MAX_BODY_SIZE_MB * 1024 * 1024:
		raise SchedulerValidationError(
			_("Email body is too large. Maximum size: {0}MB").format(MAX_BODY_SIZE_MB)
		)


def _sanitize_input(value: Any) -> Any:
	"""
	Sanitize input to prevent injection attacks.
	
	Args:
		value: Input value to sanitize
		
	Returns:
		Sanitized value
	"""
	if isinstance(value, str):
		# Remove null bytes and other dangerous characters
		value = value.replace('\x00', '')
		# Limit string length to prevent DoS
		if len(value) > 10 * 1024 * 1024:  # 10MB max
			raise SchedulerValidationError(_("Input value too large"))
	return value


@frappe.whitelist()
@rate_limit(limit=60, seconds=60)  # 60 requests per minute
def create_mail(
	from_email: str,
	to: list[str],
	cc: list[str],
	bcc: list[str],
	subject: str | None = None,
	html_body: str | None = None,
	from_name: str = "",
	attachments: list[dict] | None = None,
	in_reply_to: str | None = None,
	in_reply_to_id: str | None = None,
	forwarded_from_id: str | None = None,
	save_as_draft: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Create and send/schedule an email with enterprise-grade validation.

	Args:
		from_email: Sender email address
		to: List of To recipients
		cc: List of CC recipients
		bcc: List of BCC recipients
		subject: Email subject
		html_body: HTML body content
		from_name: Display name for sender
		attachments: List of attachment dicts
		in_reply_to: Message-ID being replied to
		in_reply_to_id: Mail Message ID being replied to
		forwarded_from_id: Mail Message ID being forwarded
		save_as_draft: If True, save as draft instead of sending
		scheduled_at: Datetime string for scheduled delivery

	Returns:
		dict with id, status, error, and scheduled_at if scheduled
	"""
	from mail.client.doctype.mail_queue.mail_queue import MailQueue
	from mail.api.mail import convert_img_src_from_file_url_to_cid

	# Sanitize inputs
	from_email = _sanitize_input(cstr(from_email).strip())
	from_name = _sanitize_input(cstr(from_name).strip())
	subject = _sanitize_input(cstr(subject)) if subject else None
	html_body = _sanitize_input(html_body) if html_body else None
	scheduled_at = _sanitize_input(cstr(scheduled_at).strip()) if scheduled_at else None
	
	# Normalize list inputs
	to = [_sanitize_input(cstr(e).strip()) for e in (to or []) if e]
	cc = [_sanitize_input(cstr(e).strip()) for e in (cc or []) if e]
	bcc = [_sanitize_input(cstr(e).strip()) for e in (bcc or []) if e]

	# Security validations
	_validate_user_permissions()
	_validate_sender(from_email)
	
	# Input validations
	_validate_recipients(to, cc, bcc)
	_validate_subject(subject)
	_validate_body(html_body)
	_validate_attachments(attachments)

	# Schedule time validation
	is_scheduled = bool(scheduled_at and not save_as_draft)
	if is_scheduled:
		_validate_schedule_time(scheduled_at)
		_log_scheduler_event("schedule_attempt", {
			"from": from_email,
			"to": to,
			"subject": subject[:100] if subject else None,
			"scheduled_at": scheduled_at,
		})

	# Process attachments
	doc_attachments = []
	for d in attachments or []:
		cid = random_string(10)
		doc_attachments.append({
			"file_url": _sanitize_input(d.get("file_url", "")),
			"blob_id": _sanitize_input(d.get("blob_id", "")),
			"filename": _sanitize_input(d.get("file_name") or d.get("filename", "")),
			"type": _sanitize_input(d.get("type", "")),
			"size": cint(d.get("size", 0)),
			"disposition": _sanitize_input(d.get("disposition")),
			"cid": cid,
		})
		if d.get("disposition") == "inline" and html_body:
			html_body = convert_img_src_from_file_url_to_cid(html_body, d.get("file_url"), cid)

	# Build recipients list
	recipients = [{"type": "To", "email": email} for email in to]
	recipients += [{"type": "Cc", "email": email} for email in cc]
	recipients += [{"type": "Bcc", "email": email} for email in bcc]

	# Set scheduled_at flag for monkey patch
	if is_scheduled:
		frappe.flags.mail_scheduler_scheduled_at = get_datetime(scheduled_at)

	try:
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

		result = {
			"id": doc.id,
			"status": doc.status,
			"error": doc.error_message,
			"mail_queue_name": doc.name,
		}

		if is_scheduled:
			result["scheduled_at"] = str(scheduled_at)
			if doc.status == "Submitted":
				result["status"] = "Scheduled"
				
			_log_scheduler_event("schedule_success", {
				"mail_queue": doc.name,
				"email_id": doc.id,
				"scheduled_at": scheduled_at,
			})

		return result
		
	except Exception as e:
		_log_scheduler_event("schedule_error", {
			"error": str(e),
			"scheduled_at": scheduled_at,
		}, level="error")
		raise
		
	finally:
		frappe.flags.pop("mail_scheduler_scheduled_at", None)


@frappe.whitelist()
@rate_limit(limit=60, seconds=60)
def update_draft_mail(
	id: str,
	from_email: str,
	to: list[str],
	cc: list[str],
	bcc: list[str],
	subject: str | None = None,
	html_body: str | None = None,
	from_name: str = "",
	attachments: list[dict] | None = None,
	submit: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Update a draft email and optionally submit/schedule it.

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

	# Sanitize inputs
	id = _sanitize_input(cstr(id).strip())
	from_email = _sanitize_input(cstr(from_email).strip())
	from_name = _sanitize_input(cstr(from_name).strip())
	subject = _sanitize_input(cstr(subject)) if subject else None
	html_body = _sanitize_input(html_body) if html_body else None
	scheduled_at = _sanitize_input(cstr(scheduled_at).strip()) if scheduled_at else None
	
	to = [_sanitize_input(cstr(e).strip()) for e in (to or []) if e]
	cc = [_sanitize_input(cstr(e).strip()) for e in (cc or []) if e]
	bcc = [_sanitize_input(cstr(e).strip()) for e in (bcc or []) if e]

	# Security validations
	_validate_user_permissions()
	_validate_sender(from_email)
	
	# Input validations
	_validate_recipients(to, cc, bcc)
	_validate_subject(subject)
	_validate_body(html_body)
	_validate_attachments(attachments)

	# Schedule time validation
	is_scheduled = bool(scheduled_at and submit)
	if is_scheduled:
		_validate_schedule_time(scheduled_at)

	# Get and validate the draft document
	try:
		doc = frappe.get_doc("Mail Message", f"{frappe.session.user}|{id}")
	except frappe.DoesNotExistError:
		raise SchedulerValidationError(_("Draft email not found"))
	
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
				"blob_id": _sanitize_input(d.get("blob_id", "")),
				"file_url": _sanitize_input(d.get("file_url", "")),
				"type": _sanitize_input(d.get("type", "")),
				"size": cint(d.get("size", 0)),
				"filename": _sanitize_input(d.get("filename", "")),
				"disposition": _sanitize_input(d.get("disposition")),
				"cid": cid,
			},
		)
		if d.get("disposition") == "inline" and html_body:
			html_body = convert_img_src_from_file_url_to_cid(html_body, d.get("file_url"), cid)

	doc.html_body = convert_img_src_from_base64_to_cid(html_body) if html_body else None
	doc.text_body = convert_html_to_text(doc.html_body) if doc.html_body else None

	# Update recipients
	doc.recipients = []
	for email in to:
		doc.append("recipients", {"type": "To", "email": email})
	for email in cc:
		doc.append("recipients", {"type": "Cc", "email": email})
	for email in bcc:
		doc.append("recipients", {"type": "Bcc", "email": email})

	# Set scheduled_at flag
	if is_scheduled:
		frappe.flags.mail_scheduler_scheduled_at = get_datetime(scheduled_at)

	try:
		if submit:
			new_doc = doc.submit()
		else:
			new_doc = doc.save_draft()

		result = {
			"id": new_doc.id,
			"status": new_doc.status,
			"error": new_doc.error_message,
		}

		if is_scheduled:
			result["scheduled_at"] = str(scheduled_at)
			if new_doc.status == "Submitted":
				result["status"] = "Scheduled"

		return result
		
	finally:
		frappe.flags.pop("mail_scheduler_scheduled_at", None)


@frappe.whitelist()
@rate_limit(limit=30, seconds=60)
def cancel_scheduled_mail(mail_queue_name: str) -> dict:
	"""
	Cancel a scheduled email.

	Args:
		mail_queue_name: Name of the Mail Queue document

	Returns:
		dict with success status and message
	"""
	mail_queue_name = _sanitize_input(cstr(mail_queue_name).strip())
	
	_validate_user_permissions()
	
	try:
		doc = frappe.get_doc("Mail Queue", mail_queue_name)
	except frappe.DoesNotExistError:
		raise SchedulerValidationError(_("Scheduled email not found"))
	
	doc.check_permission(permtype="write")

	# Verify ownership
	if doc.user != frappe.session.user:
		is_admin = "System Manager" in frappe.get_roles(frappe.session.user)
		if not is_admin:
			raise SchedulerSecurityError(_("You do not have permission to cancel this email"))

	# Check if email is actually scheduled
	scheduled_at = doc.get("scheduled_at")
	if not scheduled_at:
		raise SchedulerValidationError(_("This email is not scheduled"))

	# Check if already sent
	if doc.status in ["Sent", "Delivered"]:
		raise SchedulerValidationError(_("Cannot cancel an email that has already been sent"))

	# Check if past schedule time
	if get_datetime(scheduled_at) <= now_datetime():
		raise SchedulerValidationError(_("Cannot cancel an email past its scheduled time"))

	_log_scheduler_event("cancel_attempt", {
		"mail_queue": mail_queue_name,
		"scheduled_at": str(scheduled_at),
	})

	# Try to cancel via JMAP
	submission_id = doc.get("submission_id")
	jmap_cancelled = False
	
	if submission_id:
		try:
			from mail_scheduler.jmap.futurerelease import email_submission_cancel
			email_submission_cancel(doc.user, submission_id)
			jmap_cancelled = True
		except Exception as e:
			frappe.log_error(
				message=f"Failed to cancel JMAP submission: {e}",
				title="Mail Scheduler JMAP Cancel Error"
			)

	# Update the document
	doc.db_set({
		"status": "Cancelled",
		"scheduled_at": None,
		"submission_id": None,
		"error_message": "Cancelled by user",
	})

	_log_scheduler_event("cancel_success", {
		"mail_queue": mail_queue_name,
		"jmap_cancelled": jmap_cancelled,
	})

	return {
		"success": True,
		"message": _("Scheduled email cancelled successfully"),
		"jmap_cancelled": jmap_cancelled,
	}


@frappe.whitelist()
@rate_limit(limit=30, seconds=60)
def reschedule_mail(mail_queue_name: str, new_scheduled_at: str) -> dict:
	"""
	Reschedule a scheduled email to a new time.

	Args:
		mail_queue_name: Name of the Mail Queue document
		new_scheduled_at: New datetime string for scheduled delivery

	Returns:
		dict with success status and new schedule time
	"""
	mail_queue_name = _sanitize_input(cstr(mail_queue_name).strip())
	new_scheduled_at = _sanitize_input(cstr(new_scheduled_at).strip())
	
	_validate_user_permissions()
	_validate_schedule_time(new_scheduled_at)

	try:
		doc = frappe.get_doc("Mail Queue", mail_queue_name)
	except frappe.DoesNotExistError:
		raise SchedulerValidationError(_("Scheduled email not found"))
	
	doc.check_permission(permtype="write")

	# Verify ownership
	if doc.user != frappe.session.user:
		is_admin = "System Manager" in frappe.get_roles(frappe.session.user)
		if not is_admin:
			raise SchedulerSecurityError(_("You do not have permission to reschedule this email"))

	# Check if email is actually scheduled
	old_scheduled_at = doc.get("scheduled_at")
	if not old_scheduled_at:
		raise SchedulerValidationError(_("This email is not scheduled"))

	# Check if already sent
	if doc.status in ["Sent", "Delivered"]:
		raise SchedulerValidationError(_("Cannot reschedule an email that has already been sent"))

	_log_scheduler_event("reschedule_attempt", {
		"mail_queue": mail_queue_name,
		"old_scheduled_at": str(old_scheduled_at),
		"new_scheduled_at": new_scheduled_at,
	})

	# Cancel existing submission
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
		
		_log_scheduler_event("reschedule_success", {
			"mail_queue": mail_queue_name,
			"new_scheduled_at": new_scheduled_at,
		})
		
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
		page_length: Number of results to return (max 100)
		start: Offset for pagination
		status: Filter by status

	Returns:
		List of scheduled email dicts
	"""
	_validate_user_permissions()
	
	# Sanitize and limit pagination
	page_length = min(cint(page_length) or 20, 100)
	start = max(cint(start) or 0, 0)
	
	filters = {
		"user": frappe.session.user,
		"scheduled_at": ["is", "set"],
	}

	if status:
		filters["status"] = _sanitize_input(cstr(status))

	scheduled_mails = frappe.get_all(
		"Mail Queue",
		filters=filters,
		fields=[
			"name",
			"subject",
			"from_email",
			"scheduled_at",
			"status",
			"creation",
		],
		order_by="scheduled_at asc",
		start=start,
		page_length=page_length,
	)

	return scheduled_mails


def get_max_schedule_days() -> int:
	"""Get the maximum number of days an email can be scheduled in advance."""
	return MAX_SCHEDULE_DAYS
