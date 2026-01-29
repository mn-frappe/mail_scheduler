"""
Boot Session for Mail Scheduler

Provides configuration to the frontend.
"""

import frappe


def boot_session(bootinfo):
	"""Add mail scheduler config to boot info."""
	from mail_scheduler.jmap.futurerelease import get_max_schedule_days

	bootinfo.mail_scheduler = {
		"enabled": True,
		"max_schedule_days": get_max_schedule_days(),
	}
