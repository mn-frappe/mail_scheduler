(()=>{var w=Object.defineProperty,S=Object.defineProperties;var _=Object.getOwnPropertyDescriptors;var n=Object.getOwnPropertySymbols;var v=Object.prototype.hasOwnProperty,D=Object.prototype.propertyIsEnumerable;var c=(r,l,d)=>l in r?w(r,l,{enumerable:!0,configurable:!0,writable:!0,value:d}):r[l]=d,u=(r,l)=>{for(var d in l||(l={}))v.call(l,d)&&c(r,d,l[d]);if(n)for(var d of n(l))D.call(l,d)&&c(r,d,l[d]);return r},s=(r,l)=>S(r,_(l));(function(){"use strict";let r=frappe.boot.mail_scheduler||{enabled:!0,max_schedule_days:30};if(!r.enabled)return;let l=null;frappe.ready(function(){typeof frappe.mail=="undefined"?setTimeout(d,1e3):d()});function d(){console.log("Mail Scheduler: Initializing..."),m(),p()}function m(){let e=document.createElement("style");e.textContent=`
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
		`,document.head.appendChild(e)}function p(){console.log("Mail Scheduler: Ready to extend compose toolbar"),window.mailScheduler={config:r,scheduleEmail:h,cancelScheduledEmail:g,updateScheduledEmail:f,getScheduledEmails:b}}async function h(e,a){return frappe.call({method:"mail_scheduler.api.mail.create_mail",args:s(u({},e),{scheduled_at:a})})}async function g(e){return frappe.call({method:"mail_scheduler.api.mail.cancel_scheduled_mail",args:{mail_queue_name:e}})}async function f(e,a){return frappe.call({method:"mail_scheduler.api.mail.update_scheduled_mail",args:{mail_queue_name:e,new_scheduled_at:a}})}async function b(e=20,a=0){return frappe.call({method:"mail_scheduler.api.mail.get_scheduled_mails",args:{limit:e,offset:a}})}function x(){let e=r.max_schedule_days||30,a=new Date;return a.setDate(a.getDate()+e),a}function y(e){let a=new Date(e),t=new Date,i=new Date(t);i.setDate(i.getDate()+1);let o=a.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});return a.toDateString()===t.toDateString()?`Today at ${o}`:a.toDateString()===i.toDateString()?`Tomorrow at ${o}`:a.toLocaleDateString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}window.mailScheduler=window.mailScheduler||{},window.mailScheduler.formatScheduledDate=y,window.mailScheduler.getMaxScheduleDate=x})();})();
//# sourceMappingURL=mail_scheduler.bundle.OKP5LHHE.js.map
