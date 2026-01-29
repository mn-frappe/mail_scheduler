# type: ignore
"""
JMAP FUTURERELEASE Extension for Stalwart Mail Server

This module provides JMAP methods for scheduled email delivery using the
FUTURERELEASE extension (RFC 4865). It wraps the mail app's JMAP client
to add scheduling capabilities without modifying the core mail app.

Stalwart Configuration:
- maxDelayedSend: 2592000 (30 days in seconds)
- HOLDUNTIL parameter accepts Unix timestamp
"""

import frappe
from frappe import _


def get_jmap_client(user: str | None = None):
	"""Get JMAP client from mail app."""
	from mail.jmap import get_jmap_client as _get_jmap_client
	return _get_jmap_client(user)


def email_create_scheduled(
	client,
	mailbox_id: str,
	from_: str,
	to: list[str],
	cc: list[str] | None = None,
	bcc: list[str] | None = None,
	subject: str = "",
	text_body: str | None = None,
	html_body: str | None = None,
	attachments: list[dict] | None = None,
	in_reply_to: str | None = None,
	references: list[str] | None = None,
	message_id: str | None = None,
	scheduled_at: str | None = None,
	custom_headers: dict | None = None,
) -> dict:
	"""
	Create and submit an email with optional FUTURERELEASE scheduling.

	This is a wrapper around the mail app's email_create that adds
	HOLDUNTIL parameter support for scheduled delivery.

	Args:
		client: JMAP client instance
		mailbox_id: Target mailbox ID
		from_: Sender email address
		to: List of recipient email addresses
		cc: Optional CC recipients
		bcc: Optional BCC recipients
		subject: Email subject
		text_body: Plain text body
		html_body: HTML body
		attachments: List of attachment dicts
		in_reply_to: Message-ID being replied to
		references: List of referenced Message-IDs
		message_id: Custom Message-ID (auto-generated if not provided)
		scheduled_at: Datetime string for scheduled delivery (local time)
		custom_headers: Additional email headers

	Returns:
		JMAP response dict with emailId and submissionId
	"""
	from frappe.utils import get_datetime

	# Build the email object
	email_obj = _build_email_object(
		mailbox_id=mailbox_id,
		from_=from_,
		to=to,
		cc=cc,
		bcc=bcc,
		subject=subject,
		text_body=text_body,
		html_body=html_body,
		attachments=attachments,
		in_reply_to=in_reply_to,
		references=references,
		message_id=message_id,
		custom_headers=custom_headers,
	)

	# Build envelope with optional HOLDUNTIL
	envelope = {
		"mailFrom": {"email": from_},
		"rcptTo": [{"email": addr} for addr in (to or []) + (cc or []) + (bcc or [])],
	}

	if scheduled_at:
		scheduled_datetime = get_datetime(scheduled_at)
		# Stalwart expects Unix timestamp for HOLDUNTIL
		hold_until = str(int(scheduled_datetime.timestamp()))
		envelope["mailFrom"]["parameters"] = {"HOLDUNTIL": hold_until}

	# Create email and submit in a single request
	return client._make_request(
		using=[
			"urn:ietf:params:jmap:core",
			"urn:ietf:params:jmap:mail",
			"urn:ietf:params:jmap:submission",
		],
		method_calls=[
			[
				"Email/set",
				{
					"accountId": client.primary_account_id,
					"create": {"draft": email_obj},
				},
				"0",
			],
			[
				"EmailSubmission/set",
				{
					"accountId": client.primary_account_id,
					"create": {
						"submission": {
							"emailId": "#draft",
							"identityId": client.get_identity_id(from_),
							"envelope": envelope,
						}
					},
				},
				"1",
			],
		],
	)


def email_submission_cancel(client, submission_id: str) -> dict:
	"""
	Cancel a pending scheduled email submission.

	Uses JMAP EmailSubmission/set with onSuccessDestroyEmail to cancel
	a FUTURERELEASE submission that hasn't been sent yet.

	Args:
		client: JMAP client instance
		submission_id: The email submission ID to cancel

	Returns:
		JMAP response dict
	"""
	return client._make_request(
		using=["urn:ietf:params:jmap:submission"],
		method_calls=[
			[
				"EmailSubmission/set",
				{
					"accountId": client.primary_account_id,
					"update": {
						submission_id: {
							"undoStatus": "canceled",
						}
					},
				},
				"0",
			],
		],
	)


def email_submission_get(client, submission_ids: list[str]) -> dict:
	"""
	Get email submission details including undoStatus.

	Args:
		client: JMAP client instance
		submission_ids: List of submission IDs to retrieve

	Returns:
		JMAP response dict with submission details
	"""
	return client._make_request(
		using=["urn:ietf:params:jmap:submission"],
		method_calls=[
			[
				"EmailSubmission/get",
				{
					"accountId": client.primary_account_id,
					"ids": submission_ids,
					"properties": ["id", "emailId", "undoStatus", "sendAt", "envelope"],
				},
				"0",
			],
		],
	)


def email_submission_update_schedule(client, submission_id: str, scheduled_at: str) -> dict:
	"""
	Update the scheduled send time for a pending email submission.

	Uses JMAP FUTURERELEASE extension to update the HOLDUNTIL parameter.
	Note: This only works if undoStatus is still 'pending'.

	Args:
		client: JMAP client instance
		submission_id: The email submission ID
		scheduled_at: New scheduled datetime string

	Returns:
		JMAP response dict
	"""
	from frappe.utils import get_datetime

	scheduled_datetime = get_datetime(scheduled_at)
	hold_until = str(int(scheduled_datetime.timestamp()))

	return client._make_request(
		using=["urn:ietf:params:jmap:submission"],
		method_calls=[
			[
				"EmailSubmission/set",
				{
					"accountId": client.primary_account_id,
					"update": {
						submission_id: {
							"envelope/mailFrom/parameters/HOLDUNTIL": hold_until,
						}
					},
				},
				"0",
			],
		],
	)


def _build_email_object(
	mailbox_id: str,
	from_: str,
	to: list[str],
	cc: list[str] | None = None,
	bcc: list[str] | None = None,
	subject: str = "",
	text_body: str | None = None,
	html_body: str | None = None,
	attachments: list[dict] | None = None,
	in_reply_to: str | None = None,
	references: list[str] | None = None,
	message_id: str | None = None,
	custom_headers: dict | None = None,
) -> dict:
	"""Build JMAP Email object."""
	import uuid

	from frappe.utils import now_datetime

	if not message_id:
		domain = from_.split("@")[1] if "@" in from_ else "localhost"
		message_id = f"<{uuid.uuid4()}@{domain}>"

	email_obj = {
		"mailboxIds": {mailbox_id: True},
		"from": [{"email": from_}],
		"to": [{"email": addr} for addr in (to or [])],
		"subject": subject,
		"messageId": [message_id],
		"sentAt": now_datetime().strftime("%Y-%m-%dT%H:%M:%SZ"),
	}

	if cc:
		email_obj["cc"] = [{"email": addr} for addr in cc]

	if bcc:
		email_obj["bcc"] = [{"email": addr} for addr in bcc]

	if in_reply_to:
		email_obj["inReplyTo"] = [in_reply_to]

	if references:
		email_obj["references"] = references

	if custom_headers:
		email_obj["header:X-Custom-Headers:asText"] = str(custom_headers)

	# Build body parts
	body_values = {}
	body_structure = None

	if html_body and text_body:
		body_values["text"] = {"value": text_body, "charset": "utf-8"}
		body_values["html"] = {"value": html_body, "charset": "utf-8"}
		body_structure = {
			"type": "multipart/alternative",
			"subParts": [
				{"partId": "text", "type": "text/plain"},
				{"partId": "html", "type": "text/html"},
			],
		}
	elif html_body:
		body_values["html"] = {"value": html_body, "charset": "utf-8"}
		body_structure = {"partId": "html", "type": "text/html"}
	elif text_body:
		body_values["text"] = {"value": text_body, "charset": "utf-8"}
		body_structure = {"partId": "text", "type": "text/plain"}

	if attachments:
		# Handle attachments
		attachment_parts = []
		for i, att in enumerate(attachments):
			att_id = f"att{i}"
			body_values[att_id] = {
				"value": att.get("content", ""),
				"charset": "utf-8",
			}
			attachment_parts.append({
				"partId": att_id,
				"type": att.get("content_type", "application/octet-stream"),
				"disposition": "attachment",
				"name": att.get("filename", f"attachment{i}"),
			})

		if body_structure:
			body_structure = {
				"type": "multipart/mixed",
				"subParts": [body_structure, *attachment_parts],
			}

	email_obj["bodyValues"] = body_values
	if body_structure:
		email_obj["bodyStructure"] = body_structure

	return email_obj


def get_max_schedule_seconds() -> int:
	"""
	Get maximum schedule delay in seconds from Stalwart config.

	Default is 30 days (2592000 seconds) per Stalwart's maxDelayedSend.
	"""
	return frappe.conf.get("stalwart_max_delayed_send", 2592000)


def get_max_schedule_days() -> int:
	"""Get maximum schedule delay in days."""
	return get_max_schedule_seconds() // 86400
