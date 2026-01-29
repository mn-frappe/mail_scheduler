/**
 * Mail Scheduler - Scheduled Email Send for Frappe Mail
 *
 * This module adds "Send Later" functionality to Frappe Mail's compose interface.
 * It works as an addon without modifying the core mail app.
 */

(function () {
	"use strict";

	// Configuration from boot
	const config = frappe.boot.mail_scheduler || {
		enabled: true,
		max_schedule_days: 30,
	};

	if (!config.enabled) {
		return;
	}

	// Store reference to original send function
	let originalSendMail = null;

	/**
	 * Initialize mail scheduler when mail app is ready
	 */
	frappe.ready(function () {
		// Wait for mail app to load
		if (typeof frappe.mail === "undefined") {
			// Retry after a short delay
			setTimeout(initMailScheduler, 1000);
		} else {
			initMailScheduler();
		}
	});

	function initMailScheduler() {
		console.log("Mail Scheduler: Initializing...");

		// Add CSS styles
		addStyles();

		// Extend compose toolbar if available
		extendComposeToolbar();
	}

	function addStyles() {
		const style = document.createElement("style");
		style.textContent = `
			.mail-scheduler-dropdown {
				position: relative;
				display: inline-block;
			}

			.mail-scheduler-menu {
				position: absolute;
				bottom: 100%;
				right: 0;
				background: var(--fg-color);
				border: 1px solid var(--border-color);
				border-radius: var(--border-radius-md);
				box-shadow: var(--shadow-md);
				min-width: 200px;
				z-index: 100;
				margin-bottom: 4px;
			}

			.mail-scheduler-menu-item {
				padding: 8px 12px;
				cursor: pointer;
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.mail-scheduler-menu-item:hover {
				background: var(--bg-color);
			}

			.mail-scheduler-calendar {
				padding: 12px;
				background: var(--fg-color);
				border: 1px solid var(--border-color);
				border-radius: var(--border-radius-md);
				box-shadow: var(--shadow-lg);
			}

			.mail-scheduler-calendar-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 12px;
			}

			.mail-scheduler-calendar-grid {
				display: grid;
				grid-template-columns: repeat(7, 1fr);
				gap: 2px;
			}

			.mail-scheduler-calendar-day {
				width: 32px;
				height: 32px;
				display: flex;
				align-items: center;
				justify-content: center;
				cursor: pointer;
				border-radius: var(--border-radius-sm);
				font-size: 12px;
			}

			.mail-scheduler-calendar-day:hover:not(.disabled) {
				background: var(--bg-color);
			}

			.mail-scheduler-calendar-day.selected {
				background: var(--primary);
				color: white;
			}

			.mail-scheduler-calendar-day.today {
				font-weight: bold;
				color: var(--primary);
			}

			.mail-scheduler-calendar-day.disabled {
				color: var(--text-muted);
				cursor: not-allowed;
			}

			.mail-scheduler-time-picker {
				margin-top: 12px;
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.mail-scheduler-badge {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				padding: 2px 8px;
				background: var(--yellow-100);
				color: var(--yellow-700);
				border-radius: var(--border-radius-full);
				font-size: 11px;
			}
		`;
		document.head.appendChild(style);
	}

	function extendComposeToolbar() {
		// This function would be called to extend the compose toolbar
		// The actual implementation depends on how the mail app exposes its components

		// For Vue-based mail app, we might need to use a different approach
		// such as providing a plugin or using event listeners

		console.log("Mail Scheduler: Ready to extend compose toolbar");

		// Expose API for external use
		window.mailScheduler = {
			config: config,
			scheduleEmail: scheduleEmail,
			cancelScheduledEmail: cancelScheduledEmail,
			updateScheduledEmail: updateScheduledEmail,
			getScheduledEmails: getScheduledEmails,
		};
	}

	/**
	 * Schedule an email for later delivery
	 */
	async function scheduleEmail(mailData, scheduledAt) {
		return frappe.call({
			method: "mail_scheduler.api.mail.create_mail",
			args: {
				...mailData,
				scheduled_at: scheduledAt,
			},
		});
	}

	/**
	 * Cancel a scheduled email
	 */
	async function cancelScheduledEmail(mailQueueName) {
		return frappe.call({
			method: "mail_scheduler.api.mail.cancel_scheduled_mail",
			args: {
				mail_queue_name: mailQueueName,
			},
		});
	}

	/**
	 * Update scheduled time for an email
	 */
	async function updateScheduledEmail(mailQueueName, newScheduledAt) {
		return frappe.call({
			method: "mail_scheduler.api.mail.update_scheduled_mail",
			args: {
				mail_queue_name: mailQueueName,
				new_scheduled_at: newScheduledAt,
			},
		});
	}

	/**
	 * Get list of scheduled emails
	 */
	async function getScheduledEmails(limit = 20, offset = 0) {
		return frappe.call({
			method: "mail_scheduler.api.mail.get_scheduled_mails",
			args: {
				limit: limit,
				offset: offset,
			},
		});
	}

	/**
	 * Get maximum allowed schedule date
	 */
	function getMaxScheduleDate() {
		const maxDays = config.max_schedule_days || 30;
		const maxDate = new Date();
		maxDate.setDate(maxDate.getDate() + maxDays);
		return maxDate;
	}

	/**
	 * Format date for display
	 */
	function formatScheduledDate(dateStr) {
		const date = new Date(dateStr);
		const now = new Date();
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);

		const timeStr = date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});

		if (date.toDateString() === now.toDateString()) {
			return `Today at ${timeStr}`;
		} else if (date.toDateString() === tomorrow.toDateString()) {
			return `Tomorrow at ${timeStr}`;
		} else {
			return date.toLocaleDateString([], {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		}
	}

	// Expose format function
	window.mailScheduler = window.mailScheduler || {};
	window.mailScheduler.formatScheduledDate = formatScheduledDate;
	window.mailScheduler.getMaxScheduleDate = getMaxScheduleDate;
})();
