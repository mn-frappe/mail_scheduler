# type: ignore
"""
Monkey Patches for Mail Scheduler

This module applies runtime patches to the mail app's JMAPClient to add
FUTURERELEASE support for scheduled email delivery.

The key patch modifies email_create() to add HOLDUNTIL parameter to the
envelope when frappe.flags.mail_scheduler_scheduled_at is set.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime


_original_email_create = None


def apply_patches():
	"""
	Apply all monkey patches for mail scheduler.

	This should be called on app boot (in hooks.py boot_session).
	"""
	_patch_jmap_client_email_create()


def _patch_jmap_client_email_create():
	"""
	Patch JMAPClient.email_create to add HOLDUNTIL parameter for scheduled emails.

	When frappe.flags.mail_scheduler_scheduled_at is set, we add the HOLDUNTIL
	parameter to the envelope.mailFrom.parameters in the submission.
	"""
	global _original_email_create

	try:
		from mail.jmap import JMAPClient
	except ImportError:
		return

	if _original_email_create is not None:
		# Already patched
		return

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

		If frappe.flags.mail_scheduler_scheduled_at is set, we intercept the
		JMAP call to add HOLDUNTIL to the envelope parameters.
		"""
		scheduled_at = frappe.flags.get("mail_scheduler_scheduled_at")

		# If not scheduled or saving as draft, use original method
		if not scheduled_at or save_as_draft:
			return _original_email_create(
				self,
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
				save_as_draft,
				priority,
				destroy_after_submit,
				forwarded_id,
				reply_to_id,
			)

		# For scheduled emails, we need to build the request ourselves
		# to add HOLDUNTIL to the envelope
		return _email_create_with_schedule(
			self,
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
		)

	JMAPClient.email_create = patched_email_create


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

	# Calculate HOLDUNTIL timestamp
	holduntil = int(get_datetime(scheduled_at).timestamp())

	# HELPERS (same as original)
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

		payload.update(
			{
				"sentAt": convert_to_utc(sent_at).isoformat() if sent_at else convert_to_utc(frappe.utils.now_datetime()).isoformat(),
				"header:Message-ID": f"<{message_id}>" if message_id else f"<{creation_id}@mail>",
				"header:User-Agent": f"Frappe Mail v{__version__} (Frappe v{frappe.__version__})",
				"header:X-Mailer": "Frappe Mail",
				"header:X-Mail-Queue": str(creation_id),
			}
		)

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
						{"type": a["type"], "blobId": a["blobId"], "name": a.get("name"), "disposition": a.get("disposition", "attachment")}
						for a in atts
					],
				}
			else:
				payload["attachments"] = atts

		return payload

	# Get required IDs
	identity_id = client.get_identity_id_by_email(from_email, raise_exception=True)
	draft_mailbox_id = client.get_mailbox_id_by_role(
		"drafts", create_if_not_exists=True, raise_exception=True
	)
	sent_mailbox_id = client.get_mailbox_id_by_role(
		"sent", create_if_not_exists=True, raise_exception=True
	)

	using = ["urn:ietf:params:jmap:mail"]
	method_calls = []
	call_id = 0

	draft_ref = f"draft-{creation_id}"
	submit_ref = f"submit-{creation_id}"

	# STEP 1 — CREATE DRAFT
	if raw_message:
		blob = client.upload_blob(raw_message.encode("utf-8"), content_type="message/rfc822")
		method_calls.append(
			[
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
			]
		)
		call_id += 1

		if existing_id:
			method_calls.append(
				[
					"Email/set",
					{
						"accountId": client.primary_account_id,
						"destroy": [existing_id],
					},
					str(call_id),
				]
			)
			call_id += 1
	else:
		method_calls.append(
			[
				"Email/set",
				{
					"accountId": client.primary_account_id,
					"create": {draft_ref: build_draft_payload(draft_mailbox_id)},
					"destroy": [existing_id] if existing_id else None,
				},
				str(call_id),
			]
		)
		call_id += 1

	# STEP 2 — SUBMIT EMAIL WITH HOLDUNTIL
	using.append("urn:ietf:params:jmap:submission")

	# Build envelope with HOLDUNTIL for scheduled delivery
	submission = {
		"identityId": identity_id,
		"emailId": f"#{draft_ref}",
		"envelope": {
			"mailFrom": {
				"email": from_email,
				"parameters": {
					"RET": "FULL",
					"ENVID": creation_id,
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
	for id, keyword in [(forwarded_id, "$forwarded"), (reply_to_id, "$answered")]:
		if id:
			updates.setdefault(id, {})[f"keywords/{keyword}"] = True

	if updates:
		submit_call[1]["onSuccessUpdateEmail"] = updates

	method_calls.append(submit_call)

	return client._make_request(using=using, method_calls=method_calls)
