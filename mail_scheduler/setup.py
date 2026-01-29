# type: ignore
"""
Setup and installation utilities for Mail Scheduler
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def after_install():
	"""Run after app installation."""
	create_mail_queue_custom_fields()


def create_mail_queue_custom_fields():
	"""Create custom fields for Mail Queue doctype."""
	custom_fields = {
		"Mail Queue": [
			{
				"fieldname": "scheduled_at",
				"fieldtype": "Datetime",
				"label": "Scheduled At",
				"insert_after": "status",
				"description": "When this email is scheduled to be sent",
				"in_list_view": 1,
				"in_standard_filter": 1,
				"search_index": 1,
			},
			{
				"fieldname": "submission_id",
				"fieldtype": "Data",
				"label": "Submission ID",
				"insert_after": "scheduled_at",
				"description": "JMAP EmailSubmission ID for scheduled emails",
				"read_only": 1,
				"hidden": 1,
			},
		]
	}

	create_custom_fields(custom_fields)
	frappe.db.commit()
