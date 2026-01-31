# Mail Scheduler Hooks
# Addon for Frappe Mail - Scheduled Email Send Feature
# https://github.com/frappe/mail

app_name = "mail_scheduler"
app_title = "Mail Scheduler"
app_publisher = "Digital Consulting Service LLC"
app_description = "Scheduled Email Send addon for Frappe Mail using JMAP FUTURERELEASE"
app_email = "dev@frappe.mn"
app_license = "agpl-3.0"
app_version = "1.0.0"

# Required Apps
required_apps = ["frappe", "mail"]

# Fixtures - Export custom fields
fixtures = [
{
"dt": "Custom Field",
"filters": [["module", "=", "Mail Scheduler"]],
}
]

# Document Events
doc_events = {
"Mail Queue": {
"before_insert": "mail_scheduler.overrides.mail_queue.before_insert",
"validate": "mail_scheduler.overrides.mail_queue.validate",
}
}

# Override Whitelisted Methods
override_whitelisted_methods = {
# Override mail API to add scheduled_at support
"mail.api.mail.create_mail": "mail_scheduler.api.mail.create_mail",
"mail.api.mail.update_draft_mail": "mail_scheduler.api.mail.update_draft_mail",
}

# Jinja Environment Customizations
jenv = {
"methods": [
"mail_scheduler.utils.get_max_schedule_days:get_max_schedule_days",
]
}

# Scheduler Events
scheduler_events = {
"cron": {
# Check for sent scheduled emails every 5 minutes
"*/5 * * * *": [
"mail_scheduler.tasks.check_scheduled_emails_status",
],
}
}

# Boot Session - provide config to frontend
boot_session = "mail_scheduler.boot.boot_session"

# Include frontend bundles
# The main bundle handles integration with mail app
# Frappe's build system will automatically resolve the hashed filename
app_include_js = "/assets/mail_scheduler/dist/js/mail_scheduler.bundle.js"

# Monkey patches applied on app startup
after_app_load = "mail_scheduler.monkey_patches.apply_patches"
