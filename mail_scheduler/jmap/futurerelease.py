# type: ignore
"""
JMAP FUTURERELEASE Extension for Stalwart Mail Server

This module provides the core JMAP integration for scheduled email delivery
using the FUTURERELEASE extension (RFC 4865).

Stalwart supports:
- HOLDUNTIL: Unix timestamp for when to release the email
- HOLDFOR: Number of seconds to delay (relative)
- maxDelayedSend: 2592000 seconds (30 days)

The HOLDUNTIL parameter is added to envelope.mailFrom.parameters in the
EmailSubmission/set JMAP call.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime


def get_holduntil_timestamp(scheduled_at) -> int:
	"""
	Convert a datetime to Unix timestamp for HOLDUNTIL parameter.

	Args:
		scheduled_at: datetime object or string

	Returns:
		Unix timestamp as integer
	"""
	dt = get_datetime(scheduled_at)
	return int(dt.timestamp())


def build_scheduled_envelope(
	from_email: str,
	recipients: list[dict],
	creation_id: str,
	priority: int = 0,
	scheduled_at=None,
) -> dict:
	"""
	Build an envelope dict with FUTURERELEASE parameters for scheduled delivery.

	This creates the envelope structure needed for EmailSubmission/set with
	the HOLDUNTIL parameter for scheduled delivery.

	Args:
		from_email: Sender email address
		recipients: List of recipient dicts with 'email' key
		creation_id: Unique ID for this submission
		priority: MT-PRIORITY value (-4 to 4)
		scheduled_at: datetime for scheduled delivery (None for immediate)

	Returns:
		dict: Envelope structure for JMAP EmailSubmission
	"""
	# Build mailFrom parameters
	mail_from_params = {
		"RET": "FULL",
		"ENVID": creation_id,
		"MT-PRIORITY": str(priority),
	}

	# Add HOLDUNTIL for scheduled delivery
	if scheduled_at:
		holduntil = get_holduntil_timestamp(scheduled_at)
		mail_from_params["HOLDUNTIL"] = str(holduntil)

	envelope = {
		"mailFrom": {
			"email": from_email,
			"parameters": mail_from_params,
		},
		"rcptTo": [
			{
				"email": rcpt["email"] if isinstance(rcpt, dict) else rcpt,
				"parameters": {
					"NOTIFY": "DELAY,FAILURE",
					"ORCPT": f"rfc822;{rcpt['email'] if isinstance(rcpt, dict) else rcpt}",
				},
			}
			for rcpt in recipients
		],
	}

	return envelope


def email_submission_cancel(user: str, submission_id: str) -> dict:
	"""
	Cancel a scheduled email submission.

	Uses EmailSubmission/set with update to set undoStatus to "canceled".

	Args:
		user: User who owns the submission
		submission_id: JMAP submission ID

	Returns:
		dict: JMAP response
	"""
	from mail.jmap import get_jmap_client

	client = get_jmap_client(user)

	response = client._make_request(
		using=["urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
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
			]
		],
	)

	return response


def email_submission_get(user: str, submission_id: str) -> dict | None:
	"""
	Get details of an email submission.

	Args:
		user: User who owns the submission
		submission_id: JMAP submission ID

	Returns:
		dict: Submission details or None if not found
	"""
	from mail.jmap import get_jmap_client

	client = get_jmap_client(user)

	response = client._make_request(
		using=["urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
		method_calls=[
			[
				"EmailSubmission/get",
				{
					"accountId": client.primary_account_id,
					"ids": [submission_id],
				},
				"0",
			]
		],
	)

	submissions = response.get("methodResponses", [[]])[0][1].get("list", [])
	return submissions[0] if submissions else None


def get_submission_capabilities(user: str) -> dict:
	"""
	Get the submission capabilities for a user's JMAP account.

	This includes maxDelayedSend and supported extensions.

	Args:
		user: User to check capabilities for

	Returns:
		dict: Submission capabilities
	"""
	from mail.jmap import get_jmap_client

	client = get_jmap_client(user)

	# Get account-level capabilities
	account_id = client.primary_account_id
	account = client.accounts.get(account_id, {})

	# Capabilities are in accountCapabilities
	account_caps = account.get("accountCapabilities", {})
	return account_caps.get("urn:ietf:params:jmap:submission", {})


def get_max_delayed_send(user: str) -> int:
	"""
	Get the maximum delay (in seconds) for scheduled email delivery.

	Args:
		user: User to check for

	Returns:
		int: Maximum delay in seconds (default 2592000 = 30 days)
	"""
	try:
		caps = get_submission_capabilities(user)
		return caps.get("maxDelayedSend", 2592000)
	except Exception:
		return 2592000  # Default to 30 days


def get_max_schedule_days() -> int:
	"""
	Get the maximum number of days an email can be scheduled in advance.

	Returns:
		int: Maximum days (30 based on Stalwart default)
	"""
	return 30


def get_max_schedule_seconds() -> int:
	"""
	Get the maximum number of seconds an email can be scheduled in advance.

	Returns:
		int: Maximum seconds (2592000 = 30 days based on Stalwart default)
	"""
	return 2592000


def is_futurerelease_supported(user: str) -> bool:
	"""
	Check if FUTURERELEASE extension is supported for the user.

	Args:
		user: User to check for

	Returns:
		bool: True if FUTURERELEASE is supported
	"""
	try:
		caps = get_submission_capabilities(user)
		extensions = caps.get("submissionExtensions", {})
		return "FUTURERELEASE" in extensions
	except Exception:
		return False
