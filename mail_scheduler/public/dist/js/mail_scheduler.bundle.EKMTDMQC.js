(()=>{var Re=Object.defineProperty,Fe=Object.defineProperties;var ze=Object.getOwnPropertyDescriptors;var he=Object.getOwnPropertySymbols;var He=Object.prototype.hasOwnProperty,je=Object.prototype.propertyIsEnumerable;var pe=(k,S,D)=>S in k?Re(k,S,{enumerable:!0,configurable:!0,writable:!0,value:D}):k[S]=D,q=(k,S)=>{for(var D in S||(S={}))He.call(S,D)&&pe(k,D,S[D]);if(he)for(var D of he(S))je.call(S,D)&&pe(k,D,S[D]);return k},W=(k,S)=>Fe(k,ze(S));(function(){var se,de,ce;"use strict";let k="2.0.0",C=(()=>{var e;return window.mail_scheduler?window.mail_scheduler:typeof frappe!="undefined"&&((e=frappe==null?void 0:frappe.boot)==null?void 0:e.mail_scheduler)?frappe.boot.mail_scheduler:{}})(),E=Object.freeze({enabled:(se=C==null?void 0:C.enabled)!=null?se:!0,max_schedule_days:Math.min(Math.max((de=C==null?void 0:C.max_schedule_days)!=null?de:30,1),365),min_schedule_minutes:(ce=C==null?void 0:C.min_schedule_minutes)!=null?ce:1,retry_attempts:3,retry_delay_ms:1e3,api_timeout_ms:3e4,debounce_ms:300,toast_duration_ms:5e3}),v=Object.freeze({CREATE_MAIL:"mail_scheduler.api.mail.create_mail",UPDATE_DRAFT:"mail_scheduler.api.mail.update_draft_mail",GET_SCHEDULED:"mail_scheduler.api.scheduled.get_scheduled_emails",CANCEL_SCHEDULED:"mail_scheduler.api.scheduled.cancel_scheduled_email",RESCHEDULE:"mail_scheduler.api.scheduled.reschedule_email",ORIGINAL_CREATE:"mail.api.mail.create_mail",ORIGINAL_UPDATE:"mail.api.mail.update_draft_mail"}),R={requests:[],maxRequests:60,windowMs:6e4},l={_prefix:"[Mail Scheduler]",_format(e,...r){let t=new Date().toISOString();return[`${this._prefix} [${e}] [${t}]`,...r]},debug(...e){console.debug(...this._format("DEBUG",...e))},info(...e){console.log(...this._format("INFO",...e))},warn(...e){console.warn(...this._format("WARN",...e))},error(...e){console.error(...this._format("ERROR",...e))},trackError(e,r={}){this.error("Error tracked:",e.message,r)}};function M(e){if(typeof e!="string")return"";let r=document.createElement("div");return r.textContent=e,r.innerHTML}function fe(e,r){let t;return function(...i){let s=()=>{clearTimeout(t),e.apply(this,i)};clearTimeout(t),t=setTimeout(s,r)}}function F(){let e=Date.now();return R.requests=R.requests.filter(r=>e-r<R.windowMs),R.requests.length>=R.maxRequests}function H(){R.requests.push(Date.now())}function I(e){if(!(e instanceof Date)||isNaN(e.getTime()))return{isValid:!1,error:"Invalid date provided"};let r=new Date,t=new Date(r.getTime()+E.min_schedule_minutes*60*1e3),a=new Date(r.getTime()+E.max_schedule_days*24*60*60*1e3);return e<t?{isValid:!1,error:`Schedule time must be at least ${E.min_schedule_minutes} minute(s) in the future`}:e>a?{isValid:!1,error:`Cannot schedule more than ${E.max_schedule_days} days in the future`}:{isValid:!0,error:null}}async function ge(e,r=E.retry_attempts,t=E.retry_delay_ms){let a;for(let i=1;i<=r;i++)try{return await e()}catch(s){if(a=s,l.warn(`Attempt ${i}/${r} failed:`,s.message),i<r){let o=t*Math.pow(2,i-1);l.debug(`Retrying in ${o}ms...`),await new Promise(n=>setTimeout(n,o))}}throw a}function B(e){try{let r=e instanceof Date?e:new Date(e);return isNaN(r.getTime())?"Invalid date":r.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}catch(r){return l.error("Error formatting date:",r),"Unknown"}}function be(e){let r=new Date,t=e-r;if(t<0)return"Time is in the past";let a=Math.floor(t/(1e3*60)),i=Math.floor(t/(1e3*60*60)),s=Math.floor(t/(1e3*60*60*24));if(s>0)return`in ${s} day${s>1?"s":""}`;if(i>0){let o=a%60;return`in ${i} hour${i>1?"s":""} and ${o} minute${o!==1?"s":""}`}else return`in ${a} minute${a!==1?"s":""}`}let p={_observers:[],_state:{scheduleModalOpen:!1,selectedScheduleTime:null,pendingScheduledAt:null,scheduledCount:0,isInitialized:!1,patchesApplied:!1},get(e){return this._state[e]},set(e,r){let t=this._state[e];this._state[e]=r,l.debug(`State changed: ${e}`,{old:t,new:r}),this._notifyObservers(e,r,t)},subscribe(e){return this._observers.push(e),()=>{this._observers=this._observers.filter(r=>r!==e)}},_notifyObservers(e,r,t){this._observers.forEach(a=>{try{a(e,r,t)}catch(i){l.error("Error in state observer:",i)}})},reset(){this._state={scheduleModalOpen:!1,selectedScheduleTime:null,pendingScheduledAt:null,scheduledCount:0,isInitialized:!1,patchesApplied:!1},l.debug("State reset")}},$=null,O=null;function ve(){if($){l.debug("Fetch already patched, skipping");return}$=window.fetch,window.fetch=async function(e,r={}){let t=p.get("pendingScheduledAt");if(t&&(r==null?void 0:r.body)&&(r==null?void 0:r.method)==="POST"){let a=String(e),i=a.includes(`/api/method/${v.ORIGINAL_CREATE}`),s=a.includes(`/api/method/${v.ORIGINAL_UPDATE}`);if(i||s){if(l.info("Intercepting fetch call:",a),l.debug("Pending scheduled_at:",t),F())throw l.warn("Rate limited, rejecting request"),new Error("Too many requests. Please try again in a moment.");try{let o;try{o=typeof r.body=="string"?JSON.parse(r.body):r.body}catch(h){return l.error("Failed to parse request body:",h),p.set("pendingScheduledAt",null),$.call(this,e,r)}let n=i?v.CREATE_MAIL:v.UPDATE_DRAFT,g=a.replace(i?v.ORIGINAL_CREATE:v.ORIGINAL_UPDATE,n);l.info("Redirecting to:",g),o.scheduled_at=t;let _=t;p.set("pendingScheduledAt",null);let f=W(q({},r),{body:JSON.stringify(o)});H();let y=await ge(async()=>{let h=await $.call(this,g,f);if(!h.ok&&h.status>=500)throw new Error(`Server error: ${h.status}`);return h});if(y.ok)setTimeout(()=>{L("Email Scheduled",`Your email will be sent on ${B(_)}`,"success"),V()},100);else try{let h=await y.clone().json(),T=(h==null?void 0:h.exception)||(h==null?void 0:h.message)||"Failed to schedule email";l.error("API error:",T),L("Scheduling Failed",M(T),"error")}catch(h){L("Scheduling Failed","An unexpected error occurred","error")}return y}catch(o){throw l.error("Error intercepting fetch:",o),p.set("pendingScheduledAt",null),L("Scheduling Failed",M(o.message),"error"),o}}}return $.call(this,e,r)},l.info("Patched window.fetch for API interception")}function xe(){if(typeof frappe=="undefined"||!frappe.call){l.debug("frappe.call not available, skipping patch");return}if(O){l.debug("frappe.call already patched, skipping");return}O=frappe.call,frappe.call=function(e){let r=p.get("pendingScheduledAt");if(r){let t=e.method||e.args&&e.args.method;if(t===v.ORIGINAL_CREATE||t===v.ORIGINAL_UPDATE){if(l.info("Intercepting frappe.call:",t),F())return l.warn("Rate limited, rejecting request"),e.error&&e.error({message:"Too many requests"}),Promise.reject(new Error("Too many requests"));let a=q({},e);a.method=t===v.ORIGINAL_CREATE?v.CREATE_MAIL:v.UPDATE_DRAFT,a.args=W(q({},e.args),{scheduled_at:r});let i=r;p.set("pendingScheduledAt",null);let s=a.callback||a.success;a.callback=function(n){L("Email Scheduled",`Your email will be sent on ${B(i)}`,"success"),V(),s&&s.call(this,n)};let o=a.error;return a.error=function(n){let g=(n==null?void 0:n.message)||"Failed to schedule email";L("Scheduling Failed",M(g),"error"),o&&o.call(this,n)},H(),O.call(this,a)}}return O.call(this,e)},l.info("Patched frappe.call for API interception")}function K(){if(p.get("patchesApplied")){l.debug("Patches already applied, skipping");return}ve(),xe(),p.set("patchesApplied",!0),l.info("All API patches applied")}function ae(){$&&(window.fetch=$,$=null),O&&typeof frappe!="undefined"&&(frappe.call=O,O=null),p.set("patchesApplied",!1),l.info("Patches removed")}function L(e,r,t="success"){let a={success:"green",error:"red",warning:"orange",info:"blue"};if(typeof frappe!="undefined"&&frappe.toast)frappe.toast({title:M(e),message:M(r),indicator:a[t]||"blue"});else{let i=document.createElement("div");i.className=`mail-scheduler-toast mail-scheduler-toast-${t}`,i.innerHTML=`
				<strong>${M(e)}</strong>
				<span>${M(r)}</span>
			`,document.body.appendChild(i),setTimeout(()=>{i.classList.add("show")},10),setTimeout(()=>{i.classList.remove("show"),setTimeout(()=>i.remove(),300)},E.toast_duration_ms)}}function G(e){let r=new Date,t=new Date(r);switch(t.setDate(t.getDate()+1),e){case"tomorrow-am":return t.setHours(8,0,0,0),t;case"tomorrow-pm":return t.setHours(13,0,0,0),t;case"monday-am":{let a=new Date(r),i=(8-r.getDay())%7||7;return a.setDate(a.getDate()+i),a.setHours(8,0,0,0),a}default:return t.setHours(9,0,0,0),t}}function X(e){return B(G(e))}function ye(){return`
			<button class="mail-scheduler-btn" type="button" aria-haspopup="true" aria-expanded="false">
				${x.clock}
				<span>Schedule</span>
				${x.chevronUp}
			</button>
			<div class="mail-scheduler-menu" role="menu">
				<div class="mail-scheduler-menu-item" data-action="tomorrow-am" role="menuitem" tabindex="-1">
					${x.sunrise}
					<div>
						<div class="label">Tomorrow morning</div>
						<div class="sublabel">${M(X("tomorrow-am"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-menu-item" data-action="tomorrow-pm" role="menuitem" tabindex="-1">
					${x.sun}
					<div>
						<div class="label">Tomorrow afternoon</div>
						<div class="sublabel">${M(X("tomorrow-pm"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-menu-item" data-action="monday-am" role="menuitem" tabindex="-1">
					${x.calendar}
					<div>
						<div class="label">Monday morning</div>
						<div class="sublabel">${M(X("monday-am"))}</div>
					</div>
				</div>
				<div class="mail-scheduler-divider" role="separator"></div>
				<div class="mail-scheduler-menu-item" data-action="custom" role="menuitem" tabindex="-1">
					${x.clock}
					<div class="label">Pick date & time...</div>
				</div>
			</div>
		`}function we(e,r){if(e.querySelector(".mail-scheduler-dropdown")){l.debug("Schedule button already exists, skipping injection");return}let t=document.createElement("div");t.className="mail-scheduler-dropdown",t.innerHTML=ye(),r.parentNode.insertBefore(t,r);let a=t.querySelector(".mail-scheduler-btn"),i=t.querySelector(".mail-scheduler-menu");a.addEventListener("click",o=>{o.stopPropagation();let n=t.classList.toggle("open");if(a.setAttribute("aria-expanded",n),n){let g=i.querySelector(".mail-scheduler-menu-item");g&&g.focus()}}),t.addEventListener("keydown",o=>{var _,f,y;if(!t.classList.contains("open"))return;let n=[...i.querySelectorAll(".mail-scheduler-menu-item")],g=n.indexOf(document.activeElement);switch(o.key){case"ArrowDown":o.preventDefault(),(_=n[(g+1)%n.length])==null||_.focus();break;case"ArrowUp":o.preventDefault(),(f=n[(g-1+n.length)%n.length])==null||f.focus();break;case"Escape":t.classList.remove("open"),a.setAttribute("aria-expanded","false"),a.focus();break;case"Enter":o.preventDefault(),(y=document.activeElement)==null||y.click();break}});let s=o=>{t.contains(o.target)||(t.classList.remove("open"),a.setAttribute("aria-expanded","false"))};document.addEventListener("click",s),t._cleanup=()=>{document.removeEventListener("click",s)},i.querySelectorAll(".mail-scheduler-menu-item").forEach(o=>{o.addEventListener("click",n=>{n.stopPropagation();let g=o.dataset.action;if(t.classList.remove("open"),a.setAttribute("aria-expanded","false"),g==="custom")ke(r);else{let _=G(g),f=I(_);if(!f.isValid){L("Invalid Schedule Time",f.error,"error");return}ie(r,_)}})}),l.info("Schedule button injected successfully")}function ke(e){let r=document.querySelector(".mail-scheduler-modal-overlay");r&&r.remove(),p.set("scheduleModalOpen",!0);let t=document.createElement("div");t.className="mail-scheduler-modal-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-labelledby","mail-scheduler-modal-title"),t.innerHTML=Se(),document.body.appendChild(t);let a=t.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),i=a[0],s=a[a.length-1];t.addEventListener("keydown",n=>{n.key==="Tab"&&(n.shiftKey&&document.activeElement===i?(n.preventDefault(),s.focus()):!n.shiftKey&&document.activeElement===s&&(n.preventDefault(),i.focus())),n.key==="Escape"&&o()}),requestAnimationFrame(()=>{t.classList.add("open"),Ee(t,e),i==null||i.focus()});function o(){p.set("scheduleModalOpen",!1),t.classList.remove("open"),setTimeout(()=>{t.remove()},200)}t._close=o}function Se(){let e=localStorage.getItem("mailSchedulerTimeFormat")||"12h";return`
			<div class="mail-scheduler-modal">
				<div class="mail-scheduler-modal-header">
					<div class="mail-scheduler-modal-title" id="mail-scheduler-modal-title">Schedule Send</div>
					<button class="mail-scheduler-modal-close" type="button" aria-label="Close dialog">
						${x.x}
					</button>
				</div>
				<div class="mail-scheduler-modal-body">
					<!-- Quick Options -->
					<div class="mail-scheduler-quick-options" role="group" aria-label="Quick schedule options">
						<div class="mail-scheduler-quick-option" data-action="tomorrow-am" role="button" tabindex="0">
							${x.sunrise}
							<div class="label">Tomorrow</div>
							<div class="time">8:00 AM</div>
						</div>
						<div class="mail-scheduler-quick-option" data-action="tomorrow-pm" role="button" tabindex="0">
							${x.sun}
							<div class="label">Tomorrow</div>
							<div class="time">1:00 PM</div>
						</div>
						<div class="mail-scheduler-quick-option" data-action="monday-am" role="button" tabindex="0">
							${x.calendar}
							<div class="label">Monday</div>
							<div class="time">8:00 AM</div>
						</div>
					</div>

					<!-- Calendar -->
					<div class="mail-scheduler-calendar" role="application" aria-label="Calendar">
						<div class="mail-scheduler-calendar-header">
							<button class="mail-scheduler-calendar-nav" data-action="prev" type="button" aria-label="Previous month">
								${x.chevronLeft}
							</button>
							<div class="mail-scheduler-calendar-month" aria-live="polite"></div>
							<button class="mail-scheduler-calendar-nav" data-action="next" type="button" aria-label="Next month">
								${x.chevronRight}
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
								<button data-format="12h" type="button" class="${e==="12h"?"active":""}" aria-pressed="${e==="12h"}">12h</button>
								<button data-format="24h" type="button" class="${e==="24h"?"active":""}" aria-pressed="${e==="24h"}">24h</button>
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
							<select class="mail-scheduler-period ${e==="24h"?"hidden":""}" aria-label="AM/PM">
								<option value="AM">AM</option>
								<option value="PM">PM</option>
							</select>
						</div>
					</div>

					<!-- Summary -->
					<div class="mail-scheduler-summary" role="status" aria-live="polite">
						${x.clock}
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
						${x.send}
						Schedule Send
					</button>
				</div>
			</div>
		`}function Ee(e,r){let t=e.querySelector(".mail-scheduler-modal"),a=t.querySelector(".mail-scheduler-calendar-month"),i=t.querySelector(".mail-scheduler-calendar-days"),s=t.querySelector(".mail-scheduler-hour"),o=t.querySelector(".mail-scheduler-minute"),n=t.querySelector(".mail-scheduler-period"),g=t.querySelector(".mail-scheduler-summary-date"),_=t.querySelector(".mail-scheduler-summary-relative"),f=new Date().getMonth(),y=new Date().getFullYear(),h=new Date;h.setDate(h.getDate()+1);let T=localStorage.getItem("mailSchedulerTimeFormat")||"12h";function ue(){if(s.innerHTML="",T==="12h")for(let d=1;d<=12;d++){let c=document.createElement("option");c.value=d,c.textContent=d,s.appendChild(c)}else for(let d=0;d<24;d++){let c=document.createElement("option");c.value=d,c.textContent=d.toString().padStart(2,"0"),s.appendChild(c)}}function U(){let d=["January","February","March","April","May","June","July","August","September","October","November","December"];a.textContent=`${d[f]} ${y}`;let c=new Date(y,f,1),u=new Date(y,f+1,0),w=c.getDay(),m=new Date;m.setHours(0,0,0,0);let z=new Date;z.setDate(z.getDate()+E.max_schedule_days);let Q="",Ce=new Date(y,f,0);for(let b=w-1;b>=0;b--)Q+=`<div class="mail-scheduler-calendar-day other-month disabled" aria-hidden="true">${Ce.getDate()-b}</div>`;for(let b=1;b<=u.getDate();b++){let A=new Date(y,f,b);A.setHours(0,0,0,0);let qe=A<m,Ie=A>z,Oe=A.getTime()===m.getTime(),te=h&&A.toDateString()===h.toDateString(),J=["mail-scheduler-calendar-day"],re=qe||Ie;re&&J.push("disabled"),Oe&&J.push("today"),te&&J.push("selected");let Pe=A.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});Q+=`<div class="${J.join(" ")}" 
					data-date="${A.toISOString()}" 
					role="gridcell" 
					tabindex="${te?"0":"-1"}"
					aria-label="${Pe}"
					aria-selected="${te}"
					aria-disabled="${re}"
					${re?"":'style="cursor: pointer"'}>${b}</div>`}let $e=42-(w+u.getDate());for(let b=1;b<=$e;b++)Q+=`<div class="mail-scheduler-calendar-day other-month disabled" aria-hidden="true">${b}</div>`;i.innerHTML=Q,i.querySelectorAll(".mail-scheduler-calendar-day:not(.disabled):not(.other-month)").forEach(b=>{b.addEventListener("click",()=>{h=new Date(b.dataset.date),U(),P(),me()}),b.addEventListener("keydown",A=>{(A.key==="Enter"||A.key===" ")&&(A.preventDefault(),b.click())})})}function ee(){let d=new Date(h),c=parseInt(s.value,10),u=parseInt(o.value,10);return T==="12h"&&(n.value==="PM"&&c!==12&&(c+=12),n.value==="AM"&&c===12&&(c=0)),d.setHours(c,u,0,0),d}function P(){let d=ee();g.textContent=d.toLocaleString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",hour12:T==="12h"}),_.textContent=be(d);let c=I(d);c.isValid?_.classList.remove("error"):(_.textContent=c.error,_.classList.add("error"))}function me(){t.querySelectorAll(".mail-scheduler-quick-option").forEach(d=>{let c=d.dataset.action,u=G(c),w=ee(),m=u.toDateString()===w.toDateString()&&u.getHours()===w.getHours()&&u.getMinutes()===w.getMinutes();d.classList.toggle("selected",m),d.setAttribute("aria-pressed",m)})}function Y(){e._close&&e._close()}ue(),U(),P(),s.value="9",n.value="AM",e.addEventListener("click",d=>{d.target===e&&Y()}),t.querySelector(".mail-scheduler-modal-close").addEventListener("click",Y),t.querySelector('[data-action="cancel"]').addEventListener("click",Y),t.querySelector('[data-action="confirm"]').addEventListener("click",()=>{let d=ee(),c=I(d);if(!c.isValid){L("Invalid Schedule Time",c.error,"error");return}Y(),ie(r,d)}),t.querySelector('[data-action="prev"]').addEventListener("click",()=>{f--,f<0&&(f=11,y--),U()}),t.querySelector('[data-action="next"]').addEventListener("click",()=>{f++,f>11&&(f=0,y++),U()}),t.querySelectorAll(".mail-scheduler-quick-option").forEach(d=>{let c=()=>{let u=d.dataset.action,w=G(u);h=w,f=w.getMonth(),y=w.getFullYear();let m=w.getHours();T==="12h"?(s.value=m>12?m-12:m===0?12:m,n.value=m>=12?"PM":"AM"):s.value=m,o.value=w.getMinutes(),U(),P(),me()};d.addEventListener("click",c),d.addEventListener("keydown",u=>{(u.key==="Enter"||u.key===" ")&&(u.preventDefault(),c())})}),t.querySelectorAll(".mail-scheduler-time-format button").forEach(d=>{d.addEventListener("click",()=>{let c=d.dataset.format;if(c===T)return;let u=parseInt(s.value,10),w=n.value;if(T=c,localStorage.setItem("mailSchedulerTimeFormat",c),t.querySelectorAll(".mail-scheduler-time-format button").forEach(m=>{let z=m.dataset.format===c;m.classList.toggle("active",z),m.setAttribute("aria-pressed",z)}),n.classList.toggle("hidden",c==="24h"),ue(),c==="24h"){let m=u;w==="PM"&&u!==12&&(m+=12),w==="AM"&&u===12&&(m=0),s.value=m}else{let m=u>12?u-12:u===0?12:u;n.value=u>=12?"PM":"AM",s.value=m}P()})}),s.addEventListener("change",P),o.addEventListener("change",P),n.addEventListener("change",P)}function ie(e,r){let t=I(r);if(!t.isValid){L("Invalid Schedule Time",t.error,"error");return}p.set("pendingScheduledAt",r.toISOString()),l.info("Scheduling email for:",r.toISOString()),K();try{e.click()}catch(a){l.error("Error clicking send button:",a),p.set("pendingScheduledAt",null),L("Error","Failed to initiate send","error");return}setTimeout(()=>{p.get("pendingScheduledAt")&&(l.warn("Clearing unused pending schedule after timeout"),p.set("pendingScheduledAt",null))},1e4)}function _e(e,r){if(e.querySelector(".mail-scheduler-sidebar-item"))return;let t=document.createElement("div");t.className="mail-scheduler-sidebar-item",t.setAttribute("role","button"),t.setAttribute("tabindex","0"),t.setAttribute("aria-label","Scheduled emails"),t.innerHTML=`
			${x.clock}
			<span>Scheduled</span>
			<span class="mail-scheduler-sidebar-count" id="mail-scheduler-count" aria-live="polite">0</span>
		`,r.nextSibling?e.insertBefore(t,r.nextSibling):e.appendChild(t);let a=()=>{typeof frappe!="undefined"&&frappe.set_route?frappe.set_route("mail","scheduled"):window.location.hash="#/mail/scheduled"};t.addEventListener("click",a),t.addEventListener("keydown",i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),a())}),V(),l.info("Scheduled folder injected into sidebar")}async function V(){try{let e=await frappe.call({method:v.GET_SCHEDULED,args:{limit:1,offset:0}});if(e!=null&&e.message){let r=e.message.total||0;p.set("scheduledCount",r);let t=document.getElementById("mail-scheduler-count");t&&(t.textContent=r,t.style.display=r>0?"inline-block":"none")}}catch(e){l.warn("Could not load scheduled count:",e.message)}}let Ae=fe(V,E.debounce_ms),j=null,N=null;function le(e){let r=e.querySelectorAll(".ml-auto.flex.items-center.space-x-2");l.debug(`Found ${r.length} potential toolbar containers`),r.forEach(t=>{if(t.querySelector(".mail-scheduler-dropdown")){l.debug("Container already has schedule button, skipping");return}let a=t.querySelectorAll("button");l.debug(`Found ${a.length} buttons in container`);let i=null;a.forEach(s=>{var n;let o=(n=s.textContent)==null?void 0:n.trim();l.debug(`Button text: "${o}"`),(o==="Send"||o.includes("Send"))&&(i=s,l.debug("Matched Send button by text")),s.innerHTML.includes("lucide")&&s.innerHTML.includes("send")&&(i=s,l.debug("Matched Send button by lucide icon"))}),i?(l.info("Found Send button, injecting Schedule button"),we(t,i)):l.debug("No Send button found in this container")})}function ne(e){e.querySelectorAll("nav, aside, [class*='sidebar']").forEach(t=>{if(t.querySelector(".mail-scheduler-sidebar-item"))return;let a=t.querySelectorAll("a, [role='button'], .cursor-pointer"),i=null,s=null;a.forEach(o=>{var g;let n=((g=o.textContent)==null?void 0:g.toLowerCase())||"";(n.includes("drafts")||n.includes("draft"))&&(i=o,s=o.parentElement)}),i&&s&&_e(s,i)})}function De(){j=new MutationObserver(r=>{le(document.body)}),j.observe(document.body,{childList:!0,subtree:!0}),N=new MutationObserver(r=>{ne(document.body)}),N.observe(document.body,{childList:!0,subtree:!0}),[500,1e3,2e3,5e3].forEach(r=>{setTimeout(()=>{le(document.body),ne(document.body)},r)}),l.info("DOM observers set up")}function Me(){j&&(j.disconnect(),j=null),N&&(N.disconnect(),N=null),l.debug("Observers cleaned up")}function Le(){if(document.getElementById("mail-scheduler-styles"))return;let e=document.createElement("style");e.id="mail-scheduler-styles",e.textContent=`
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
		`,document.head.appendChild(e),l.debug("Styles injected")}function Te(){window.mailScheduler={version:k,config:q({},E),formatScheduledDate:B,validateScheduleDate:I,getMaxScheduleDate:()=>{let e=new Date;return e.setDate(e.getDate()+E.max_schedule_days),e},scheduleEmail:async(e,r)=>{let t=I(new Date(r));if(!t.isValid)throw new Error(t.error);if(F())throw new Error("Rate limited. Please try again.");return H(),frappe.call({method:v.CREATE_MAIL,args:W(q({},e),{scheduled_at:r})})},cancelScheduledEmail:async e=>{if(!e)throw new Error("Email ID is required");if(F())throw new Error("Rate limited. Please try again.");return H(),frappe.call({method:v.CANCEL_SCHEDULED,args:{email_id:e}})},getScheduledEmails:async(e=20,r=0)=>frappe.call({method:v.GET_SCHEDULED,args:{limit:Math.min(Math.max(e,1),100),offset:Math.max(r,0)}}),rescheduleEmail:async(e,r)=>{if(!e)throw new Error("Email ID is required");let t=I(new Date(r));if(!t.isValid)throw new Error(t.error);if(F())throw new Error("Rate limited. Please try again.");return H(),frappe.call({method:v.RESCHEDULE,args:{email_id:e,scheduled_at:r}})},refreshCount:Ae,_debug:{getState:()=>q({},p._state),getConfig:()=>q({},E),isRateLimited:F,applyPatches:K,removePatches:ae,Logger:l}},l.info(`API exposed at window.mailScheduler (v${k})`)}let x={clock:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',chevronUp:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',chevronLeft:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',chevronRight:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',sunrise:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>',sun:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',calendar:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',send:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',x:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'};function Z(){if(!E.enabled){l.info("Mail Scheduler is disabled by configuration");return}if(p.get("isInitialized")){l.debug("Already initialized, skipping");return}l.info(`Initializing Mail Scheduler v${k}...`);try{Le(),De(),K(),Te(),p.set("isInitialized",!0),l.info("Mail Scheduler initialized successfully")}catch(e){l.error("Failed to initialize Mail Scheduler:",e)}}function oe(){l.debug("Cleaning up..."),Me(),ae(),p.reset()}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Z):setTimeout(Z,100),typeof frappe!="undefined"&&frappe.ready&&frappe.ready(Z),window.addEventListener("beforeunload",oe),window.addEventListener("unload",oe)})();})();
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
//# sourceMappingURL=mail_scheduler.bundle.EKMTDMQC.js.map
