# Type stubs for mail.client.doctype.mail_queue.mail_queue
from typing import Any

class MailQueue:
    name: str
    user: str
    status: str
    scheduled_at: str | None
    submission_id: str | None
    sender: str
    recipients: str
    cc: str | None
    bcc: str | None
    subject: str
    text_body: str | None
    html_body: str | None
    message_id: str | None
    in_reply_to: str | None
    references: str | None
    
    def db_set(self, field: str | dict, value: Any = None, **kwargs: Any) -> None: ...
    def _process(self) -> Any: ...
    def _create(self, *args: Any, **kwargs: Any) -> Any: ...
    def get(self, field: str) -> Any: ...
