#!/usr/bin/env python3
"""
Swap primary and alias email for sumber.mn user via Stalwart backend API directly
"""
import json
import frappe

def swap_emails_via_backend():
    """Swap pm@sumber.mn and batkhuyag@sumber.mn via direct backend API"""
    from mail.backend import get_mail_backend_api
    from mail.server.doctype.mail_principal_binding.mail_principal_binding import update_principal_binding
    from mail.jmap import invalidate_jmap_cache
    
    tenant_id = "ohggpe5p7d"  # Sumber tenant
    old_primary = "pm@sumber.mn"
    new_primary = "batkhuyag@sumber.mn"
    cluster = "mailserver.icloud.mn"
    
    print(f"=== Swapping Emails ===")
    print(f"Old primary: {old_primary}")
    print(f"New primary: {new_primary}")
    
    # Get backend API
    backend = get_mail_backend_api("Mail Cluster", cluster)
    
    # Step 1: Fetch current principal
    response = backend.request("GET", f"/api/principal/{old_primary}")
    principal_data = response.json()
    print(f"\nCurrent principal data:")
    print(json.dumps(principal_data, indent=2))
    
    if principal_data.get("error"):
        print(f"Error fetching principal: {principal_data}")
        return {"success": False, "error": principal_data.get("error")}
    
    data = principal_data["data"]
    
    # Step 2: Rename principal in Stalwart via PATCH
    # Stalwart supports renaming via the "name" field
    actions = [
        {"action": "set", "field": "name", "value": new_primary},
        # Remove old email, add new one
        {"action": "removeItem", "field": "emails", "value": new_primary},
        {"action": "addItem", "field": "emails", "value": old_primary},
    ]
    
    print(f"\nSending PATCH request with actions:")
    print(json.dumps(actions, indent=2))
    
    response = backend.request("PATCH", f"/api/principal/{old_primary}", data=json.dumps(actions))
    result = response.json()
    print(f"\nPATCH response:")
    print(json.dumps(result, indent=2))
    
    if result.get("error"):
        print(f"Error updating principal: {result}")
        return {"success": False, "error": result.get("error")}
    
    # Step 3: Update Frappe binding to point to new name
    update_principal_binding(old_primary, principal_name=new_primary)
    
    # Step 4: Invalidate JMAP cache
    invalidate_jmap_cache(new_primary)
    
    print(f"\n=== Success! ===")
    print(f"Primary email is now: {new_primary}")
    print(f"Alias: {old_primary}")
    
    return {"success": True, "primary": new_primary, "alias": old_primary}

if __name__ == "__main__":
    swap_emails_via_backend()
