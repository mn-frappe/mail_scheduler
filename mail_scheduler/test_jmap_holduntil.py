#!/usr/bin/env python3
"""
Test JMAP call with HOLDUNTIL to verify Stalwart accepts it
"""

import frappe
from datetime import datetime, timedelta

def test_jmap_with_holduntil():
    """Test JMAP EmailSubmission with HOLDUNTIL parameter"""
    from mail.jmap import get_jmap_client
    import json
    
    user = "admin@frappe.mn"
    frappe.set_user(user)
    
    client = get_jmap_client(user)
    
    # Get required IDs
    identity_id = client.get_identity_id_by_email("admin@frappe.mn", raise_exception=True)
    draft_mailbox_id = client.get_mailbox_id_by_role("drafts", create_if_not_exists=True, raise_exception=True)
    sent_mailbox_id = client.get_mailbox_id_by_role("sent", create_if_not_exists=True, raise_exception=True)
    
    # Schedule for 10 minutes from now
    schedule_time = datetime.now() + timedelta(minutes=10)
    holduntil = int(schedule_time.timestamp())
    
    print(f"=== JMAP HOLDUNTIL Test ===")
    print(f"User: {user}")
    print(f"Scheduled for: {schedule_time}")
    print(f"HOLDUNTIL timestamp: {holduntil}")
    
    creation_id = f"test-holduntil-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    draft_ref = f"draft-{creation_id}"
    submit_ref = f"submit-{creation_id}"
    
    # Build draft payload
    draft_payload = {
        "mailboxIds": {draft_mailbox_id: True},
        "keywords": {"$draft": True, "$seen": True},
        "from": [{"name": "HOLDUNTIL Test", "email": "admin@frappe.mn"}],
        "to": [{"name": "Test", "email": "test@icloud.mn"}],
        "subject": f"[HOLDUNTIL TEST] Scheduled for {schedule_time.strftime('%H:%M:%S')}",
        "bodyStructure": {"type": "text/plain", "partId": "text"},
        "bodyValues": {"text": {"value": f"This email was scheduled for {schedule_time} using HOLDUNTIL={holduntil}", "isEncodingProblem": False}},
        "header:Message-ID": f"<{creation_id}@test>",
    }
    
    # Build submission with HOLDUNTIL
    submission = {
        "identityId": identity_id,
        "emailId": f"#{draft_ref}",
        "envelope": {
            "mailFrom": {
                "email": "admin@frappe.mn",
                "parameters": {
                    "RET": "FULL",
                    "ENVID": creation_id,
                    "HOLDUNTIL": str(holduntil),  # FUTURERELEASE parameter
                },
            },
            "rcptTo": [
                {
                    "email": "test@icloud.mn",
                    "parameters": {"NOTIFY": "DELAY,FAILURE"},
                }
            ],
        },
    }
    
    print(f"\n=== Submission envelope ===")
    print(json.dumps(submission["envelope"], indent=2))
    
    method_calls = [
        # Create draft
        [
            "Email/set",
            {
                "accountId": client.primary_account_id,
                "create": {draft_ref: draft_payload},
            },
            "0",
        ],
        # Submit with HOLDUNTIL
        [
            "EmailSubmission/set",
            {
                "accountId": client.primary_account_id,
                "create": {submit_ref: submission},
                "onSuccessUpdateEmail": {
                    f"#{submit_ref}": {
                        f"mailboxIds/{draft_mailbox_id}": None,
                        f"mailboxIds/{sent_mailbox_id}": True,
                        "keywords/$draft": None,
                        "keywords/$seen": True,
                    }
                },
            },
            "1",
        ],
    ]
    
    try:
        response = client._make_request(
            using=["urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
            method_calls=method_calls
        )
        
        print(f"\n=== JMAP Response ===")
        print(json.dumps(response, indent=2))
        
        # Check for errors
        for method_response in response.get("methodResponses", []):
            method_name, result, call_id = method_response
            if "notCreated" in result:
                print(f"\n!!! Error in {method_name}: {result['notCreated']}")
            if "created" in result:
                print(f"\n=== Created in {method_name} ===")
                for ref, data in result["created"].items():
                    print(f"  {ref}: {data}")
        
        return {"success": True, "response": response}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    test_jmap_with_holduntil()
