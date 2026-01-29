#!/usr/bin/env python3
"""
Check email submission status
"""

import frappe
import json

def check_submission_status(submission_id="p"):
    """Check the status of an email submission"""
    from mail.jmap import get_jmap_client
    
    user = "admin@frappe.mn"
    frappe.set_user(user)
    
    client = get_jmap_client(user)
    
    print(f"=== Checking Submission Status ===")
    print(f"Submission ID: {submission_id}")
    
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
    
    print(f"\n=== Response ===")
    print(json.dumps(response, indent=2))
    
    submissions = response.get("methodResponses", [[]])[0][1].get("list", [])
    if submissions:
        submission = submissions[0]
        print(f"\n=== Submission Details ===")
        print(f"ID: {submission.get('id')}")
        print(f"Undo Status: {submission.get('undoStatus')}")
        print(f"Delivery Status: {submission.get('deliveryStatus')}")
        print(f"Send At: {submission.get('sendAt')}")
    
    return {"success": True, "submissions": submissions}

if __name__ == "__main__":
    check_submission_status()
