<template>
	<div class="relative">
		<!-- Schedule Dropdown Button -->
		<Dropdown :options="dropdownOptions" placement="top-end">
			<Button
				variant="outline"
				:disabled="disabled"
			>
				<template #prefix>
					<Clock class="h-4 w-4" />
				</template>
				{{ __('Schedule') }}
				<template #suffix>
					<ChevronUp class="h-3 w-3" />
				</template>
			</Button>
		</Dropdown>

		<!-- Schedule Modal -->
		<ScheduleModal
			v-model="showScheduleModal"
			:max-days="maxDays"
			@schedule="handleSchedule"
		/>
	</div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Button, Dropdown } from 'frappe-ui'
import { Clock, ChevronUp, Sunrise, Sun, Calendar } from 'lucide-vue-next'
import ScheduleModal from './ScheduleModal.vue'

const props = defineProps({
	disabled: {
		type: Boolean,
		default: false,
	},
	maxDays: {
		type: Number,
		default: 30,
	},
})

const emit = defineEmits(['schedule'])

const showScheduleModal = ref(false)

// Quick schedule options for dropdown
const dropdownOptions = computed(() => {
	const now = new Date()
	const tomorrow = new Date(now)
	tomorrow.setDate(tomorrow.getDate() + 1)
	
	// Tomorrow 8 AM
	const tomorrow8am = new Date(tomorrow)
	tomorrow8am.setHours(8, 0, 0, 0)
	
	// Tomorrow 1 PM  
	const tomorrow1pm = new Date(tomorrow)
	tomorrow1pm.setHours(13, 0, 0, 0)
	
	// Next Monday 8 AM
	const nextMonday = new Date(now)
	const daysUntilMonday = (8 - now.getDay()) % 7 || 7
	nextMonday.setDate(nextMonday.getDate() + daysUntilMonday)
	nextMonday.setHours(8, 0, 0, 0)

	return [
		{
			group: __('Quick Options'),
			hideLabel: true,
			items: [
				{
					label: __('Tomorrow morning'),
					description: formatDate(tomorrow8am),
					icon: Sunrise,
					onClick: () => emit('schedule', tomorrow8am.toISOString()),
				},
				{
					label: __('Tomorrow afternoon'),
					description: formatDate(tomorrow1pm),
					icon: Sun,
					onClick: () => emit('schedule', tomorrow1pm.toISOString()),
				},
				{
					label: __('Monday morning'),
					description: formatDate(nextMonday),
					icon: Calendar,
					onClick: () => emit('schedule', nextMonday.toISOString()),
				},
			],
		},
		{
			group: __('Custom'),
			hideLabel: true,
			items: [
				{
					label: __('Pick date & time...'),
					icon: Clock,
					onClick: () => showScheduleModal.value = true,
				},
			],
		},
	]
})

// Format date for display
const formatDate = (date) => {
	const options = {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}
	return date.toLocaleDateString('en-US', options)
}

// Handle schedule from modal
const handleSchedule = (isoString) => {
	emit('schedule', isoString)
}
</script>
