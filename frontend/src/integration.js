/**
 * Mail Scheduler Integration
 * 
 * This module handles the runtime integration with Frappe Mail's Vue frontend.
 * It patches the compose toolbar to add the schedule button.
 */

import { createApp, h } from 'vue'
import ScheduleButton from './components/ScheduleButton.vue'

// Configuration from Frappe boot
const getConfig = () => {
  if (typeof frappe !== 'undefined' && frappe.boot?.mail_scheduler) {
    return frappe.boot.mail_scheduler
  }
  return {
    enabled: true,
    max_schedule_days: 30
  }
}

/**
 * Initialize the mail scheduler integration
 */
export function initMailScheduler() {
  const config = getConfig()
  
  if (!config.enabled) {
    console.log('Mail Scheduler: Disabled by configuration')
    return
  }

  console.log('Mail Scheduler: Initializing...')
  
  // Add global styles
  addStyles()
  
  // Set up mutation observer to detect compose toolbar
  observeComposeToolbar()
  
  // Expose API
  exposeApi(config)
}

/**
 * Add custom CSS styles
 */
function addStyles() {
  const style = document.createElement('style')
  style.id = 'mail-scheduler-styles'
  style.textContent = `
    .mail-scheduler-button {
      display: inline-flex;
    }
    
    .mail-scheduler-scheduled-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--yellow-100, #fef9c3);
      color: var(--yellow-700, #a16207);
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
    }
    
    .mail-scheduler-scheduled-badge svg {
      width: 12px;
      height: 12px;
    }
    
    /* Scheduled folder icon */
    .sidebar-item[data-mailbox="scheduled"] .sidebar-item-icon {
      color: var(--yellow-600, #ca8a04);
    }
  `
  
  if (!document.getElementById('mail-scheduler-styles')) {
    document.head.appendChild(style)
  }
}

/**
 * Observe DOM for compose toolbar appearance
 */
function observeComposeToolbar() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Look for compose toolbar
          const toolbar = node.querySelector?.('[class*="ComposeMailToolbar"]') ||
                         (node.className?.includes?.('ComposeMailToolbar') ? node : null)
          
          if (toolbar) {
            injectScheduleButton(toolbar)
          }
          
          // Also check for send button container
          const sendContainer = node.querySelector?.('.ml-auto.flex.items-center.space-x-2')
          if (sendContainer && !sendContainer.querySelector('.mail-scheduler-button')) {
            injectScheduleButton(sendContainer)
          }
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })
  
  // Also check immediately
  setTimeout(checkExistingToolbar, 1000)
}

/**
 * Check for existing toolbar on page
 */
function checkExistingToolbar() {
  const sendButtons = document.querySelectorAll('button')
  for (const btn of sendButtons) {
    if (btn.textContent?.includes('Send') && !btn.textContent?.includes('Schedule')) {
      const container = btn.parentElement
      if (container && !container.querySelector('.mail-scheduler-button')) {
        injectScheduleButton(container)
      }
    }
  }
}

/**
 * Inject schedule button into toolbar
 */
function injectScheduleButton(container) {
  // Find the Send button
  const sendButton = container.querySelector('button[class*="solid"]') ||
                     Array.from(container.querySelectorAll('button'))
                       .find(btn => btn.textContent?.trim() === 'Send')
  
  if (!sendButton) return
  
  // Check if already injected
  if (container.querySelector('.mail-scheduler-button')) return
  
  // Create mount point
  const mountPoint = document.createElement('div')
  mountPoint.className = 'mail-scheduler-button'
  
  // Insert before Send button
  sendButton.parentNode.insertBefore(mountPoint, sendButton)
  
  // Mount Vue component
  const config = getConfig()
  
  const app = createApp({
    render() {
      return h(ScheduleButton, {
        maxDays: config.max_schedule_days,
        disabled: false,
        onSchedule: (scheduledAt) => {
          // Store scheduled time for when send is triggered
          window.mailSchedulerPendingSchedule = scheduledAt
          
          // Trigger the send action
          triggerScheduledSend(sendButton, scheduledAt)
        }
      })
    }
  })
  
  app.mount(mountPoint)
}

/**
 * Trigger scheduled send
 */
function triggerScheduledSend(sendButton, scheduledAt) {
  // Store in global state for the API override to pick up
  if (typeof frappe !== 'undefined') {
    frappe.flags = frappe.flags || {}
    frappe.flags.mail_scheduler_scheduled_at = scheduledAt
  }
  
  // Click the original send button
  sendButton.click()
  
  // Show confirmation toast
  setTimeout(() => {
    if (typeof frappe !== 'undefined' && frappe.toast) {
      const date = new Date(scheduledAt)
      frappe.toast({
        title: __('Email Scheduled'),
        message: __('Your email will be sent on {0}', [
          date.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          })
        ]),
        type: 'success'
      })
    }
    
    // Clear the flag
    if (typeof frappe !== 'undefined') {
      delete frappe.flags.mail_scheduler_scheduled_at
    }
  }, 500)
}

/**
 * Expose API for external use
 */
function exposeApi(config) {
  window.mailScheduler = {
    config,
    
    /**
     * Schedule an email
     */
    async scheduleEmail(mailData, scheduledAt) {
      return frappe.call({
        method: 'mail_scheduler.api.mail.create_mail',
        args: {
          ...mailData,
          scheduled_at: scheduledAt
        }
      })
    },
    
    /**
     * Cancel a scheduled email
     */
    async cancelScheduledEmail(emailId) {
      return frappe.call({
        method: 'mail_scheduler.api.scheduled.cancel_scheduled_email',
        args: { email_id: emailId }
      })
    },
    
    /**
     * Get scheduled emails list
     */
    async getScheduledEmails(limit = 20, offset = 0) {
      return frappe.call({
        method: 'mail_scheduler.api.scheduled.get_scheduled_emails',
        args: { limit, offset }
      })
    },
    
    /**
     * Format scheduled date for display
     */
    formatScheduledDate(dateStr) {
      const date = new Date(dateStr)
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      
      const timeStr = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })
      
      if (date.toDateString() === now.toDateString()) {
        return `Today at ${timeStr}`
      } else if (date.toDateString() === tomorrow.toDateString()) {
        return `Tomorrow at ${timeStr}`
      } else {
        return date.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    },
    
    /**
     * Get maximum schedule date
     */
    getMaxScheduleDate() {
      const maxDays = config.max_schedule_days || 30
      const maxDate = new Date()
      maxDate.setDate(maxDate.getDate() + maxDays)
      return maxDate
    }
  }
}

// Translation helper
function __(text, args) {
  if (typeof frappe !== 'undefined' && frappe.__) {
    return frappe.__(text, args)
  }
  if (args) {
    return text.replace(/{(\d+)}/g, (match, index) => args[index] || match)
  }
  return text
}
