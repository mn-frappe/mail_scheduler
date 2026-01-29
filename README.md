# Mail Scheduler

**Scheduled Email Send addon for Frappe Mail**

This app adds "Send Later" functionality to [Frappe Mail](https://github.com/frappe/mail) using the JMAP FUTURERELEASE extension (RFC 4865) supported by Stalwart Mail Server.

## Features

- ⏰ **Schedule emails** up to 30 days in advance
- 🚫 **Cancel scheduled emails** before they're sent
- 📝 **Update schedule time** for pending emails
- 📋 **View scheduled emails** list
- 🔄 **Automatic status updates** via background jobs
- 🎨 **Frontend integration** with Frappe Mail's compose interface

## Requirements

- Frappe Framework v16+
- Frappe Mail app
- Stalwart Mail Server with JMAP FUTURERELEASE support

## Installation

```bash
# Get the app
bench get-app https://github.com/your-org/mail_scheduler

# Install on your site
bench --site your-site.local install-app mail_scheduler

# Run migrations to create custom fields
bench --site your-site.local migrate
```

## Configuration

### Stalwart Server

Ensure your Stalwart server has FUTURERELEASE enabled:

```toml
[session.extensions]
future-release = "30d"  # Maximum delay (30 days)
```

### Frappe Site Config (optional)

```json
{
  "stalwart_max_delayed_send": 2592000
}
```

## API Reference

### Schedule an Email

```python
result = frappe.call(
    "mail_scheduler.api.mail.create_mail",
    from_="sender@example.com",
    to="recipient@example.com",
    subject="Scheduled Email",
    html_body="<p>This will be sent later!</p>",
    scheduled_at="2024-01-15 09:00:00"
)
```

### Cancel Scheduled Email

```python
result = frappe.call(
    "mail_scheduler.api.mail.cancel_scheduled_mail",
    mail_queue_name="MAIL-QUEUE-00001"
)
```

### Update Schedule Time

```python
result = frappe.call(
    "mail_scheduler.api.mail.update_scheduled_mail",
    mail_queue_name="MAIL-QUEUE-00001",
    new_scheduled_at="2024-01-16 10:00:00"
)
```

## How It Works

1. Uses Stalwart's native JMAP FUTURERELEASE via HOLDUNTIL parameter
2. No background workers needed - Stalwart handles delivery timing
3. Adds custom fields to Mail Queue via Frappe's Custom Field system
4. Extends mail app via monkey patches without modifying core files

## License

GNU Affero General Public License v3.0
