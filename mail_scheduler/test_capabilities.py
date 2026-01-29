#!/usr/bin/env python3
"""
Test mail_scheduler JMAP FUTURERELEASE integration
"""

import frappe

def test_capabilities():
    """Test JMAP FUTURERELEASE capabilities"""
    from mail_scheduler.jmap.futurerelease import (
        is_futurerelease_supported,
        get_submission_capabilities,
    )
    
    user = "admin@frappe.mn"
    print(f"Testing with user: {user}")
    
    try:
        caps = get_submission_capabilities(user)
        print(f"\n=== JMAP Submission Capabilities ===")
        print(f"maxDelayedSend: {caps.get('maxDelayedSend', 'not found')}")
        print(f"submissionExtensions: {caps.get('submissionExtensions', 'not found')}")
        
        supported = is_futurerelease_supported(user)
        print(f"\nFUTURERELEASE supported: {supported}")
        
        return {
            "success": True,
            "caps": caps,
            "supported": supported
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    test_capabilities()
