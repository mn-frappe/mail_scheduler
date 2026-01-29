"""
Mail Scheduler API - Extended Mail API with Scheduled Send Support

This module provides API endpoints that wrap the mail app's API
to add scheduled email functionality without modifying the core app.
"""

import frappe
from frappe import _


@frappe.whitelist()
def create_mail(
	from_: str,
	to: str | list,
	cc: str | list | None = None,
	bcc: str | list | None = None,
	subject: str = "",
	text_body: str | None = None,
	html_body: str | None = None,
	attachments: list | None = None,
	reply_to: str | None = None,
	in_reply_to: str | None = None,
	references: str | list | None = None,
	custom_headers: dict | None = None,
	save_as_draft: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Create and send/schedule an email.

	This wraps the mail app's create_mail API and adds scheduled_at support.

	Args:
		from_: Sender email address
		to: Recipient(s) - string or list
		cc: CC recipient(s)
		bcc: BCC recipient(s)
		subject: Email subject
		text_body: Plain text body
		html_body: HTML body
		attachments: List of attachment dicts
		reply_to: Reply-To address
		in_reply_to: Message-ID being replied to
		references: Referenced Message-IDs
		custom_headers: Additional email headers
		save_as_draft: If True, save as draft instead of sending
		scheduled_at: Datetime string for scheduled delivery (local time)

	Returns:
		dict with mail_message name and scheduled_at if scheduled
	"""
	from mail.api.mail import get_or_create_mail_message, validate_mail_data

	# Parse recipients
	to = _parse_recipients(to)
	cc = _parse_recipients(cc) if cc else []
	bcc = _parse_recipients(bcc) if bcc else []
	references = _parse_recipients(references) if references else []

	# Validate mail data
	validate_mail_data(from_, to, cc, bcc, subject, text_body, html_body)

	# If scheduled, validate schedule time
	if scheduled_at and not save_as_draft:
		_validate_schedule_time(scheduled_at)

	# Get or create mail message
	mail_message = get_or_create_mail_message(
		from_=from_,
		to=to,
		cc=cc,
		bcc=bcc,
		subject=subject,
		text_body=text_body,
		html_body=html_body,
		attachments=attachments,
		reply_to=reply_to,
		in_reply_to=in_reply_to,
		references=references,
		custom_headers=custom_headers,
	)

	result = {"mail_message": mail_message.name}

	if save_as_draft:
		mail_message.save_as_draft()
	else:
		# Submit with optional scheduling
		mail_message.submit(scheduled_at=scheduled_at)
		if scheduled_at:
			result["scheduled_at"] = scheduled_at
			result["status"] = "Scheduled"

	return result


@frappe.whitelist()
def update_draft_mail(
	mail_message_name: str,
	from_: str | None = None,
	to: str | list | None = None,
	cc: str | list | None = None,
	bcc: str | list | None = None,
	subject: str | None = None,
	text_body: str | None = None,
	html_body: str | None = None,
	attachments: list | None = None,
	reply_to: str | None = None,
	custom_headers: dict | None = None,
	send: bool = False,
	scheduled_at: str | None = None,
) -> dict:
	"""
	Update a draft email and optionally send/schedule it.

	Args:
		mail_message_name: Name of the Mail Message document
		from_: Updated sender address
		to: Updated recipient(s)
		cc: Updated CC recipient(s)
		bcc: Updated BCC recipient(s)
		subject: Updated subject
		text_body: Updated plain text body
		html_body: Updated HTML body
		attachments: Updated attachments
		reply_to: Updated Reply-To
		custom_headers: Updated custom headers
		send: If True, send/schedule the email
		scheduled_at: Datetime string for scheduled delivery

	Returns:
		dict with mail_message name and scheduled_at if scheduled
	"""
	from mail.api.mail import validate_mail_data

	mail_message = frappe.get_doc("Mail Message", mail_message_name)

	# Check ownership
	if mail_message.owner != frappe.session.user:
		frappe.throw(_("You don't have permission to update this draft"))

	# Parse recipients
	to = _parse_recipients(to) if to else None
	cc = _parse_recipients(cc) if cc else None
	bcc = _parse_recipients(bcc) if bcc else None

	# Update fields if provided
	if from_ is not None:
		mail_message.sender = from_
	if to is not None:
		mail_message.recipients = to
	if cc is not None:
		mail_message.cc = cc
	if bcc is not None:
		mail_message.bcc = bcc
	if subject is not None:
		mail_message.subject = subject
	if text_body is not None:
		mail_message.text_body = text_body
	if html_body is not None:
		mail_message.html_body = html_body
	if reply_to is not None:
		mail_message.reply_to = reply_to
	if custom_headers is not None:
		mail_message.custom_headers = custom_headers

	# Handle attachments
	if attachments is not None:
		mail_message.update_attachments(attachments)

	result = {"mail_message": mail_message.name}

	if send:
		# Validate before sending
		validate_mail_data(
			mail_message.sender,
			mail_message.recipients,
			mail_message.cc,
			mail_message.bcc,
			mail_message.subject,
			mail_message.text_body,
			mail_message.html_body,
		)

		if scheduled_at:
			_validate_schedule_time(scheduled_at)

		mail_message.submit(scheduled_at=scheduled_at)
		if scheduled_at:
			result["scheduled_at"] = scheduled_at
			result["status"] = "Scheduled"
	else:
		mail_message.save()

	return result


@frappe.whitelist()
def cancel_scheduled_mail(mail_queue_name: str) -> dict:
	"""
	Cancel a scheduled email that hasn't been sent yet.

	Args:
		mail_queue_name: Name of the Mail Queue document

	Returns:
		dict with status and message
	"""
	mail_queue = frappe.get_doc("Mail Queue", mail_queue_name)

	# Check ownership
	if mail_queue.user != frappe.session.user:
		frappe.throw(_("You don't have permission to cancel this email"))

	# Check if it's a scheduled email
	scheduled_at = mail_queue.get("scheduled_at")
	if not scheduled_at:
		frappe.throw(_("This email is not scheduled"))

	# Check status
	if mail_queue.status not in ("Scheduled", "Queued", "Pending"):
		frappe.throw(_("Cannot cancel: Email status is {0}").format(mail_queue.status))

	# Cancel the scheduled email
	cancel_scheduled_email(mail_queue)

	return {
		"status": "Cancelled",
		"message": _("Scheduled email has been cancelled"),
	}


@frappe.whitelist()
def update_scheduled_mail(mail_queue_name: str, new_scheduled_at: str) -> dict:
	"""
	Update the scheduled time for a pending scheduled email.

	Args:
		mail_queue_name: Name of the Mail Queue document
		new_scheduled_at: New scheduled datetime string

	Returns:
		dict with status and new scheduled time
	"""
	mail_queue = frappe.get_doc("Mail Queue", mail_queue_name)

	# Check ownership
	if mail_queue.user != frappe.session.user:
		frappe.throw(_("You don't have permission to update this email"))

	# Validate new schedule time
	_validate_schedule_time(new_scheduled_at)

	# Check if it's a scheduled email
	scheduled_at = mail_queue.get("scheduled_at")
	if not scheduled_at:
		frappe.throw(_("This email is not scheduled"))

	# Check status
	if mail_queue.status not in ("Scheduled", "Queued", "Pending"):
		frappe.throw(_("Cannot update: Email status is {0}").format(mail_queue.status))

	# Update the scheduled time
	update_scheduled_time(mail_queue, new_scheduled_at)

	return {
		"status": "Updated",
		"scheduled_at": new_scheduled_at,
		"message": _("Scheduled time has been updated"),
	}


@frappe.whitelist()
def get_scheduled_mails(limit: int = 20, offset: int = 0) -> dict:
	"""
	Get list of scheduled emails for the current user.

	Args:
		limit: Maximum number of results
		offset: Offset for pagination

	Returns:
		dict with list of scheduled emails and total count
	"""
	filters = {
		"user": frappe.session.user,
		"scheduled_at": ["is", "set"],
		"status": ["in", ["Scheduled", "Queued", "Pending"]],
	}

	total = frappe.db.count("Mail Queue", filters)

	emails = frappe.get_all(
		"Mail Queue",
		filters=filters,
		fields=["name", "subject", "recipients", "scheduled_at", "status", "creation"],
		order_by="scheduled_at asc",
		limit=limit,
		start=offset,
	)

	return {
		"emails": emails,
		"total": total,
	}


def cancel_scheduled_email(mail_queue) -> None:
	"""
	Cancel a scheduled email submission in Stalwart.

	Args:
		mail_queue: Mail Queue document
	"""
	from mail_scheduler.jmap.futurerelease import (
		email_submission_cancel,
		get_jmap_client,
	)

	submission_id = mail_queue.get("submission_id")
	if not submission_id:
		# No submission yet, just update status
		mail_queue.db_set("status", "Cancelled")
		return

	try:
		client = get_jmap_client(mail_queue.user)
		response = email_submission_cancel(client, submission_id)

		updated = response["methodResponses"][0][1].get("updated", {})
		if submission_id in updated:
			mail_queue.db_set("status", "Cancelled")

			# Optionally move email back to drafts
			try:
				draft_mailbox_id = client.get_mailbox_id_by_role("drafts", create_if_not_exists=True)
				client.email_update([mail_queue.id], mailbox_id=draft_mailbox_id)
			except Exception:
				pass  # Not critical if move fails
		else:
			error = response["methodResponses"][0][1].get("notUpdated", {}).get(submission_id, {})
			frappe.throw(_("Failed to cancel: {0}").format(error.get("description", "Unknown error")))

	except Exception as e:
		frappe.log_error(_("Failed to cancel scheduled email"), frappe.get_traceback(with_context=True))
		frappe.throw(_("Failed to cancel scheduled email: {0}").format(str(e)))


def update_scheduled_time(mail_queue, new_scheduled_at: str) -> None:
	"""
	Update the scheduled time for a pending email.

	Tries direct HOLDUNTIL update first, falls back to cancel+resubmit.

	Args:
		mail_queue: Mail Queue document
		new_scheduled_at: New scheduled datetime string
	"""
	from mail_scheduler.jmap.futurerelease import (
		email_submission_cancel,
		email_submission_get,
		email_submission_update_schedule,
		get_jmap_client,
	)

	submission_id = mail_queue.get("submission_id")
	if not submission_id:
		# No submission yet, just update the field
		mail_queue.db_set("scheduled_at", new_scheduled_at)
		return

	try:
		client = get_jmap_client(mail_queue.user)

		# Check if submission is still pending
		status_response = email_submission_get(client, [submission_id])
		submissions = status_response["methodResponses"][0][1].get("list", [])

		if not submissions:
			frappe.throw(_("Scheduled email not found. It may have already been sent."))

		submission = submissions[0]
		if submission.get("undoStatus") != "pending":
			frappe.throw(_("Cannot update: Email has already been {0}.").format(
				submission.get("undoStatus", "processed")
			))

		# Try direct update
		response = email_submission_update_schedule(client, submission_id, new_scheduled_at)
		updated = response["methodResponses"][0][1].get("updated", {})

		if submission_id in updated:
			mail_queue.db_set("scheduled_at", new_scheduled_at)
		else:
			# Fall back to cancel and resubmit
			_reschedule_email(mail_queue, new_scheduled_at, client)

	except frappe.ValidationError:
		raise
	except Exception as e:
		frappe.log_error(_("Failed to update scheduled email"), frappe.get_traceback(with_context=True))
		frappe.throw(_("Failed to update scheduled email: {0}").format(str(e)))


def _reschedule_email(mail_queue, new_scheduled_at: str, client) -> None:
	"""
	Reschedule email by cancelling and resubmitting.

	Args:
		mail_queue: Mail Queue document
		new_scheduled_at: New scheduled datetime
		client: JMAP client instance
	"""
	from mail_scheduler.jmap.futurerelease import email_submission_cancel

	submission_id = mail_queue.get("submission_id")

	# Cancel existing submission
	cancel_response = email_submission_cancel(client, submission_id)
	updated = cancel_response["methodResponses"][0][1].get("updated", {})

	if submission_id not in updated:
		error = cancel_response["methodResponses"][0][1].get("notUpdated", {}).get(submission_id, {})
		frappe.throw(_("Failed to cancel existing schedule: {0}").format(
			error.get("description", "Unknown error")
		))

	# Resubmit with new schedule
	mail_queue.scheduled_at = new_scheduled_at
	mail_queue._process()


def _parse_recipients(recipients) -> list:
	"""Parse recipients string or list to list."""
	if isinstance(recipients, str):
		return [r.strip() for r in recipients.split(",") if r.strip()]
	elif isinstance(recipients, list):
		return recipients
	return []


def _validate_schedule_time(scheduled_at: str) -> None:
	"""Validate scheduled time is within allowed range."""
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
