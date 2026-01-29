#!/usr/bin/env python3
"""
Deep test of JMAP session and capabilities
"""

import frappe
import json

def test_jmap_session():
    """Test JMAP session structure"""
    from mail.jmap import get_jmap_client
    
    user = "admin@frappe.mn"
    print(f"Testing with user: {user}")
    
    try:
        client = get_jmap_client(user)
        
        print(f"\n=== Session Info ===")
        print(f"Primary Account ID: {client.primary_account_id}")
        
        print(f"\n=== Accounts ===")
        for acc_id, acc in client.accounts.items():
            print(f"\nAccount: {acc_id}")
            print(json.dumps(acc, indent=2))
        
        print(f"\n=== Session Capabilities ===")
        if hasattr(client, 'capabilities'):
            print(json.dumps(client.capabilities, indent=2))
        
        return {"success": True}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    test_jmap_session()
