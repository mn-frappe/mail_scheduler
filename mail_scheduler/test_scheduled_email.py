#!/usr/bin/env python3
"""
Battle test: Send a scheduled email using mail_scheduler
"""

import frappe
from datetime import datetime, timedelta

def test_scheduled_email():
    """Test sending a scheduled email"""
    from mail_scheduler.api.mail import create_mail
    
    user = "admin@frappe.mn"
    frappe.set_user(user)
    
    # Schedule for 5 minutes from now
    schedule_time = datetime.now() + timedelta(minutes=5)
    
    print(f"=== Scheduled Email Test ===")
    print(f"User: {user}")
    print(f"Scheduled for: {schedule_time}")
    
    try:
        result = create_mail(
            from_email="admin@frappe.mn",
            to=["test@icloud.mn"],
            cc=[],
            bcc=[],
            subject=f"[TEST] Scheduled Email Test - {schedule_time.strftime('%Y-%m-%d %H:%M:%S')}",
            html_body="<p>This is a test scheduled email from mail_scheduler addon.</p><p>It should arrive after the scheduled time.</p>",
            from_name="Mail Scheduler Test",
            attachments=None,
            in_reply_to=None,
            in_reply_to_id=None,
            forwarded_from_id=None,
            save_as_draft=False,
            scheduled_at=schedule_time.isoformat()
        )
        
        print(f"\n=== Result ===")
        print(f"ID: {result.get('id')}")
        print(f"Status: {result.get('status')}")
        print(f"Scheduled At: {result.get('scheduled_at')}")
        if result.get('error'):
            print(f"Error: {result.get('error')}")
        
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    test_scheduled_email()
