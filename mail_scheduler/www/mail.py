"""
Mail page handler for Mail Scheduler

This extends the mail app's mail page to include the scheduler script.
"""

import frappe
from frappe import _

no_cache = 1


def get_context():
    """Get context for the mail page, extending the original mail app's context."""
    frappe.db.commit()
    context = frappe._dict()
    context.boot = get_boot()
    return context


def get_boot():
    """Get boot data including mail scheduler configuration."""
    from mail_scheduler.jmap.futurerelease import get_max_schedule_days
    
    return frappe._dict(
        {
            "site_name": frappe.local.site,
            "csrf_token": frappe.sessions.get_csrf_token(),
            "push_relay_server_url": frappe.conf.get("push_relay_server_url") or "",
            # Mail scheduler configuration
            "mail_scheduler": {
                "enabled": True,
                "max_schedule_days": get_max_schedule_days(),
                "min_schedule_minutes": 1,
            },
        }
    )
