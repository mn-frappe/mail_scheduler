# type: ignore
"""
Monkey Patches for Mail Scheduler

This module applies runtime patches to the mail app to add scheduled
sending functionality without modifying the core app files.

Applied patches:
1. MailMessage.submit() - Add scheduled_at parameter support
2. MailQueue._process() - Add FUTURERELEASE envelope parameter
3. MailQueue._create() - Store scheduled_at and submission_id
"""

import frappe
from frappe import _

_patches_applied = False


def apply_patches():
	"""Apply monkey patches on app load."""
	global _patches_applied

	if _patches_applied:
		return

	try:
		_patch_mail_message_submit()
		_patch_mail_queue_process()
		_patch_mail_queue_create()
		_patches_applied = True
		frappe.logger().info("Mail Scheduler patches applied successfully")
	except Exception as e:
		frappe.logger().error(f"Failed to apply Mail Scheduler patches: {e}")


def _patch_mail_message_submit():
	"""
	Patch MailMessage.submit() to accept scheduled_at parameter.

	The patched method passes scheduled_at to _update_or_submit_draft()
	which then sets frappe.flags for Mail Queue to pick up.
	"""
	try:
		from mail.client.doctype.mail_message.mail_message import MailMessage
	except ImportError:
		return

	original_submit = MailMessage.submit

	def patched_submit(self, scheduled_at: str | None = None):
		"""Submit mail message with optional scheduling."""
		# Store scheduled_at in flags for Mail Queue
		if scheduled_at:
			frappe.flags.mail_scheduler_scheduled_at = scheduled_at

		try:
			# Call original submit
			result = original_submit(self)

			# If scheduled, update status
			if scheduled_at and hasattr(self, "mail_queue_name"):
				mail_queue = frappe.get_doc("Mail Queue", self.mail_queue_name)
				if hasattr(mail_queue, "scheduled_at"):
					mail_queue.db_set({
						"scheduled_at": scheduled_at,
						"status": "Scheduled",
					})

			return result
		finally:
			# Clean up flags
			frappe.flags.pop("mail_scheduler_scheduled_at", None)

	MailMessage.submit = patched_submit


def _patch_mail_queue_process():
	"""
	Patch MailQueue._process() to add HOLDUNTIL envelope parameter.

	When scheduled_at is set, the patched method adds the FUTURERELEASE
	HOLDUNTIL parameter to the email submission envelope.
	"""
	try:
		from mail.client.doctype.mail_queue.mail_queue import MailQueue
	except ImportError:
		return

	original_process = MailQueue._process

	def patched_process(self):
		"""Process mail queue with optional scheduling."""
		scheduled_at = getattr(self, "scheduled_at", None)

		if not scheduled_at:
			# No scheduling, use original method
			return original_process(self)

		# Custom processing with FUTURERELEASE
		return _process_scheduled_email(self, scheduled_at)

	MailQueue._process = patched_process


def _patch_mail_queue_create():
	"""
	Patch MailQueue._create() to store submission_id.

	The submission_id is needed to cancel or update scheduled emails.
	"""
	try:
		from mail.client.doctype.mail_queue.mail_queue import MailQueue
	except ImportError:
		return

	# Store original _create if it exists
	if hasattr(MailQueue, "_create"):
		original_create = MailQueue._create

		def patched_create(self, *args, **kwargs):
			result = original_create(self, *args, **kwargs)

			# Try to extract and store submission_id from result
			if isinstance(result, dict):
				_extract_and_store_submission_id(self, result)

			return result

		MailQueue._create = patched_create


def _process_scheduled_email(mail_queue, scheduled_at: str):
	"""
	Process a scheduled email using JMAP FUTURERELEASE.

	Args:
		mail_queue: Mail Queue document
		scheduled_at: Scheduled datetime string
	"""
	from mail_scheduler.jmap.futurerelease import (
		email_create_scheduled,
		get_jmap_client,
	)

	try:
		client = get_jmap_client(mail_queue.user)

		# Get mailbox IDs
		sent_mailbox_id = client.get_mailbox_id_by_role("sent", create_if_not_exists=True)

		# Build recipient lists
		to_list = [r.strip() for r in (mail_queue.recipients or "").split(",") if r.strip()]
		cc_list = [r.strip() for r in (mail_queue.cc or "").split(",") if r.strip()] if mail_queue.cc else []
		bcc_list = [r.strip() for r in (mail_queue.bcc or "").split(",") if r.strip()] if mail_queue.bcc else []

		# Create and submit scheduled email
		response = email_create_scheduled(
			client=client,
			mailbox_id=sent_mailbox_id,
			from_=mail_queue.sender,
			to=to_list,
			cc=cc_list,
			bcc=bcc_list,
			subject=mail_queue.subject or "",
			text_body=mail_queue.text_body,
			html_body=mail_queue.html_body,
			scheduled_at=scheduled_at,
			message_id=mail_queue.message_id,
			in_reply_to=mail_queue.in_reply_to,
			references=mail_queue.references.split(",") if mail_queue.references else None,
		)

		# Extract submission ID and email ID from response
		submission_id = None
		email_id = None

		for method_response in response.get("methodResponses", []):
			method_name = method_response[0]
			result = method_response[1]

			if method_name == "Email/set":
				created = result.get("created", {})
				if "draft" in created:
					email_id = created["draft"].get("id")

			elif method_name == "EmailSubmission/set":
				created = result.get("created", {})
				if "submission" in created:
					submission_id = created["submission"].get("id")

		# Update mail queue with results
		updates = {"status": "Scheduled"}
		if submission_id:
			updates["submission_id"] = submission_id
		if email_id:
			updates["jmap_email_id"] = email_id

		mail_queue.db_set(updates)

		frappe.db.commit()

	except Exception as e:
		mail_queue.db_set({
			"status": "Error",
			"error_message": str(e)[:500],
		})
		frappe.log_error(
			_("Failed to process scheduled email"),
			frappe.get_traceback(with_context=True)
		)
		raise


def _extract_and_store_submission_id(mail_queue, response: dict):
	"""Extract submission_id from JMAP response and store it."""
	try:
		for method_response in response.get("methodResponses", []):
			method_name = method_response[0]
			result = method_response[1]

			if method_name == "EmailSubmission/set":
				created = result.get("created", {})
				for _key, value in created.items():
					if "id" in value:
						mail_queue.db_set("submission_id", value["id"])
						return
	except Exception:
		pass  # Non-critical
