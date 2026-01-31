/**
 * Mail Scheduler - Enterprise-Grade Scheduled Email Send for Frappe Mail
 *
 * This module adds "Send Later" functionality to Frappe Mail's compose interface.
 * It works as an addon without modifying the core mail app.
 *
 * Features:
 * - Schedule button in compose toolbar
 * - Calendar-based date/time picker
 * - Quick scheduling options (Tomorrow AM, Tomorrow PM, Monday)
 * - 12/24 hour time format toggle
 * - Scheduled emails folder in sidebar
 * - Enterprise-grade error handling and retry logic
 * - Rate limiting protection on client side
 * - Comprehensive logging and debugging
 * - Memory leak prevention
 * - XSS protection
 *
 * @version 2.0.0
 * @license AGPL-3.0
 */

(function () {
	"use strict";

	// ============================================================
	// CONSTANTS AND CONFIGURATION
	// ============================================================

	const VERSION = "2.0.0";
	const DEBUG = true; // Set to true for verbose logging

	// Get mail_scheduler config - check window first (mail SPA), then frappe.boot (desk)
	const getSchedulerConfig = () => {
		// Mail SPA sets config directly on window
		if (window.mail_scheduler) return window.mail_scheduler;
		// Frappe desk sets config in frappe.boot
		if (typeof frappe !== "undefined" && frappe?.boot?.mail_scheduler)
			return frappe.boot.mail_scheduler;
		// Return defaults
		return {};
	};

	const schedulerConfig = getSchedulerConfig();

	// Configuration from boot with safe defaults
	const config = Object.freeze({
		enabled: schedulerConfig?.enabled ?? true,
		max_schedule_days: Math.min(
			Math.max(schedulerConfig?.max_schedule_days ?? 30, 1),
			365
		),
		min_schedule_minutes: schedulerConfig?.min_schedule_minutes ?? 1,
		retry_attempts: 3,
		retry_delay_ms: 1000,
		api_timeout_ms: 30000,
		debounce_ms: 300,
		toast_duration_ms: 5000,
	});

	// API endpoints (centralized for easy maintenance)
	const ENDPOINTS = Object.freeze({
		CREATE_MAIL: "mail_scheduler.api.mail.create_mail",
		UPDATE_DRAFT: "mail_scheduler.api.mail.update_draft_mail",
		GET_SCHEDULED: "mail_scheduler.api.scheduled.get_scheduled_emails",
		CANCEL_SCHEDULED: "mail_scheduler.api.scheduled.cancel_scheduled_email",
		RESCHEDULE: "mail_scheduler.api.scheduled.reschedule_email",
		// Original endpoints we intercept
		ORIGINAL_CREATE: "mail.api.mail.create_mail",
		ORIGINAL_UPDATE: "mail.api.mail.update_draft_mail",
	});

	// Rate limiting state
	const rateLimiter = {
		requests: [],
		maxRequests: 60,
		windowMs: 60000,
	};

	// ============================================================
	// LOGGING UTILITIES
	// ============================================================

	const Logger = {
		_prefix: "[Mail Scheduler]",

		_format(level, ...args) {
			const timestamp = new Date().toISOString();
			return [`${this._prefix} [${level}] [${timestamp}]`, ...args];
		},

		debug(...args) {
			if (DEBUG) {
				console.debug(...this._format("DEBUG", ...args));
			}
		},

		info(...args) {
			console.log(...this._format("INFO", ...args));
		},

		warn(...args) {
			console.warn(...this._format("WARN", ...args));
		},

		error(...args) {
			console.error(...this._format("ERROR", ...args));
		},

		// Track errors for potential reporting
		trackError(error, context = {}) {
			this.error("Error tracked:", error.message, context);
			// Could integrate with error tracking service here
		},
	};

	// ============================================================
	// UTILITY FUNCTIONS
	// ============================================================

	/**
	 * Sanitize string to prevent XSS
	 * @param {string} str - String to sanitize
	 * @returns {string} Sanitized string
	 */
	function sanitizeHTML(str) {
		if (typeof str !== "string") return "";
		const div = document.createElement("div");
		div.textContent = str;
		return div.innerHTML;
	}

	/**
	 * Debounce function to prevent rapid calls
	 * @param {Function} func - Function to debounce
	 * @param {number} wait - Milliseconds to wait
	 * @returns {Function} Debounced function
	 */
	function debounce(func, wait) {
		let timeout;
		return function executedFunction(...args) {
			const later = () => {
				clearTimeout(timeout);
				func.apply(this, args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	}

	/**
	 * Check if we're being rate limited
	 * @returns {boolean} True if rate limited
	 */
	function isRateLimited() {
		const now = Date.now();
		// Clean old requests
		rateLimiter.requests = rateLimiter.requests.filter(
			(time) => now - time < rateLimiter.windowMs
		);
		return rateLimiter.requests.length >= rateLimiter.maxRequests;
	}

	/**
	 * Record a request for rate limiting
	 */
	function recordRequest() {
		rateLimiter.requests.push(Date.now());
	}

	/**
	 * Validate date is within allowed range
	 * @param {Date} date - Date to validate
	 * @returns {Object} Validation result with isValid and error
	 */
	function validateScheduleDate(date) {
		if (!(date instanceof Date) || isNaN(date.getTime())) {
			return { isValid: false, error: "Invalid date provided" };
		}

		const now = new Date();
		const minTime = new Date(now.getTime() + config.min_schedule_minutes * 60 * 1000);
		const maxTime = new Date(now.getTime() + config.max_schedule_days * 24 * 60 * 60 * 1000);

		if (date < minTime) {
			return {
				isValid: false,
				error: `Schedule time must be at least ${config.min_schedule_minutes} minute(s) in the future`,
			};
		}

		if (date > maxTime) {
			return {
				isValid: false,
				error: `Cannot schedule more than ${config.max_schedule_days} days in the future`,
			};
		}

		return { isValid: true, error: null };
	}

	/**
	 * Retry a function with exponential backoff
	 * @param {Function} fn - Async function to retry
	 * @param {number} maxAttempts - Maximum retry attempts
	 * @param {number} delayMs - Base delay in milliseconds
	 * @returns {Promise} Result of the function
	 */
	async function retryWithBackoff(fn, maxAttempts = config.retry_attempts, delayMs = config.retry_delay_ms) {
		let lastError;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				Logger.warn(`Attempt ${attempt}/${maxAttempts} failed:`, error.message);

				if (attempt < maxAttempts) {
					const backoffDelay = delayMs * Math.pow(2, attempt - 1);
					Logger.debug(`Retrying in ${backoffDelay}ms...`);
					await new Promise((resolve) => setTimeout(resolve, backoffDelay));
				}
			}
		}

		throw lastError;
	}

	/**
	 * Format a date for display
	 * @param {Date|string} date - Date to format
	 * @returns {string} Formatted date string
	 */
	function formatScheduledDate(date) {
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (isNaN(d.getTime())) {
				return "Invalid date";
			}
			return d.toLocaleString("en-US", {
				weekday: "short",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			});
		} catch (e) {
			Logger.error("Error formatting date:", e);
			return "Unknown";
		}
	}

	/**
	 * Get relative time description
	 * @param {Date} date - Target date
	 * @returns {string} Relative time string
	 */
	function getRelativeTime(date) {
		const now = new Date();
		const diff = date - now;

		if (diff < 0) {
			return "Time is in the past";
		}

		const minutes = Math.floor(diff / (1000 * 60));
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		if (days > 0) {
			return `in ${days} day${days > 1 ? "s" : ""}`;
		} else if (hours > 0) {
			const remainingMinutes = minutes % 60;
			return `in ${hours} hour${hours > 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
		} else {
			return `in ${minutes} minute${minutes !== 1 ? "s" : ""}`;
		}
	}

	// ============================================================
	// STATE MANAGEMENT
	// ============================================================

	const State = {
		_observers: [],
		_state: {
			scheduleModalOpen: false,
			selectedScheduleTime: null,
			pendingScheduledAt: null,
			scheduledCount: 0,
			isInitialized: false,
			patchesApplied: false,
		},

		get(key) {
			return this._state[key];
		},

		set(key, value) {
			const oldValue = this._state[key];
			this._state[key] = value;
			Logger.debug(`State changed: ${key}`, { old: oldValue, new: value });
			this._notifyObservers(key, value, oldValue);
		},

		subscribe(callback) {
			this._observers.push(callback);
			return () => {
				this._observers = this._observers.filter((cb) => cb !== callback);
			};
		},

		_notifyObservers(key, newValue, oldValue) {
			this._observers.forEach((callback) => {
				try {
					callback(key, newValue, oldValue);
				} catch (e) {
					Logger.error("Error in state observer:", e);
				}
			});
		},

		// Cleanup method for memory management
		reset() {
			this._state = {
				scheduleModalOpen: false,
				selectedScheduleTime: null,
				pendingScheduledAt: null,
				scheduledCount: 0,
				isInitialized: false,
				patchesApplied: false,
			};
			Logger.debug("State reset");
		},
	};

	// ============================================================
	// API INTERCEPTION
	// ============================================================

	let originalFetch = null;
	let originalFrappeCall = null;

	/**
	 * Patch window.fetch to intercept mail API calls
	 */
	function patchFetch() {
		if (originalFetch) {
			Logger.debug("Fetch already patched, skipping");
			return;
		}

		originalFetch = window.fetch;

		window.fetch = async function (url, options = {}) {
			const pendingScheduledAt = State.get("pendingScheduledAt");

			// Check if this is a mail API call with pending schedule
			if (pendingScheduledAt && options?.body && options?.method === "POST") {
				const urlStr = String(url);

				// Check if it's a mail creation/update call
				const isCreateCall = urlStr.includes(`/api/method/${ENDPOINTS.ORIGINAL_CREATE}`);
				const isUpdateCall = urlStr.includes(`/api/method/${ENDPOINTS.ORIGINAL_UPDATE}`);

				if (isCreateCall || isUpdateCall) {
					Logger.info("Intercepting fetch call:", urlStr);
					Logger.debug("Pending scheduled_at:", pendingScheduledAt);

					// Check rate limiting
					if (isRateLimited()) {
						Logger.warn("Rate limited, rejecting request");
						throw new Error("Too many requests. Please try again in a moment.");
					}

					try {
						// Parse and modify body
						let body;
						try {
							body =
								typeof options.body === "string"
									? JSON.parse(options.body)
									: options.body;
						} catch (parseError) {
							Logger.error("Failed to parse request body:", parseError);
							State.set("pendingScheduledAt", null);
							return originalFetch.call(this, url, options);
						}

						// Redirect to our API
						const newEndpoint = isCreateCall
							? ENDPOINTS.CREATE_MAIL
							: ENDPOINTS.UPDATE_DRAFT;
						const newUrl = urlStr.replace(
							isCreateCall ? ENDPOINTS.ORIGINAL_CREATE : ENDPOINTS.ORIGINAL_UPDATE,
							newEndpoint
						);

						Logger.info("Redirecting to:", newUrl);

						// Inject scheduled_at
						body.scheduled_at = pendingScheduledAt;

						// Store for callback
						const scheduledAt = pendingScheduledAt;
						State.set("pendingScheduledAt", null);

						const newOptions = {
							...options,
							body: JSON.stringify(body),
						};

						// Record request for rate limiting
						recordRequest();

						// Make the call with retry logic
						const response = await retryWithBackoff(async () => {
							const resp = await originalFetch.call(this, newUrl, newOptions);
							if (!resp.ok && resp.status >= 500) {
								throw new Error(`Server error: ${resp.status}`);
							}
							return resp;
						});

						// Handle response
						if (response.ok) {
							// Show success toast after a brief delay for better UX
							setTimeout(() => {
								showToast(
									"Email Scheduled",
									`Your email will be sent on ${formatScheduledDate(scheduledAt)}`,
									"success"
								);
								// Refresh scheduled count
								loadScheduledCount();
							}, 100);
						} else {
							// Try to get error message from response
							try {
								const errorData = await response.clone().json();
								const errorMsg =
									errorData?.exception ||
									errorData?.message ||
									"Failed to schedule email";
								Logger.error("API error:", errorMsg);
								showToast("Scheduling Failed", sanitizeHTML(errorMsg), "error");
							} catch {
								showToast("Scheduling Failed", "An unexpected error occurred", "error");
							}
						}

						return response;
					} catch (e) {
						Logger.error("Error intercepting fetch:", e);
						State.set("pendingScheduledAt", null);
						showToast("Scheduling Failed", sanitizeHTML(e.message), "error");
						throw e;
					}
				}
			}

			// Pass through for non-intercepted calls
			return originalFetch.call(this, url, options);
		};

		Logger.info("Patched window.fetch for API interception");
	}

	/**
	 * Patch frappe.call for legacy API calls
	 */
	function patchFrappeCall() {
		if (typeof frappe === "undefined" || !frappe.call) {
			Logger.debug("frappe.call not available, skipping patch");
			return;
		}

		if (originalFrappeCall) {
			Logger.debug("frappe.call already patched, skipping");
			return;
		}

		originalFrappeCall = frappe.call;

		frappe.call = function (opts) {
			const pendingScheduledAt = State.get("pendingScheduledAt");

			if (pendingScheduledAt) {
				const method = opts.method || (opts.args && opts.args.method);

				// Check if this is a mail create/update call
				if (
					method === ENDPOINTS.ORIGINAL_CREATE ||
					method === ENDPOINTS.ORIGINAL_UPDATE
				) {
					Logger.info("Intercepting frappe.call:", method);

					// Check rate limiting
					if (isRateLimited()) {
						Logger.warn("Rate limited, rejecting request");
						if (opts.error) {
							opts.error({ message: "Too many requests" });
						}
						return Promise.reject(new Error("Too many requests"));
					}

					const newOpts = { ...opts };

					// Redirect to our API
					newOpts.method =
						method === ENDPOINTS.ORIGINAL_CREATE
							? ENDPOINTS.CREATE_MAIL
							: ENDPOINTS.UPDATE_DRAFT;

					newOpts.args = { ...opts.args, scheduled_at: pendingScheduledAt };

					const scheduledAt = pendingScheduledAt;
					State.set("pendingScheduledAt", null);

					// Wrap success callback
					const originalCallback = newOpts.callback || newOpts.success;
					newOpts.callback = function (response) {
						showToast(
							"Email Scheduled",
							`Your email will be sent on ${formatScheduledDate(scheduledAt)}`,
							"success"
						);
						loadScheduledCount();
						if (originalCallback) {
							originalCallback.call(this, response);
						}
					};

					// Wrap error callback
					const originalError = newOpts.error;
					newOpts.error = function (response) {
						const msg = response?.message || "Failed to schedule email";
						showToast("Scheduling Failed", sanitizeHTML(msg), "error");
						if (originalError) {
							originalError.call(this, response);
						}
					};

					recordRequest();
					return originalFrappeCall.call(this, newOpts);
				}
			}

			return originalFrappeCall.call(this, opts);
		};

		Logger.info("Patched frappe.call for API interception");
	}

	/**
	 * Apply all patches
	 */
	function applyPatches() {
		if (State.get("patchesApplied")) {
			Logger.debug("Patches already applied, skipping");
			return;
		}

		patchFetch();
		patchFrappeCall();
		State.set("patchesApplied", true);
		Logger.info("All API patches applied");
	}

	/**
	 * Remove patches (for cleanup)
	 */
	function removePatches() {
		if (originalFetch) {
			window.fetch = originalFetch;
			originalFetch = null;
		}
		if (originalFrappeCall && typeof frappe !== "undefined") {
			frappe.call = originalFrappeCall;
			originalFrappeCall = null;
		}
		State.set("patchesApplied", false);
		Logger.info("Patches removed");
	}

	// ============================================================
	// UI COMPONENTS
	// ============================================================

	/**
	 * Show toast notification
	 * @param {string} title - Toast title
	 * @param {string} message - Toast message
	 * @param {string} type - Toast type (success, error, warning, info)
	 */
	function showToast(title, message, type = "success") {
		const indicatorMap = {
			success: "green",
			error: "red",
			warning: "orange",
			info: "blue",
		};

		if (typeof frappe !== "undefined" && frappe.toast) {
			frappe.toast({
				title: sanitizeHTML(title),
				message: sanitizeHTML(message),
				indicator: indicatorMap[type] || "blue",
			});
		} else {
			// Fallback toast using native DOM
			const toast = document.createElement("div");
			toast.className = `mail-scheduler-toast mail-scheduler-toast-${type}`;
			toast.innerHTML = `
				<strong>${sanitizeHTML(title)}</strong>
				<span>${sanitizeHTML(message)}</span>
			`;
			document.body.appendChild(toast);

			setTimeout(() => {
				toast.classList.add("show");
			}, 10);

			setTimeout(() => {
				toast.classList.remove("show");
				setTimeout(() => toast.remove(), 300);
			}, config.toast_duration_ms);
		}
	}

	/**
	 * Get quick option date
	 * @param {string} action - Quick option action
	 * @returns {Date} Calculated date
	 */
	function getQuickOptionDate(action) {
		const now = new Date();
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);

		switch (action) {
			case "tomorrow-am":
				tomorrow.setHours(8, 0, 0, 0);
				return tomorrow;
			case "tomorrow-pm":
				tomorrow.setHours(13, 0, 0, 0);
				return tomorrow;
			case "monday-am": {
				const monday = new Date(now);
				const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
				monday.setDate(monday.getDate() + daysUntilMonday);
				monday.setHours(8, 0, 0, 0);
				return monday;
			}
			default:
				tomorrow.setHours(9, 0, 0, 0);
				return tomorrow;
		}
	}

	/**
	 * Get quick option label
	 * @param {string} action - Quick option action
	 * @returns {string} Formatted label
	 */
	function getQuickOptionLabel(action) {
		return formatScheduledDate(getQuickOptionDate(action));
	}

	/**
	 * Create schedule dropdown HTML
	 * @returns {string} HTML string
	 */
	function createDropdownHTML() {
		return `
			<button class="mail-scheduler-btn" type="button" aria-haspopup="true" aria-expanded="false">
				${icons.clock}
				<span>Schedule</span>
				${icons.chevronUp}
			</button>
			<div class="mail-scheduler-menu" role="menu">
				<div class="mail-scheduler-menu-item" data-action="tomorrow-am" role="menuitem" tabindex="-1">
					${icons.sunrise}
					<div>
						<div class="label">Tomorrow morning</div>
						<div class="sublabel">${sanitizeHTML(getQuickOptionLabel("tomorrow-am"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-menu-item" data-action="tomorrow-pm" role="menuitem" tabindex="-1">
					${icons.sun}
					<div>
						<div class="label">Tomorrow afternoon</div>
						<div class="sublabel">${sanitizeHTML(getQuickOptionLabel("tomorrow-pm"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-menu-item" data-action="monday-am" role="menuitem" tabindex="-1">
					${icons.calendar}
					<div>
						<div class="label">Monday morning</div>
						<div class="sublabel">${sanitizeHTML(getQuickOptionLabel("monday-am"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-divider" role="separator"></div>
				<div class="mail-scheduler-menu-item" data-action="custom" role="menuitem" tabindex="-1">
					${icons.clock}
					<div class="label">Pick date & time...</div>
				</div>
			</div>
		`;
	}

	/**
	 * Inject schedule button into toolbar
	 * @param {Element} container - Toolbar container
	 * @param {Element} sendButton - Send button element
	 */
	function injectScheduleButton(container, sendButton) {
		// Prevent double injection
		if (container.querySelector(".mail-scheduler-dropdown")) {
			Logger.debug("Schedule button already exists, skipping injection");
			return;
		}

		const dropdown = document.createElement("div");
		dropdown.className = "mail-scheduler-dropdown";
		dropdown.innerHTML = createDropdownHTML();

		// Insert before Send button
		sendButton.parentNode.insertBefore(dropdown, sendButton);

		const btn = dropdown.querySelector(".mail-scheduler-btn");
		const menu = dropdown.querySelector(".mail-scheduler-menu");

		// Toggle menu with proper ARIA
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const isOpen = dropdown.classList.toggle("open");
			btn.setAttribute("aria-expanded", isOpen);

			if (isOpen) {
				// Focus first menu item for keyboard navigation
				const firstItem = menu.querySelector(".mail-scheduler-menu-item");
				if (firstItem) firstItem.focus();
			}
		});

		// Keyboard navigation
		dropdown.addEventListener("keydown", (e) => {
			if (!dropdown.classList.contains("open")) return;

			const items = [...menu.querySelectorAll(".mail-scheduler-menu-item")];
			const currentIndex = items.indexOf(document.activeElement);

			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					items[(currentIndex + 1) % items.length]?.focus();
					break;
				case "ArrowUp":
					e.preventDefault();
					items[(currentIndex - 1 + items.length) % items.length]?.focus();
					break;
				case "Escape":
					dropdown.classList.remove("open");
					btn.setAttribute("aria-expanded", "false");
					btn.focus();
					break;
				case "Enter":
					e.preventDefault();
					document.activeElement?.click();
					break;
			}
		});

		// Close on outside click
		const closeHandler = (e) => {
			if (!dropdown.contains(e.target)) {
				dropdown.classList.remove("open");
				btn.setAttribute("aria-expanded", "false");
			}
		};
		document.addEventListener("click", closeHandler);

		// Store cleanup function
		dropdown._cleanup = () => {
			document.removeEventListener("click", closeHandler);
		};

		// Handle menu items
		menu.querySelectorAll(".mail-scheduler-menu-item").forEach((item) => {
			item.addEventListener("click", (e) => {
				e.stopPropagation();
				const action = item.dataset.action;
				dropdown.classList.remove("open");
				btn.setAttribute("aria-expanded", "false");

				if (action === "custom") {
					openScheduleModal(sendButton);
				} else {
					const scheduledAt = getQuickOptionDate(action);
					const validation = validateScheduleDate(scheduledAt);

					if (!validation.isValid) {
						showToast("Invalid Schedule Time", validation.error, "error");
						return;
					}

					triggerScheduledSend(sendButton, scheduledAt);
				}
			});
		});

		Logger.info("Schedule button injected successfully");
	}

	/**
	 * Open schedule modal
	 * @param {Element} sendButton - Send button element
	 */
	function openScheduleModal(sendButton) {
		// Remove any existing modal
		const existing = document.querySelector(".mail-scheduler-modal-overlay");
		if (existing) {
			existing.remove();
		}

		State.set("scheduleModalOpen", true);

		// Create modal
		const overlay = document.createElement("div");
		overlay.className = "mail-scheduler-modal-overlay";
		overlay.setAttribute("role", "dialog");
		overlay.setAttribute("aria-modal", "true");
		overlay.setAttribute("aria-labelledby", "mail-scheduler-modal-title");
		overlay.innerHTML = createModalHTML();
		document.body.appendChild(overlay);

		// Trap focus within modal
		const focusableElements = overlay.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		const firstFocusable = focusableElements[0];
		const lastFocusable = focusableElements[focusableElements.length - 1];

		overlay.addEventListener("keydown", (e) => {
			if (e.key === "Tab") {
				if (e.shiftKey && document.activeElement === firstFocusable) {
					e.preventDefault();
					lastFocusable.focus();
				} else if (!e.shiftKey && document.activeElement === lastFocusable) {
					e.preventDefault();
					firstFocusable.focus();
				}
			}
			if (e.key === "Escape") {
				closeModal();
			}
		});

		// Initialize modal with animation
		requestAnimationFrame(() => {
			overlay.classList.add("open");
			initializeModal(overlay, sendButton);
			firstFocusable?.focus();
		});

		function closeModal() {
			State.set("scheduleModalOpen", false);
			overlay.classList.remove("open");
			setTimeout(() => {
				overlay.remove();
			}, 200);
		}

		// Store close function for access within initializeModal
		overlay._close = closeModal;
	}

	/**
	 * Create modal HTML
	 * @returns {string} HTML string
	 */
	function createModalHTML() {
		const timeFormat = localStorage.getItem("mailSchedulerTimeFormat") || "12h";

		return `
			<div class="mail-scheduler-modal">
				<div class="mail-scheduler-modal-header">
					<div class="mail-scheduler-modal-title" id="mail-scheduler-modal-title">Schedule Send</div>
					<button class="mail-scheduler-modal-close" type="button" aria-label="Close dialog">
						${icons.x}
					</button>
				</div>
				<div class="mail-scheduler-modal-body">
					<!-- Quick Options -->
					<div class="mail-scheduler-quick-options" role="group" aria-label="Quick schedule options">
						<div class="mail-scheduler-quick-option" data-action="tomorrow-am" role="button" tabindex="0">
							${icons.sunrise}
							<div class="label">Tomorrow</div>
							<div class="time">8:00 AM</div>
						</div>
						<div class="mail-scheduler-quick-option" data-action="tomorrow-pm" role="button" tabindex="0">
							${icons.sun}
							<div class="label">Tomorrow</div>
							<div class="time">1:00 PM</div>
						</div>
						<div class="mail-scheduler-quick-option" data-action="monday-am" role="button" tabindex="0">
							${icons.calendar}
							<div class="label">Monday</div>
							<div class="time">8:00 AM</div>
						</div>
					</div>

					<!-- Calendar -->
					<div class="mail-scheduler-calendar" role="application" aria-label="Calendar">
						<div class="mail-scheduler-calendar-header">
							<button class="mail-scheduler-calendar-nav" data-action="prev" type="button" aria-label="Previous month">
								${icons.chevronLeft}
							</button>
							<div class="mail-scheduler-calendar-month" aria-live="polite"></div>
							<button class="mail-scheduler-calendar-nav" data-action="next" type="button" aria-label="Next month">
								${icons.chevronRight}
							</button>
						</div>
						<div class="mail-scheduler-calendar-weekdays" role="row">
							<div class="mail-scheduler-calendar-weekday" role="columnheader">S</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">M</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">T</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">W</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">T</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">F</div>
							<div class="mail-scheduler-calendar-weekday" role="columnheader">S</div>
						</div>
						<div class="mail-scheduler-calendar-days" role="grid"></div>
					</div>

					<!-- Time -->
					<div class="mail-scheduler-time">
						<div class="mail-scheduler-time-header">
							<label class="mail-scheduler-time-label" for="mail-scheduler-hour">Time</label>
							<div class="mail-scheduler-time-format" role="group" aria-label="Time format">
								<button data-format="12h" type="button" class="${timeFormat === "12h" ? "active" : ""}" aria-pressed="${timeFormat === "12h"}">12h</button>
								<button data-format="24h" type="button" class="${timeFormat === "24h" ? "active" : ""}" aria-pressed="${timeFormat === "24h"}">24h</button>
							</div>
						</div>
						<div class="mail-scheduler-time-inputs">
							<select class="mail-scheduler-hour" id="mail-scheduler-hour" aria-label="Hour"></select>
							<span class="mail-scheduler-time-separator" aria-hidden="true">:</span>
							<select class="mail-scheduler-minute" aria-label="Minute">
								<option value="0">00</option>
								<option value="15">15</option>
								<option value="30">30</option>
								<option value="45">45</option>
							</select>
							<select class="mail-scheduler-period ${timeFormat === "24h" ? "hidden" : ""}" aria-label="AM/PM">
								<option value="AM">AM</option>
								<option value="PM">PM</option>
							</select>
						</div>
					</div>

					<!-- Summary -->
					<div class="mail-scheduler-summary" role="status" aria-live="polite">
						${icons.clock}
						<div>
							<div class="mail-scheduler-summary-text">Your email will be sent on:</div>
							<div class="mail-scheduler-summary-date"></div>
							<div class="mail-scheduler-summary-relative"></div>
						</div>
					</div>
				</div>
				<div class="mail-scheduler-modal-footer">
					<button class="mail-scheduler-btn-secondary" data-action="cancel" type="button">Cancel</button>
					<button class="mail-scheduler-btn-primary" data-action="confirm" type="button">
						${icons.send}
						Schedule Send
					</button>
				</div>
			</div>
		`;
	}

	/**
	 * Initialize modal functionality
	 * @param {Element} overlay - Modal overlay element
	 * @param {Element} sendButton - Send button element
	 */
	function initializeModal(overlay, sendButton) {
		const modal = overlay.querySelector(".mail-scheduler-modal");
		const monthLabel = modal.querySelector(".mail-scheduler-calendar-month");
		const daysContainer = modal.querySelector(".mail-scheduler-calendar-days");
		const hourSelect = modal.querySelector(".mail-scheduler-hour");
		const minuteSelect = modal.querySelector(".mail-scheduler-minute");
		const periodSelect = modal.querySelector(".mail-scheduler-period");
		const summaryDate = modal.querySelector(".mail-scheduler-summary-date");
		const summaryRelative = modal.querySelector(".mail-scheduler-summary-relative");

		let currentMonth = new Date().getMonth();
		let currentYear = new Date().getFullYear();
		let selectedDate = new Date();
		selectedDate.setDate(selectedDate.getDate() + 1);
		let timeFormat = localStorage.getItem("mailSchedulerTimeFormat") || "12h";

		// Helper functions
		function populateHours() {
			hourSelect.innerHTML = "";
			if (timeFormat === "12h") {
				for (let i = 1; i <= 12; i++) {
					const option = document.createElement("option");
					option.value = i;
					option.textContent = i;
					hourSelect.appendChild(option);
				}
			} else {
				for (let i = 0; i < 24; i++) {
					const option = document.createElement("option");
					option.value = i;
					option.textContent = i.toString().padStart(2, "0");
					hourSelect.appendChild(option);
				}
			}
		}

		function renderCalendar() {
			const months = [
				"January", "February", "March", "April", "May", "June",
				"July", "August", "September", "October", "November", "December",
			];
			monthLabel.textContent = `${months[currentMonth]} ${currentYear}`;

			const firstDay = new Date(currentYear, currentMonth, 1);
			const lastDay = new Date(currentYear, currentMonth + 1, 0);
			const startPadding = firstDay.getDay();
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const maxDate = new Date();
			maxDate.setDate(maxDate.getDate() + config.max_schedule_days);

			let html = "";

			// Previous month padding
			const prevMonthLast = new Date(currentYear, currentMonth, 0);
			for (let i = startPadding - 1; i >= 0; i--) {
				const d = prevMonthLast.getDate() - i;
				html += `<div class="mail-scheduler-calendar-day other-month disabled" aria-hidden="true">${d}</div>`;
			}

			// Current month
			for (let i = 1; i <= lastDay.getDate(); i++) {
				const date = new Date(currentYear, currentMonth, i);
				date.setHours(0, 0, 0, 0);
				const isPast = date < today;
				const isTooFar = date > maxDate;
				const isToday = date.getTime() === today.getTime();
				const isSelected =
					selectedDate && date.toDateString() === selectedDate.toDateString();

				const classes = ["mail-scheduler-calendar-day"];
				const disabled = isPast || isTooFar;

				if (disabled) classes.push("disabled");
				if (isToday) classes.push("today");
				if (isSelected) classes.push("selected");

				const ariaLabel = date.toLocaleDateString("en-US", {
					weekday: "long",
					month: "long",
					day: "numeric",
				});

				html += `<div class="${classes.join(" ")}" 
					data-date="${date.toISOString()}" 
					role="gridcell" 
					tabindex="${isSelected ? "0" : "-1"}"
					aria-label="${ariaLabel}"
					aria-selected="${isSelected}"
					aria-disabled="${disabled}"
					${disabled ? "" : 'style="cursor: pointer"'}>${i}</div>`;
			}

			// Next month padding
			const remaining = 42 - (startPadding + lastDay.getDate());
			for (let i = 1; i <= remaining; i++) {
				html += `<div class="mail-scheduler-calendar-day other-month disabled" aria-hidden="true">${i}</div>`;
			}

			daysContainer.innerHTML = html;

			// Add click handlers to valid days
			daysContainer
				.querySelectorAll(".mail-scheduler-calendar-day:not(.disabled):not(.other-month)")
				.forEach((day) => {
					day.addEventListener("click", () => {
						selectedDate = new Date(day.dataset.date);
						renderCalendar();
						updateSummary();
						highlightQuickOption();
					});

					// Keyboard support for calendar
					day.addEventListener("keydown", (e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							day.click();
						}
					});
				});
		}

		function getSelectedDateTime() {
			const date = new Date(selectedDate);
			let hour = parseInt(hourSelect.value, 10);
			const minute = parseInt(minuteSelect.value, 10);

			if (timeFormat === "12h") {
				if (periodSelect.value === "PM" && hour !== 12) hour += 12;
				if (periodSelect.value === "AM" && hour === 12) hour = 0;
			}

			date.setHours(hour, minute, 0, 0);
			return date;
		}

		function updateSummary() {
			const date = getSelectedDateTime();
			summaryDate.textContent = date.toLocaleString("en-US", {
				weekday: "long",
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: timeFormat === "12h",
			});
			summaryRelative.textContent = getRelativeTime(date);

			// Validate and show warning if needed
			const validation = validateScheduleDate(date);
			if (!validation.isValid) {
				summaryRelative.textContent = validation.error;
				summaryRelative.classList.add("error");
			} else {
				summaryRelative.classList.remove("error");
			}
		}

		function highlightQuickOption() {
			modal.querySelectorAll(".mail-scheduler-quick-option").forEach((opt) => {
				const action = opt.dataset.action;
				const optDate = getQuickOptionDate(action);
				const selected = getSelectedDateTime();
				const matches =
					optDate.toDateString() === selected.toDateString() &&
					optDate.getHours() === selected.getHours() &&
					optDate.getMinutes() === selected.getMinutes();

				opt.classList.toggle("selected", matches);
				opt.setAttribute("aria-pressed", matches);
			});
		}

		function closeModal() {
			if (overlay._close) overlay._close();
		}

		// Initialize
		populateHours();
		renderCalendar();
		updateSummary();

		// Set sensible defaults
		hourSelect.value = timeFormat === "12h" ? "9" : "9";
		periodSelect.value = "AM";

		// Event listeners
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) closeModal();
		});

		modal.querySelector(".mail-scheduler-modal-close").addEventListener("click", closeModal);
		modal.querySelector('[data-action="cancel"]').addEventListener("click", closeModal);

		// Confirm button
		modal.querySelector('[data-action="confirm"]').addEventListener("click", () => {
			const scheduledAt = getSelectedDateTime();
			const validation = validateScheduleDate(scheduledAt);

			if (!validation.isValid) {
				showToast("Invalid Schedule Time", validation.error, "error");
				return;
			}

			closeModal();
			triggerScheduledSend(sendButton, scheduledAt);
		});

		// Calendar navigation
		modal.querySelector('[data-action="prev"]').addEventListener("click", () => {
			currentMonth--;
			if (currentMonth < 0) {
				currentMonth = 11;
				currentYear--;
			}
			renderCalendar();
		});

		modal.querySelector('[data-action="next"]').addEventListener("click", () => {
			currentMonth++;
			if (currentMonth > 11) {
				currentMonth = 0;
				currentYear++;
			}
			renderCalendar();
		});

		// Quick options
		modal.querySelectorAll(".mail-scheduler-quick-option").forEach((opt) => {
			const handler = () => {
				const action = opt.dataset.action;
				const date = getQuickOptionDate(action);
				selectedDate = date;
				currentMonth = date.getMonth();
				currentYear = date.getFullYear();

				// Update time inputs
				const hours = date.getHours();
				if (timeFormat === "12h") {
					hourSelect.value = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
					periodSelect.value = hours >= 12 ? "PM" : "AM";
				} else {
					hourSelect.value = hours;
				}
				minuteSelect.value = date.getMinutes();

				renderCalendar();
				updateSummary();
				highlightQuickOption();
			};

			opt.addEventListener("click", handler);
			opt.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handler();
				}
			});
		});

		// Time format toggle
		modal.querySelectorAll(".mail-scheduler-time-format button").forEach((btn) => {
			btn.addEventListener("click", () => {
				const newFormat = btn.dataset.format;
				if (newFormat === timeFormat) return;

				const currentHour = parseInt(hourSelect.value, 10);
				const currentPeriod = periodSelect.value;

				timeFormat = newFormat;
				localStorage.setItem("mailSchedulerTimeFormat", newFormat);

				// Update UI
				modal.querySelectorAll(".mail-scheduler-time-format button").forEach((b) => {
					const isActive = b.dataset.format === newFormat;
					b.classList.toggle("active", isActive);
					b.setAttribute("aria-pressed", isActive);
				});

				periodSelect.classList.toggle("hidden", newFormat === "24h");
				populateHours();

				// Convert hour value
				if (newFormat === "24h") {
					let hour24 = currentHour;
					if (currentPeriod === "PM" && currentHour !== 12) hour24 += 12;
					if (currentPeriod === "AM" && currentHour === 12) hour24 = 0;
					hourSelect.value = hour24;
				} else {
					let hour12 = currentHour > 12 ? currentHour - 12 : currentHour === 0 ? 12 : currentHour;
					periodSelect.value = currentHour >= 12 ? "PM" : "AM";
					hourSelect.value = hour12;
				}

				updateSummary();
			});
		});

		// Time change handlers
		hourSelect.addEventListener("change", updateSummary);
		minuteSelect.addEventListener("change", updateSummary);
		periodSelect.addEventListener("change", updateSummary);
	}

	/**
	 * Trigger scheduled send
	 * @param {Element} sendButton - Send button element
	 * @param {Date} scheduledAt - Schedule time
	 */
	function triggerScheduledSend(sendButton, scheduledAt) {
		// Validate schedule time
		const validation = validateScheduleDate(scheduledAt);
		if (!validation.isValid) {
			showToast("Invalid Schedule Time", validation.error, "error");
			return;
		}

		// Set pending schedule for API interception
		State.set("pendingScheduledAt", scheduledAt.toISOString());

		Logger.info("Scheduling email for:", scheduledAt.toISOString());

		// Ensure patches are applied
		applyPatches();

		// Click the send button - our patch will intercept the API call
		try {
			sendButton.click();
		} catch (e) {
			Logger.error("Error clicking send button:", e);
			State.set("pendingScheduledAt", null);
			showToast("Error", "Failed to initiate send", "error");
			return;
		}

		// Clear pending after timeout if the click didn't trigger an API call
		setTimeout(() => {
			if (State.get("pendingScheduledAt")) {
				Logger.warn("Clearing unused pending schedule after timeout");
				State.set("pendingScheduledAt", null);
			}
		}, 10000);
	}

	// ============================================================
	// SIDEBAR INTEGRATION
	// ============================================================

	/**
	 * Inject scheduled folder into sidebar
	 * @param {Element} container - Sidebar container
	 * @param {Element} afterElement - Element to insert after
	 */
	function injectScheduledFolder(container, afterElement) {
		// Prevent double injection
		if (container.querySelector(".mail-scheduler-sidebar-item")) {
			return;
		}

		const scheduledItem = document.createElement("div");
		scheduledItem.className = "mail-scheduler-sidebar-item";
		scheduledItem.setAttribute("role", "button");
		scheduledItem.setAttribute("tabindex", "0");
		scheduledItem.setAttribute("aria-label", "Scheduled emails");
		scheduledItem.innerHTML = `
			${icons.clock}
			<span>Scheduled</span>
			<span class="mail-scheduler-sidebar-count" id="mail-scheduler-count" aria-live="polite">0</span>
		`;

		// Insert after drafts
		if (afterElement.nextSibling) {
			container.insertBefore(scheduledItem, afterElement.nextSibling);
		} else {
			container.appendChild(scheduledItem);
		}

		// Click handler
		const navigateToScheduled = () => {
			if (typeof frappe !== "undefined" && frappe.set_route) {
				frappe.set_route("mail", "scheduled");
			} else {
				window.location.hash = "#/mail/scheduled";
			}
		};

		scheduledItem.addEventListener("click", navigateToScheduled);
		scheduledItem.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				navigateToScheduled();
			}
		});

		// Load count
		loadScheduledCount();

		Logger.info("Scheduled folder injected into sidebar");
	}

	/**
	 * Load scheduled emails count
	 */
	async function loadScheduledCount() {
		try {
			const response = await frappe.call({
				method: ENDPOINTS.GET_SCHEDULED,
				args: { limit: 1, offset: 0 },
			});

			if (response?.message) {
				const count = response.message.total || 0;
				State.set("scheduledCount", count);

				const countEl = document.getElementById("mail-scheduler-count");
				if (countEl) {
					countEl.textContent = count;
					countEl.style.display = count > 0 ? "inline-block" : "none";
				}
			}
		} catch (e) {
			Logger.warn("Could not load scheduled count:", e.message);
		}
	}

	// Debounced version for frequent calls
	const debouncedLoadScheduledCount = debounce(loadScheduledCount, config.debounce_ms);

	// ============================================================
	// DOM OBSERVERS
	// ============================================================

	let toolbarObserver = null;
	let sidebarObserver = null;

	/**
	 * Check for toolbar and inject button
	 * @param {Element} root - Root element to search
	 */
	function checkAndInjectButton(root) {
		const containers = root.querySelectorAll(".ml-auto.flex.items-center.space-x-2");
		Logger.debug(`Found ${containers.length} potential toolbar containers`);

		containers.forEach((container) => {
			// Skip if already has schedule button
			if (container.querySelector(".mail-scheduler-dropdown")) {
				Logger.debug("Container already has schedule button, skipping");
				return;
			}

			// Find Send button
			const buttons = container.querySelectorAll("button");
			Logger.debug(`Found ${buttons.length} buttons in container`);
			let sendButton = null;

			buttons.forEach((btn) => {
				const text = btn.textContent?.trim();
				Logger.debug(`Button text: "${text}"`);
				if (text === "Send" || text.includes("Send")) {
					sendButton = btn;
					Logger.debug("Matched Send button by text");
				}
				if (btn.innerHTML.includes("lucide") && btn.innerHTML.includes("send")) {
					sendButton = btn;
					Logger.debug("Matched Send button by lucide icon");
				}
			});

			if (sendButton) {
				Logger.info("Found Send button, injecting Schedule button");
				injectScheduleButton(container, sendButton);
			} else {
				Logger.debug("No Send button found in this container");
			}
		});
	}

	/**
	 * Check and inject sidebar folder
	 * @param {Element} root - Root element to search
	 */
	function checkAndInjectSidebarFolder(root) {
		const navSections = root.querySelectorAll("nav, aside, [class*='sidebar']");

		navSections.forEach((nav) => {
			if (nav.querySelector(".mail-scheduler-sidebar-item")) return;

			const links = nav.querySelectorAll("a, [role='button'], .cursor-pointer");
			let draftsLink = null;
			let parentContainer = null;

			links.forEach((link) => {
				const text = link.textContent?.toLowerCase() || "";
				if (text.includes("drafts") || text.includes("draft")) {
					draftsLink = link;
					parentContainer = link.parentElement;
				}
			});

			if (draftsLink && parentContainer) {
				injectScheduledFolder(parentContainer, draftsLink);
			}
		});
	}

	/**
	 * Set up DOM observers
	 */
	function setupObservers() {
		// Toolbar observer - watch for changes and check entire body
		toolbarObserver = new MutationObserver((mutations) => {
			// Check the entire document whenever there's any mutation
			// This is more reliable for Vue apps where components mount dynamically
			checkAndInjectButton(document.body);
		});

		toolbarObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// Sidebar observer
		sidebarObserver = new MutationObserver((mutations) => {
			// Check entire document for sidebar changes
			checkAndInjectSidebarFolder(document.body);
		});

		sidebarObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// Initial checks
		const checkIntervals = [500, 1000, 2000, 5000];
		checkIntervals.forEach((delay) => {
			setTimeout(() => {
				checkAndInjectButton(document.body);
				checkAndInjectSidebarFolder(document.body);
			}, delay);
		});

		Logger.info("DOM observers set up");
	}

	/**
	 * Clean up observers
	 */
	function cleanupObservers() {
		if (toolbarObserver) {
			toolbarObserver.disconnect();
			toolbarObserver = null;
		}
		if (sidebarObserver) {
			sidebarObserver.disconnect();
			sidebarObserver = null;
		}
		Logger.debug("Observers cleaned up");
	}

	// ============================================================
	// STYLES
	// ============================================================

	function addStyles() {
		if (document.getElementById("mail-scheduler-styles")) return;

		const style = document.createElement("style");
		style.id = "mail-scheduler-styles";
		style.textContent = `
			/* =============================================
			   Mail Scheduler Styles - Enterprise Edition
			   ============================================= */

			/* CSS Custom Properties for theming */
			:root {
				--ms-primary: #2563eb;
				--ms-primary-dark: #1d4ed8;
				--ms-primary-light: #eff6ff;
				--ms-text: #1f2937;
				--ms-text-muted: #6b7280;
				--ms-text-light: #9ca3af;
				--ms-bg: white;
				--ms-bg-light: #f9fafb;
				--ms-bg-gray: #f3f4f6;
				--ms-border: #e5e7eb;
				--ms-shadow: rgba(0, 0, 0, 0.1);
				--ms-error: #dc2626;
				--ms-success: #16a34a;
				--ms-warning: #d97706;
			}

			/* Dark mode support */
			@media (prefers-color-scheme: dark) {
				:root {
					--ms-text: #f3f4f6;
					--ms-text-muted: #9ca3af;
					--ms-text-light: #6b7280;
					--ms-bg: #1f2937;
					--ms-bg-light: #374151;
					--ms-bg-gray: #4b5563;
					--ms-border: #4b5563;
				}
			}

			/* Schedule Button */
			.mail-scheduler-btn {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 6px 12px;
				font-size: 14px;
				font-weight: 500;
				color: var(--ms-text, #1f2937);
				background: var(--ms-bg, white);
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s ease;
				user-select: none;
			}

			.mail-scheduler-btn:hover {
				background: var(--ms-bg-light, #f9fafb);
				border-color: var(--ms-text-muted, #9ca3af);
			}

			.mail-scheduler-btn:focus {
				outline: 2px solid var(--ms-primary, #2563eb);
				outline-offset: 2px;
			}

			.mail-scheduler-btn:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}

			.mail-scheduler-btn svg {
				width: 16px;
				height: 16px;
				flex-shrink: 0;
			}

			/* Dropdown Menu */
			.mail-scheduler-dropdown {
				position: relative;
				display: inline-block;
			}

			.mail-scheduler-menu {
				position: absolute;
				bottom: calc(100% + 4px);
				right: 0;
				min-width: 220px;
				background: var(--ms-bg, white);
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				box-shadow: 0 10px 15px -3px var(--ms-shadow, rgba(0,0,0,0.1)), 
				            0 4px 6px -2px var(--ms-shadow, rgba(0,0,0,0.05));
				z-index: 99999;
				padding: 4px;
				opacity: 0;
				visibility: hidden;
				transform: translateY(8px);
				transition: all 0.15s ease;
			}

			.mail-scheduler-dropdown.open .mail-scheduler-menu {
				opacity: 1;
				visibility: visible;
				transform: translateY(0);
			}

			.mail-scheduler-menu-item {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 10px 12px;
				font-size: 13px;
				color: var(--ms-text, #374151);
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.1s ease;
			}

			.mail-scheduler-menu-item:hover,
			.mail-scheduler-menu-item:focus {
				background: var(--ms-bg-gray, #f3f4f6);
				outline: none;
			}

			.mail-scheduler-menu-item svg {
				width: 16px;
				height: 16px;
				color: var(--ms-text-muted, #6b7280);
				flex-shrink: 0;
			}

			.mail-scheduler-menu-item .label {
				flex: 1;
			}

			.mail-scheduler-menu-item .sublabel {
				font-size: 11px;
				color: var(--ms-text-light, #9ca3af);
			}

			.mail-scheduler-divider {
				height: 1px;
				background: var(--ms-border, #e5e7eb);
				margin: 4px 0;
			}

			/* Modal */
			.mail-scheduler-modal-overlay {
				position: fixed;
				inset: 0;
				background: rgba(0, 0, 0, 0.5);
				backdrop-filter: blur(2px);
				z-index: 999999;
				display: flex;
				align-items: center;
				justify-content: center;
				opacity: 0;
				visibility: hidden;
				transition: all 0.2s ease;
			}

			.mail-scheduler-modal-overlay.open {
				opacity: 1;
				visibility: visible;
			}

			.mail-scheduler-modal {
				background: var(--ms-bg, white);
				border-radius: 12px;
				box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
				max-width: 420px;
				width: 100%;
				max-height: 90vh;
				overflow: auto;
				transform: scale(0.95);
				transition: transform 0.2s ease;
			}

			.mail-scheduler-modal-overlay.open .mail-scheduler-modal {
				transform: scale(1);
			}

			.mail-scheduler-modal-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 16px 20px;
				border-bottom: 1px solid var(--ms-border, #e5e7eb);
			}

			.mail-scheduler-modal-title {
				font-size: 16px;
				font-weight: 600;
				color: var(--ms-text, #111827);
			}

			.mail-scheduler-modal-close {
				padding: 4px;
				border: none;
				background: transparent;
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.1s ease;
				color: var(--ms-text-muted, #6b7280);
			}

			.mail-scheduler-modal-close:hover,
			.mail-scheduler-modal-close:focus {
				background: var(--ms-bg-gray, #f3f4f6);
				outline: none;
			}

			.mail-scheduler-modal-body {
				padding: 20px;
			}

			.mail-scheduler-modal-footer {
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				padding: 16px 20px;
				border-top: 1px solid var(--ms-border, #e5e7eb);
			}

			/* Quick Options */
			.mail-scheduler-quick-options {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 8px;
				margin-bottom: 16px;
			}

			.mail-scheduler-quick-option {
				display: flex;
				flex-direction: column;
				align-items: center;
				padding: 12px 8px;
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s ease;
				background: var(--ms-bg, white);
			}

			.mail-scheduler-quick-option:hover,
			.mail-scheduler-quick-option:focus {
				border-color: var(--ms-primary, #2563eb);
				background: var(--ms-primary-light, #eff6ff);
				outline: none;
			}

			.mail-scheduler-quick-option.selected {
				border-color: var(--ms-primary, #2563eb);
				background: var(--ms-primary-light, #eff6ff);
			}

			.mail-scheduler-quick-option svg {
				width: 20px;
				height: 20px;
				margin-bottom: 4px;
				color: var(--ms-text-muted, #6b7280);
			}

			.mail-scheduler-quick-option .label {
				font-size: 12px;
				font-weight: 500;
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-quick-option .time {
				font-size: 11px;
				color: var(--ms-text-muted, #9ca3af);
			}

			/* Calendar */
			.mail-scheduler-calendar {
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				padding: 12px;
				margin-bottom: 16px;
			}

			.mail-scheduler-calendar-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				margin-bottom: 12px;
			}

			.mail-scheduler-calendar-nav {
				padding: 4px 8px;
				border: none;
				background: transparent;
				border-radius: 6px;
				cursor: pointer;
				transition: background 0.1s ease;
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-calendar-nav:hover,
			.mail-scheduler-calendar-nav:focus {
				background: var(--ms-bg-gray, #f3f4f6);
				outline: none;
			}

			.mail-scheduler-calendar-month {
				font-weight: 600;
				font-size: 14px;
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-calendar-weekdays {
				display: grid;
				grid-template-columns: repeat(7, 1fr);
				gap: 2px;
				margin-bottom: 4px;
			}

			.mail-scheduler-calendar-weekday {
				text-align: center;
				font-size: 11px;
				font-weight: 500;
				color: var(--ms-text-muted, #9ca3af);
				padding: 4px;
			}

			.mail-scheduler-calendar-days {
				display: grid;
				grid-template-columns: repeat(7, 1fr);
				gap: 2px;
			}

			.mail-scheduler-calendar-day {
				aspect-ratio: 1;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 13px;
				border-radius: 50%;
				transition: all 0.1s ease;
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-calendar-day:hover:not(.disabled):not(.other-month) {
				background: var(--ms-bg-gray, #f3f4f6);
			}

			.mail-scheduler-calendar-day:focus:not(.disabled):not(.other-month) {
				outline: 2px solid var(--ms-primary, #2563eb);
				outline-offset: 2px;
			}

			.mail-scheduler-calendar-day.other-month {
				color: var(--ms-text-light, #d1d5db);
			}

			.mail-scheduler-calendar-day.today {
				font-weight: 700;
				color: var(--ms-primary, #2563eb);
			}

			.mail-scheduler-calendar-day.selected {
				background: var(--ms-primary, #2563eb) !important;
				color: white !important;
			}

			.mail-scheduler-calendar-day.disabled {
				color: var(--ms-text-light, #d1d5db);
				cursor: not-allowed;
			}

			/* Time Picker */
			.mail-scheduler-time {
				margin-bottom: 16px;
			}

			.mail-scheduler-time-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				margin-bottom: 8px;
			}

			.mail-scheduler-time-label {
				font-size: 13px;
				font-weight: 500;
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-time-format {
				display: flex;
				gap: 4px;
			}

			.mail-scheduler-time-format button {
				padding: 2px 8px;
				font-size: 11px;
				border-radius: 4px;
				border: none;
				cursor: pointer;
				transition: all 0.1s ease;
				background: transparent;
				color: var(--ms-text-muted, #6b7280);
			}

			.mail-scheduler-time-format button:hover,
			.mail-scheduler-time-format button:focus {
				background: var(--ms-bg-gray, #e5e7eb);
				outline: none;
			}

			.mail-scheduler-time-format button.active {
				background: var(--ms-bg-gray, #e5e7eb);
				color: var(--ms-text, #374151);
			}

			.mail-scheduler-time-inputs {
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.mail-scheduler-time-inputs select {
				flex: 1;
				padding: 8px 12px;
				font-size: 14px;
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				background: var(--ms-bg, white);
				color: var(--ms-text, #374151);
				cursor: pointer;
			}

			.mail-scheduler-time-inputs select:focus {
				outline: none;
				border-color: var(--ms-primary, #2563eb);
				box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
			}

			.mail-scheduler-time-separator {
				font-weight: 600;
				color: var(--ms-text-muted, #9ca3af);
			}

			.hidden {
				display: none !important;
			}

			/* Summary */
			.mail-scheduler-summary {
				background: var(--ms-bg-light, #f9fafb);
				border-radius: 8px;
				padding: 12px;
				display: flex;
				gap: 12px;
			}

			.mail-scheduler-summary svg {
				width: 20px;
				height: 20px;
				color: var(--ms-primary, #2563eb);
				flex-shrink: 0;
			}

			.mail-scheduler-summary-text {
				font-size: 13px;
				color: var(--ms-text-muted, #6b7280);
			}

			.mail-scheduler-summary-date {
				font-weight: 600;
				color: var(--ms-text, #111827);
				margin-top: 2px;
			}

			.mail-scheduler-summary-relative {
				font-size: 12px;
				color: var(--ms-text-muted, #9ca3af);
				margin-top: 4px;
			}

			.mail-scheduler-summary-relative.error {
				color: var(--ms-error, #dc2626);
			}

			/* Buttons */
			.mail-scheduler-btn-primary {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 8px 16px;
				font-size: 14px;
				font-weight: 500;
				color: white;
				background: var(--ms-primary, #2563eb);
				border: none;
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s ease;
			}

			.mail-scheduler-btn-primary:hover {
				background: var(--ms-primary-dark, #1d4ed8);
			}

			.mail-scheduler-btn-primary:focus {
				outline: 2px solid var(--ms-primary, #2563eb);
				outline-offset: 2px;
			}

			.mail-scheduler-btn-primary:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}

			.mail-scheduler-btn-primary svg {
				width: 16px;
				height: 16px;
			}

			.mail-scheduler-btn-secondary {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 8px 16px;
				font-size: 14px;
				font-weight: 500;
				color: var(--ms-text, #374151);
				background: var(--ms-bg, white);
				border: 1px solid var(--ms-border, #e5e7eb);
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s ease;
			}

			.mail-scheduler-btn-secondary:hover {
				background: var(--ms-bg-light, #f9fafb);
			}

			.mail-scheduler-btn-secondary:focus {
				outline: 2px solid var(--ms-primary, #2563eb);
				outline-offset: 2px;
			}

			/* Sidebar Scheduled Folder */
			.mail-scheduler-sidebar-item {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 8px 12px;
				margin: 2px 8px;
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s ease;
				color: var(--ms-text, #374151);
				font-size: 14px;
			}

			.mail-scheduler-sidebar-item:hover,
			.mail-scheduler-sidebar-item:focus {
				background: var(--ms-bg-gray, #f3f4f6);
				outline: none;
			}

			.mail-scheduler-sidebar-item.active {
				background: var(--ms-primary-light, #eff6ff);
				color: var(--ms-primary, #2563eb);
			}

			.mail-scheduler-sidebar-item svg {
				width: 18px;
				height: 18px;
				flex-shrink: 0;
			}

			.mail-scheduler-sidebar-count {
				margin-left: auto;
				background: var(--ms-bg-gray, #e5e7eb);
				color: var(--ms-text-muted, #6b7280);
				padding: 2px 8px;
				border-radius: 12px;
				font-size: 12px;
				font-weight: 500;
				min-width: 20px;
				text-align: center;
			}

			/* Scheduled Badge */
			.mail-scheduler-badge {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				padding: 2px 8px;
				background: #fef3c7;
				color: #92400e;
				border-radius: 9999px;
				font-size: 11px;
				font-weight: 500;
			}

			/* Fallback Toast */
			.mail-scheduler-toast {
				position: fixed;
				bottom: 20px;
				right: 20px;
				padding: 12px 20px;
				border-radius: 8px;
				background: var(--ms-bg, white);
				border: 1px solid var(--ms-border, #e5e7eb);
				box-shadow: 0 10px 15px -3px var(--ms-shadow, rgba(0,0,0,0.1));
				z-index: 9999999;
				opacity: 0;
				transform: translateY(10px);
				transition: all 0.3s ease;
			}

			.mail-scheduler-toast.show {
				opacity: 1;
				transform: translateY(0);
			}

			.mail-scheduler-toast-success {
				border-left: 4px solid var(--ms-success, #16a34a);
			}

			.mail-scheduler-toast-error {
				border-left: 4px solid var(--ms-error, #dc2626);
			}

			.mail-scheduler-toast-warning {
				border-left: 4px solid var(--ms-warning, #d97706);
			}

			.mail-scheduler-toast strong {
				display: block;
				color: var(--ms-text, #374151);
				margin-bottom: 4px;
			}

			.mail-scheduler-toast span {
				font-size: 13px;
				color: var(--ms-text-muted, #6b7280);
			}

			/* Reduced motion support */
			@media (prefers-reduced-motion: reduce) {
				.mail-scheduler-modal-overlay,
				.mail-scheduler-modal,
				.mail-scheduler-menu,
				.mail-scheduler-btn,
				.mail-scheduler-toast {
					transition: none;
				}
			}
		`;

		document.head.appendChild(style);
		Logger.debug("Styles injected");
	}

	// ============================================================
	// PUBLIC API
	// ============================================================

	function exposeApi() {
		window.mailScheduler = {
			version: VERSION,
			config: { ...config },

			// Core methods
			formatScheduledDate,
			validateScheduleDate,

			getMaxScheduleDate: () => {
				const maxDate = new Date();
				maxDate.setDate(maxDate.getDate() + config.max_schedule_days);
				return maxDate;
			},

			// API methods with proper error handling
			scheduleEmail: async (mailData, scheduledAt) => {
				const validation = validateScheduleDate(new Date(scheduledAt));
				if (!validation.isValid) {
					throw new Error(validation.error);
				}

				if (isRateLimited()) {
					throw new Error("Rate limited. Please try again.");
				}

				recordRequest();

				return frappe.call({
					method: ENDPOINTS.CREATE_MAIL,
					args: { ...mailData, scheduled_at: scheduledAt },
				});
			},

			cancelScheduledEmail: async (emailId) => {
				if (!emailId) {
					throw new Error("Email ID is required");
				}

				if (isRateLimited()) {
					throw new Error("Rate limited. Please try again.");
				}

				recordRequest();

				return frappe.call({
					method: ENDPOINTS.CANCEL_SCHEDULED,
					args: { email_id: emailId },
				});
			},

			getScheduledEmails: async (limit = 20, offset = 0) => {
				return frappe.call({
					method: ENDPOINTS.GET_SCHEDULED,
					args: {
						limit: Math.min(Math.max(limit, 1), 100),
						offset: Math.max(offset, 0),
					},
				});
			},

			rescheduleEmail: async (emailId, newScheduledAt) => {
				if (!emailId) {
					throw new Error("Email ID is required");
				}

				const validation = validateScheduleDate(new Date(newScheduledAt));
				if (!validation.isValid) {
					throw new Error(validation.error);
				}

				if (isRateLimited()) {
					throw new Error("Rate limited. Please try again.");
				}

				recordRequest();

				return frappe.call({
					method: ENDPOINTS.RESCHEDULE,
					args: { email_id: emailId, scheduled_at: newScheduledAt },
				});
			},

			refreshCount: debouncedLoadScheduledCount,

			// For testing/debugging
			_debug: {
				getState: () => ({ ...State._state }),
				getConfig: () => ({ ...config }),
				isRateLimited,
				applyPatches,
				removePatches,
				Logger,
			},
		};

		Logger.info(`API exposed at window.mailScheduler (v${VERSION})`);
	}

	// ============================================================
	// SVG ICONS
	// ============================================================

	const icons = {
		clock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
		chevronUp: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
		chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
		chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
		sunrise: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>`,
		sun: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
		calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
		send: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>`,
		x: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
	};

	// ============================================================
	// INITIALIZATION
	// ============================================================

	function init() {
		if (!config.enabled) {
			Logger.info("Mail Scheduler is disabled by configuration");
			return;
		}

		if (State.get("isInitialized")) {
			Logger.debug("Already initialized, skipping");
			return;
		}

		Logger.info(`Initializing Mail Scheduler v${VERSION}...`);

		try {
			// Inject styles
			addStyles();

			// Set up DOM observers
			setupObservers();

			// Apply API patches
			applyPatches();

			// Expose public API
			exposeApi();

			State.set("isInitialized", true);
			Logger.info("Mail Scheduler initialized successfully");
		} catch (e) {
			Logger.error("Failed to initialize Mail Scheduler:", e);
		}
	}

	// Cleanup on page unload
	function cleanup() {
		Logger.debug("Cleaning up...");
		cleanupObservers();
		removePatches();
		State.reset();
	}

	// Initialize when DOM is ready
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		// Small delay to ensure frappe is loaded
		setTimeout(init, 100);
	}

	// Also initialize on frappe ready if available
	if (typeof frappe !== "undefined" && frappe.ready) {
		frappe.ready(init);
	}

	// Cleanup on page unload
	window.addEventListener("beforeunload", cleanup);
	window.addEventListener("unload", cleanup);
})();
