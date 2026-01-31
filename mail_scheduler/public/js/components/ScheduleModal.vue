<template>
	<Dialog
		v-model="show"
		:options="{
			title: __('Schedule Send'),
			size: 'lg',
		}"
	>
		<template #body-content>
			<div class="space-y-4">
				<!-- Quick Options -->
				<div class="space-y-2">
					<label class="text-sm font-medium text-ink-gray-6">{{ __('Quick Options') }}</label>
					<div class="grid grid-cols-3 gap-2">
						<button
							v-for="option in quickOptions"
							:key="option.label"
							class="flex flex-col items-center justify-center p-3 rounded-lg border border-outline-gray-2 hover:border-outline-gray-4 hover:bg-surface-gray-1 transition-colors"
							:class="{ 'border-brand-5 bg-brand-1': isOptionSelected(option) }"
							@click="selectQuickOption(option)"
						>
							<component :is="option.icon" class="h-5 w-5 mb-1 text-ink-gray-5" />
							<span class="text-sm font-medium text-ink-gray-8">{{ option.label }}</span>
							<span class="text-xs text-ink-gray-5">{{ option.timeLabel }}</span>
						</button>
					</div>
				</div>

				<!-- Divider -->
				<div class="flex items-center gap-3">
					<div class="flex-1 border-t border-outline-gray-2"></div>
					<span class="text-xs text-ink-gray-4">{{ __('or pick a custom time') }}</span>
					<div class="flex-1 border-t border-outline-gray-2"></div>
				</div>

				<!-- Calendar -->
				<div class="space-y-2">
					<label class="text-sm font-medium text-ink-gray-6">{{ __('Date') }}</label>
					<div class="border border-outline-gray-2 rounded-lg p-3">
						<!-- Calendar Header -->
						<div class="flex items-center justify-between mb-3">
							<Button variant="ghost" size="sm" @click="prevMonth">
								<template #icon>
									<ChevronLeft class="h-4 w-4" />
								</template>
							</Button>
							<span class="font-medium text-ink-gray-8">
								{{ monthNames[currentMonth] }} {{ currentYear }}
							</span>
							<Button variant="ghost" size="sm" @click="nextMonth">
								<template #icon>
									<ChevronRight class="h-4 w-4" />
								</template>
							</Button>
						</div>

						<!-- Day Headers -->
						<div class="grid grid-cols-7 gap-1 mb-1">
							<div
								v-for="day in dayNames"
								:key="day"
								class="text-center text-xs font-medium text-ink-gray-4 py-1"
							>
								{{ day }}
							</div>
						</div>

						<!-- Calendar Grid -->
						<div class="grid grid-cols-7 gap-1">
							<button
								v-for="date in calendarDays"
								:key="date.key"
								class="h-8 w-8 mx-auto flex items-center justify-center rounded-full text-sm transition-colors"
								:class="getDayClass(date)"
								:disabled="date.disabled"
								@click="!date.disabled && selectDate(date.date)"
							>
								{{ date.day }}
							</button>
						</div>
					</div>
				</div>

				<!-- Time Picker -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<label class="text-sm font-medium text-ink-gray-6">{{ __('Time') }}</label>
						<div class="flex items-center gap-2">
							<button
								class="text-xs px-2 py-1 rounded"
								:class="timeFormat === '12h' ? 'bg-surface-gray-3 text-ink-gray-8' : 'text-ink-gray-5 hover:text-ink-gray-7'"
								@click="timeFormat = '12h'"
							>
								12h
							</button>
							<button
								class="text-xs px-2 py-1 rounded"
								:class="timeFormat === '24h' ? 'bg-surface-gray-3 text-ink-gray-8' : 'text-ink-gray-5 hover:text-ink-gray-7'"
								@click="timeFormat = '24h'"
							>
								24h
							</button>
						</div>
					</div>

					<div class="flex items-center gap-2">
						<!-- Hour -->
						<select
							v-model="selectedHour"
							class="flex-1 rounded-lg border border-outline-gray-2 px-3 py-2 text-sm bg-surface-white focus:border-brand-5 focus:ring-1 focus:ring-brand-5"
						>
							<option v-for="h in hourOptions" :key="h.value" :value="h.value">
								{{ h.label }}
							</option>
						</select>

						<span class="text-ink-gray-5 font-medium">:</span>

						<!-- Minute -->
						<select
							v-model="selectedMinute"
							class="flex-1 rounded-lg border border-outline-gray-2 px-3 py-2 text-sm bg-surface-white focus:border-brand-5 focus:ring-1 focus:ring-brand-5"
						>
							<option v-for="m in minuteOptions" :key="m" :value="m">
								{{ m.toString().padStart(2, '0') }}
							</option>
						</select>

						<!-- AM/PM (12h format only) -->
						<select
							v-if="timeFormat === '12h'"
							v-model="selectedPeriod"
							class="rounded-lg border border-outline-gray-2 px-3 py-2 text-sm bg-surface-white focus:border-brand-5 focus:ring-1 focus:ring-brand-5"
						>
							<option value="AM">AM</option>
							<option value="PM">PM</option>
						</select>
					</div>
				</div>

				<!-- Summary -->
				<div v-if="selectedDate" class="bg-surface-gray-1 rounded-lg p-4">
					<div class="flex items-start gap-3">
						<Clock class="h-5 w-5 text-brand-5 mt-0.5" />
						<div>
							<p class="text-sm text-ink-gray-6">{{ __('Your email will be sent on:') }}</p>
							<p class="font-medium text-ink-gray-9">{{ formattedScheduleTime }}</p>
							<p class="text-xs text-ink-gray-5 mt-1">{{ relativeTime }}</p>
						</div>
					</div>
				</div>

				<!-- Error message -->
				<div v-if="errorMessage" class="bg-red-50 text-red-700 rounded-lg p-3 text-sm">
					{{ errorMessage }}
				</div>
			</div>
		</template>

		<template #actions>
			<Button variant="outline" @click="show = false">
				{{ __('Cancel') }}
			</Button>
			<Button
				variant="solid"
				:disabled="!canSchedule"
				@click="confirmSchedule"
			>
				<template #prefix>
					<Send class="h-4 w-4" />
				</template>
				{{ __('Schedule Send') }}
			</Button>
		</template>
	</Dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { Dialog, Button } from 'frappe-ui'
import { ChevronLeft, ChevronRight, Clock, Send, Sunrise, Sun, Calendar } from 'lucide-vue-next'

const show = defineModel()

const emit = defineEmits(['schedule'])

// Props for max days
const props = defineProps({
	maxDays: {
		type: Number,
		default: 30,
	},
})

// Time format preference (stored in localStorage)
const timeFormat = ref(localStorage.getItem('mailSchedulerTimeFormat') || '12h')
watch(timeFormat, (val) => localStorage.setItem('mailSchedulerTimeFormat', val))

// Calendar state
const today = new Date()
const currentMonth = ref(today.getMonth())
const currentYear = ref(today.getFullYear())
const selectedDate = ref(null)
const selectedHour = ref(9)
const selectedMinute = ref(0)
const selectedPeriod = ref('AM')
const errorMessage = ref('')

const monthNames = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
]

const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Quick options
const quickOptions = computed(() => {
	const now = new Date()
	const tomorrow = new Date(now)
	tomorrow.setDate(tomorrow.getDate() + 1)
	
	// Find next Monday
	const nextMonday = new Date(now)
	const daysUntilMonday = (8 - now.getDay()) % 7 || 7
	nextMonday.setDate(nextMonday.getDate() + daysUntilMonday)

	return [
		{
			label: __('Tomorrow'),
			timeLabel: '8:00 AM',
			icon: Sunrise,
			date: tomorrow,
			hour: 8,
			minute: 0,
			period: 'AM',
		},
		{
			label: __('Tomorrow'),
			timeLabel: '1:00 PM',
			icon: Sun,
			date: tomorrow,
			hour: 13,
			minute: 0,
			period: 'PM',
		},
		{
			label: nextMonday.toLocaleDateString('en-US', { weekday: 'long' }),
			timeLabel: '8:00 AM',
			icon: Calendar,
			date: nextMonday,
			hour: 8,
			minute: 0,
			period: 'AM',
		},
	]
})

// Hour options based on format
const hourOptions = computed(() => {
	if (timeFormat.value === '12h') {
		return Array.from({ length: 12 }, (_, i) => ({
			value: i === 0 ? 12 : i,
			label: (i === 0 ? 12 : i).toString(),
		}))
	} else {
		return Array.from({ length: 24 }, (_, i) => ({
			value: i,
			label: i.toString().padStart(2, '0'),
		}))
	}
})

const minuteOptions = [0, 15, 30, 45]

// Calendar days computation
const calendarDays = computed(() => {
	const days = []
	const firstDay = new Date(currentYear.value, currentMonth.value, 1)
	const lastDay = new Date(currentYear.value, currentMonth.value + 1, 0)
	const startPadding = firstDay.getDay()
	
	const maxDate = new Date()
	maxDate.setDate(maxDate.getDate() + props.maxDays)

	// Previous month padding
	const prevMonthLast = new Date(currentYear.value, currentMonth.value, 0)
	for (let i = startPadding - 1; i >= 0; i--) {
		const d = new Date(prevMonthLast)
		d.setDate(prevMonthLast.getDate() - i)
		days.push({
			key: `prev-${i}`,
			day: d.getDate(),
			date: d,
			isCurrentMonth: false,
			disabled: true,
		})
	}

	// Current month days
	for (let i = 1; i <= lastDay.getDate(); i++) {
		const d = new Date(currentYear.value, currentMonth.value, i)
		const isPast = d < new Date(today.getFullYear(), today.getMonth(), today.getDate())
		const isTooFar = d > maxDate
		
		days.push({
			key: `curr-${i}`,
			day: i,
			date: d,
			isCurrentMonth: true,
			isToday: d.toDateString() === today.toDateString(),
			isSelected: selectedDate.value && d.toDateString() === selectedDate.value.toDateString(),
			disabled: isPast || isTooFar,
		})
	}

	// Next month padding
	const remaining = 42 - days.length
	for (let i = 1; i <= remaining; i++) {
		const d = new Date(currentYear.value, currentMonth.value + 1, i)
		days.push({
			key: `next-${i}`,
			day: i,
			date: d,
			isCurrentMonth: false,
			disabled: true,
		})
	}

	return days
})

// Day class computation
const getDayClass = (date) => {
	const classes = []
	
	if (!date.isCurrentMonth) {
		classes.push('text-ink-gray-3')
	} else if (date.disabled) {
		classes.push('text-ink-gray-3 cursor-not-allowed')
	} else {
		classes.push('text-ink-gray-8 hover:bg-surface-gray-2 cursor-pointer')
	}

	if (date.isToday && date.isCurrentMonth) {
		classes.push('font-bold text-brand-5')
	}

	if (date.isSelected) {
		classes.push('!bg-brand-5 !text-white')
	}

	return classes.join(' ')
}

// Formatted schedule time
const formattedScheduleTime = computed(() => {
	if (!selectedDate.value) return ''
	
	const d = new Date(selectedDate.value)
	let hour = selectedHour.value
	
	if (timeFormat.value === '12h') {
		if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
		if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
	}
	
	d.setHours(hour, selectedMinute.value, 0, 0)
	
	return d.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: timeFormat.value === '12h',
	})
})

// Relative time
const relativeTime = computed(() => {
	if (!selectedDate.value) return ''
	
	const d = new Date(selectedDate.value)
	let hour = selectedHour.value
	
	if (timeFormat.value === '12h') {
		if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
		if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
	}
	
	d.setHours(hour, selectedMinute.value, 0, 0)
	
	const now = new Date()
	const diff = d - now
	
	if (diff < 0) return __('Time is in the past')
	
	const hours = Math.floor(diff / (1000 * 60 * 60))
	const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
	
	if (hours > 24) {
		const days = Math.floor(hours / 24)
		return __('in {0} days', [days])
	} else if (hours > 0) {
		return __('in {0} hours and {1} minutes', [hours, minutes])
	} else {
		return __('in {0} minutes', [minutes])
	}
})

// Can schedule validation
const canSchedule = computed(() => {
	if (!selectedDate.value) return false
	
	const d = new Date(selectedDate.value)
	let hour = selectedHour.value
	
	if (timeFormat.value === '12h') {
		if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
		if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
	}
	
	d.setHours(hour, selectedMinute.value, 0, 0)
	
	const now = new Date()
	// Must be at least 1 minute in the future
	return d > new Date(now.getTime() + 60000)
})

// Check if quick option is selected
const isOptionSelected = (option) => {
	if (!selectedDate.value) return false
	
	let hour = selectedHour.value
	if (timeFormat.value === '12h') {
		if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
		if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
	}
	
	return (
		selectedDate.value.toDateString() === option.date.toDateString() &&
		hour === option.hour &&
		selectedMinute.value === option.minute
	)
}

// Actions
const prevMonth = () => {
	if (currentMonth.value === 0) {
		currentMonth.value = 11
		currentYear.value--
	} else {
		currentMonth.value--
	}
}

const nextMonth = () => {
	if (currentMonth.value === 11) {
		currentMonth.value = 0
		currentYear.value++
	} else {
		currentMonth.value++
	}
}

const selectDate = (date) => {
	selectedDate.value = new Date(date)
	errorMessage.value = ''
}

const selectQuickOption = (option) => {
	selectedDate.value = new Date(option.date)
	
	if (timeFormat.value === '12h') {
		selectedHour.value = option.hour > 12 ? option.hour - 12 : (option.hour === 0 ? 12 : option.hour)
		selectedPeriod.value = option.hour >= 12 ? 'PM' : 'AM'
	} else {
		selectedHour.value = option.hour
	}
	
	selectedMinute.value = option.minute
	errorMessage.value = ''
}

const confirmSchedule = () => {
	if (!canSchedule.value) {
		errorMessage.value = __('Please select a valid future date and time')
		return
	}
	
	const d = new Date(selectedDate.value)
	let hour = selectedHour.value
	
	if (timeFormat.value === '12h') {
		if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
		if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
	}
	
	d.setHours(hour, selectedMinute.value, 0, 0)
	
	// Emit ISO string
	emit('schedule', d.toISOString())
	show.value = false
}

// Initialize with tomorrow 9 AM
onMounted(() => {
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)
	selectedDate.value = tomorrow
	
	if (timeFormat.value === '12h') {
		selectedHour.value = 9
		selectedPeriod.value = 'AM'
	} else {
		selectedHour.value = 9
	}
	selectedMinute.value = 0
})

// Reset when modal opens
watch(show, (val) => {
	if (val) {
		const tomorrow = new Date()
		tomorrow.setDate(tomorrow.getDate() + 1)
		selectedDate.value = tomorrow
		currentMonth.value = tomorrow.getMonth()
		currentYear.value = tomorrow.getFullYear()
		errorMessage.value = ''
	}
})
</script>
