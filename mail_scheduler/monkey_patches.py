# type: ignore
"""
Monkey Patches for Mail Scheduler - Enterprise Grade

This module applies runtime patches to the mail app's JMAPClient to add
FUTURERELEASE support for scheduled email delivery.

Features:
- Thread-safe patching
- Comprehensive error handling
- Detailed logging for debugging
- Graceful fallback on errors
- Request context validation
"""

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime
import threading
from functools import wraps
from typing import Any, Callable

# Thread-safe patch state
_patch_lock = threading.Lock()
_original_email_create = None
_patch_applied = False


def _get_logger():
	"""Get or create the mail scheduler logger."""
	return frappe.logger("mail_scheduler", allow_site=True, file_count=10)


def _log_debug(message: str) -> None:
	"""Log debug message."""
	_get_logger().debug(f"[PATCH] {message}")


def _log_info(message: str) -> None:
	"""Log info message."""
	_get_logger().info(f"[PATCH] {message}")


def _log_error(message: str, exc: Exception = None) -> None:
	"""Log error message with optional exception."""
	logger = _get_logger()
	if exc:
		logger.error(f"[PATCH] {message}", exc_info=exc)
	else:
		logger.error(f"[PATCH] {message}")


def apply_patches() -> bool:
	"""
	Apply all monkey patches for mail scheduler.
	
	This function is idempotent and thread-safe.
	
	Returns:
		True if patches were applied successfully, False otherwise
	"""
	global _patch_applied
	
	with _patch_lock:
		if _patch_applied:
			_log_debug("Patches already applied, skipping")
			return True
		
		try:
			_log_info("Applying mail scheduler monkey patches...")
			success = _patch_jmap_client_email_create()
			
			if success:
				_patch_applied = True
				_log_info("Monkey patches applied successfully")
			else:
				_log_error("Failed to apply monkey patches")
			
			return success
			
		except Exception as e:
			_log_error(f"Error applying patches: {e}", exc=e)
			return False


def _patch_jmap_client_email_create() -> bool:
	"""
	Patch JMAPClient.email_create to add HOLDUNTIL parameter for scheduled emails.
	
	Returns:
		True if patch was applied successfully
	"""
	global _original_email_create

	try:
		from mail.jmap import JMAPClient
	except ImportError as e:
		_log_error(f"Could not import JMAPClient: {e}")
		return False

	if _original_email_create is not None:
		_log_debug("JMAPClient.email_create already patched")
		return True

	# Store original method
	_original_email_create = JMAPClient.email_create

	def patched_email_create(
		self,
		creation_id,
		from_email,
		recipients,
		from_name=None,
		subject=None,
		sent_at=None,
		message_id=None,
		reply_to=None,
		in_reply_to=None,
		headers=None,
		text_body=None,
		html_body=None,
		attachments=None,
		raw_message=None,
		existing_id=None,
		save_as_draft=False,
		priority=0,
		destroy_after_submit=False,
		forwarded_id=None,
		reply_to_id=None,
	):
		"""
		Patched email_create that adds HOLDUNTIL for scheduled emails.
		"""
		scheduled_at = None
		
		try:
			scheduled_at = frappe.flags.get("mail_scheduler_scheduled_at")
		except Exception:
			pass  # No frappe context, proceed normally
		
		# If not scheduled or saving as draft, use original method
		if not scheduled_at or save_as_draft:
			_log_debug(f"Using original email_create (scheduled_at={scheduled_at}, save_as_draft={save_as_draft})")
			return _original_email_create(
				self, creation_id, from_email, recipients, from_name, subject,
				sent_at, message_id, reply_to, in_reply_to, headers, text_body,
				html_body, attachments, raw_message, existing_id, save_as_draft,
				priority, destroy_after_submit, forwarded_id, reply_to_id,
			)

		# Validate scheduled time
		try:
			schedule_dt = get_datetime(scheduled_at)
			if schedule_dt <= now_datetime():
				_log_error(f"Scheduled time {scheduled_at} is in the past, sending immediately")
				return _original_email_create(
					self, creation_id, from_email, recipients, from_name, subject,
					sent_at, message_id, reply_to, in_reply_to, headers, text_body,
					html_body, attachments, raw_message, existing_id, save_as_draft,
					priority, destroy_after_submit, forwarded_id, reply_to_id,
				)
		except Exception as e:
			_log_error(f"Invalid scheduled_at value: {e}", exc=e)
			return _original_email_create(
				self, creation_id, from_email, recipients, from_name, subject,
				sent_at, message_id, reply_to, in_reply_to, headers, text_body,
				html_body, attachments, raw_message, existing_id, save_as_draft,
				priority, destroy_after_submit, forwarded_id, reply_to_id,
			)

		# Use scheduled email creation
		_log_info(f"Creating scheduled email with HOLDUNTIL={scheduled_at}")
		
		try:
			return _email_create_with_schedule(
				self, creation_id, from_email, recipients, from_name, subject,
				sent_at, message_id, reply_to, in_reply_to, headers, text_body,
				html_body, attachments, raw_message, existing_id, priority,
				destroy_after_submit, forwarded_id, reply_to_id, scheduled_at,
			)
		except Exception as e:
			_log_error(f"Scheduled email creation failed, falling back to immediate send: {e}", exc=e)
			# Fallback to immediate send on error
			return _original_email_create(
				self, creation_id, from_email, recipients, from_name, subject,
				sent_at, message_id, reply_to, in_reply_to, headers, text_body,
				html_body, attachments, raw_message, existing_id, save_as_draft,
				priority, destroy_after_submit, forwarded_id, reply_to_id,
			)

	# Apply patch
	JMAPClient.email_create = patched_email_create
	_log_debug("JMAPClient.email_create patched successfully")
	return True


def _email_create_with_schedule(
	client,
	creation_id,
	from_email,
	recipients,
	from_name,
	subject,
	sent_at,
	message_id,
	reply_to,
	in_reply_to,
	headers,
	text_body,
	html_body,
	attachments,
	raw_message,
	existing_id,
	priority,
	destroy_after_submit,
	forwarded_id,
	reply_to_id,
	scheduled_at,
):
	"""
	Create and submit email with HOLDUNTIL for scheduled delivery.
	
	This is a modified version of JMAPClient.email_create that adds
	the HOLDUNTIL parameter to the envelope for FUTURERELEASE support.
	"""
	from typing import Literal
	from mail import __version__
	from mail.utils.dt import convert_to_utc

	# Calculate HOLDUNTIL timestamp (Unix epoch seconds)
	schedule_dt = get_datetime(scheduled_at)
	holduntil = int(schedule_dt.timestamp())
	
	_log_info(f"Building scheduled submission: HOLDUNTIL={holduntil} ({schedule_dt})")

	# HELPERS
	def filter_recipients(kind: Literal["to", "cc", "bcc"]) -> list[dict[str, str | None]]:
		return [
			{"name": r.get("name", r.get("display_name", "")), "email": r["email"]}
			for r in recipients
			if r["type"].lower() == kind
		]

	def build_draft_payload(draft_mbox: str) -> dict:
		payload = {
			"mailboxIds": {draft_mbox: True},
			"keywords": {"$draft": True, "$seen": True},
			"from": [{"name": from_name or "", "email": from_email}],
		}

		for kind in ("to", "cc", "bcc"):
			if rcpts := filter_recipients(kind):
				payload[kind] = rcpts

		if subject:
			payload["subject"] = subject

		# Set sentAt to scheduled time for proper display
		send_time = convert_to_utc(sent_at) if sent_at else convert_to_utc(frappe.utils.now_datetime())
		
		payload.update({
			"sentAt": send_time.isoformat(),
			"header:Message-ID": f"<{message_id}>" if message_id else f"<{creation_id}@mail>",
			"header:User-Agent": f"Frappe Mail v{__version__} (Frappe v{frappe.__version__})",
			"header:X-Mailer": "Frappe Mail",
			"header:X-Mail-Queue": str(creation_id),
			"header:X-Mail-Scheduled": str(holduntil),  # Custom header for tracking
		})

		if reply_to:
			payload["header:Reply-To"] = ", ".join(
				f'"{r.get("name", r.get("display_name", ""))}" <{r["email"]}>' for r in reply_to
			)

		if in_reply_to:
			payload["header:In-Reply-To"] = f"<{in_reply_to}>"

		if headers:
			for k, v in headers.items():
				payload[f"header:{k}"] = str(v)

		# Body parts
		body_parts = []
		if text_body:
			body_parts.append({"type": "text/plain", "partId": "text"})
		if html_body:
			body_parts.append({"type": "text/html", "partId": "html"})

		if body_parts:
			payload["bodyStructure"] = (
				{"type": "multipart/alternative", "subParts": body_parts}
				if len(body_parts) > 1
				else body_parts[0]
			)
			payload["bodyValues"] = {}
			if text_body:
				payload["bodyValues"]["text"] = {"value": text_body, "isEncodingProblem": False}
			if html_body:
				payload["bodyValues"]["html"] = {"value": html_body, "isEncodingProblem": False}

		# Attachments
		if attachments:
			atts = []
			for a in attachments:
				att = {
					"blobId": a["blob_id"],
					"type": a.get("type", "application/octet-stream"),
					"name": a.get("filename", "attachment"),
				}
				if a.get("disposition") == "inline" and a.get("cid"):
					att["disposition"] = "inline"
					att["cid"] = a["cid"]
				else:
					att["disposition"] = "attachment"
				atts.append(att)

			if "bodyStructure" in payload:
				payload["bodyStructure"] = {
					"type": "multipart/mixed",
					"subParts": [payload["bodyStructure"]] + [
						{
							"type": a["type"],
							"blobId": a["blobId"],
							"name": a.get("name"),
							"disposition": a.get("disposition", "attachment")
						}
						for a in atts
					],
				}
			else:
				payload["attachments"] = atts

		return payload

	# Get required IDs with error handling
	try:
		identity_id = client.get_identity_id_by_email(from_email, raise_exception=True)
	except Exception as e:
		_log_error(f"Failed to get identity for {from_email}: {e}")
		raise

	try:
		draft_mailbox_id = client.get_mailbox_id_by_role(
			"drafts", create_if_not_exists=True, raise_exception=True
		)
		sent_mailbox_id = client.get_mailbox_id_by_role(
			"sent", create_if_not_exists=True, raise_exception=True
		)
	except Exception as e:
		_log_error(f"Failed to get mailbox IDs: {e}")
		raise

	using = ["urn:ietf:params:jmap:mail"]
	method_calls = []
	call_id = 0

	draft_ref = f"draft-{creation_id}"
	submit_ref = f"submit-{creation_id}"

	# STEP 1 — CREATE DRAFT
	if raw_message:
		try:
			blob = client.upload_blob(raw_message.encode("utf-8"), content_type="message/rfc822")
		except Exception as e:
			_log_error(f"Failed to upload raw message blob: {e}")
			raise
			
		method_calls.append([
			"Email/import",
			{
				"accountId": client.primary_account_id,
				"emails": {
					draft_ref: {
						"blobId": blob["blobId"],
						"mailboxIds": {draft_mailbox_id: True},
						"keywords": {"$draft": True, "$seen": True},
					}
				},
			},
			str(call_id),
		])
		call_id += 1

		if existing_id:
			method_calls.append([
				"Email/set",
				{
					"accountId": client.primary_account_id,
					"destroy": [existing_id],
				},
				str(call_id),
			])
			call_id += 1
	else:
		method_calls.append([
			"Email/set",
			{
				"accountId": client.primary_account_id,
				"create": {draft_ref: build_draft_payload(draft_mailbox_id)},
				"destroy": [existing_id] if existing_id else None,
			},
			str(call_id),
		])
		call_id += 1

	# STEP 2 — SUBMIT EMAIL WITH HOLDUNTIL
	using.append("urn:ietf:params:jmap:submission")

	# Build envelope with HOLDUNTIL for scheduled delivery
	# FUTURERELEASE extension RFC 4865
	submission = {
		"identityId": identity_id,
		"emailId": f"#{draft_ref}",
		"envelope": {
			"mailFrom": {
				"email": from_email,
				"parameters": {
					"RET": "FULL",
					"ENVID": str(creation_id),
					"MT-PRIORITY": str(priority),
					"HOLDUNTIL": str(holduntil),  # FUTURERELEASE parameter
				},
			},
			"rcptTo": [
				{
					"email": rcpt,
					"parameters": {
						"NOTIFY": "DELAY,FAILURE",
						"ORCPT": f"rfc822;{rcpt}",
					},
				}
				for rcpt in sorted({r["email"] for r in recipients})
			],
		},
	}

	submit_call = [
		"EmailSubmission/set",
		{
			"accountId": client.primary_account_id,
			"create": {submit_ref: submission},
		},
		str(call_id),
	]

	# STEP 3 — SUCCESS UPDATES
	updates = {}

	if destroy_after_submit:
		submit_call[1]["onSuccessDestroyEmail"] = [f"#{submit_ref}"]
	else:
		updates[f"#{submit_ref}"] = {
			f"mailboxIds/{draft_mailbox_id}": None,
			f"mailboxIds/{sent_mailbox_id}": True,
			"keywords/$draft": None,
			"keywords/$seen": True,
		}

	# Forward/reply keywords
	for id_val, keyword in [(forwarded_id, "$forwarded"), (reply_to_id, "$answered")]:
		if id_val:
			updates.setdefault(id_val, {})[f"keywords/{keyword}"] = True

	if updates:
		submit_call[1]["onSuccessUpdateEmail"] = updates

	method_calls.append(submit_call)

	# Execute JMAP request
	_log_debug(f"Executing JMAP request with {len(method_calls)} method calls")
	
	try:
		result = client._make_request(using=using, method_calls=method_calls)
		_log_info(f"Scheduled email submission successful for creation_id={creation_id}")
		return result
	except Exception as e:
		_log_error(f"JMAP request failed: {e}", exc=e)
		raise


def remove_patches() -> bool:
	"""
	Remove all applied monkey patches (for testing/cleanup).
	
	Returns:
		True if patches were removed successfully
	"""
	global _original_email_create, _patch_applied
	
	with _patch_lock:
		if not _patch_applied:
			return True
		
		try:
			from mail.jmap import JMAPClient
			
			if _original_email_create is not None:
				JMAPClient.email_create = _original_email_create
				_original_email_create = None
			
			_patch_applied = False
			_log_info("Monkey patches removed successfully")
			return True
			
		except Exception as e:
			_log_error(f"Error removing patches: {e}", exc=e)
			return False


def is_patched() -> bool:
	"""Check if patches are currently applied."""
	return _patch_applied
