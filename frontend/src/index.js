/**
 * Mail Scheduler Frontend Components
 * 
 * This module exports Vue components and utilities for the mail scheduler addon.
 * It integrates with the Frappe Mail frontend to add scheduling capabilities.
 */

import ScheduleModal from './components/ScheduleModal.vue'
import ScheduleButton from './components/ScheduleButton.vue'
import { initMailScheduler } from './integration'

// Export components for external use
export { ScheduleModal, ScheduleButton }

// Auto-initialize when loaded
if (typeof window !== 'undefined') {
  window.MailScheduler = {
    ScheduleModal,
    ScheduleButton,
    init: initMailScheduler
  }
  
  // Initialize on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMailScheduler)
  } else {
    initMailScheduler()
  }
}
