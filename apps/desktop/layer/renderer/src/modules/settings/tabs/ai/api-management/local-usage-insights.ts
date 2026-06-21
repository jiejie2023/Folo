import type { DesktopLocalAIUsageRecord } from "~/modules/local-ai/hooks"

export type LocalUsageActivityMode = "cumulative" | "daily" | "weekly"

export type LocalUsageActivityDay = {
  date: Date
  dayOfWeek: number
  failureCount: number
  id: string
  level: number
  requestCount: number
  totalTokens: number
  weekIndex: number
}

export type LocalUsageMonthLabel = {
  month: number
  weekIndex: number
}

export type LocalUsageInsights = {
  activityDays: LocalUsageActivityDay[]
  maxDailyTokens: number
  monthLabels: LocalUsageMonthLabel[]
  recentRecords: DesktopLocalAIUsageRecord[]
  summary: {
    currentStreakDays: number
    longestStreakDays: number
    peakDailyTokens: number
    totalRequests: number
    totalTokens: number
  }
}

const ACTIVITY_DAY_COUNT = 365
const RECENT_RECORD_LIMIT = 5

export const buildLocalUsageInsights = (
  records: DesktopLocalAIUsageRecord[],
  now = new Date(),
): LocalUsageInsights => {
  const sortedRecords = [...records].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
  const endDate = startOfLocalDay(now)
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - (ACTIVITY_DAY_COUNT - 1))

  const activityDays = Array.from({ length: ACTIVITY_DAY_COUNT }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)

    return {
      date,
      dayOfWeek: index % 7,
      failureCount: 0,
      id: formatDateKey(date),
      level: 0,
      requestCount: 0,
      totalTokens: 0,
      weekIndex: Math.floor(index / 7),
    } satisfies LocalUsageActivityDay
  })
  const activityDayById = new Map(activityDays.map((day) => [day.id, day]))

  let totalTokens = 0
  let totalRequests = 0

  for (const record of sortedRecords) {
    const createdAt = new Date(record.createdAt)
    if (createdAt > now) continue

    const tokenCount = record.ok ? (record.totalTokens ?? 0) : 0
    totalTokens += tokenCount
    totalRequests += 1

    const activityDay = activityDayById.get(formatDateKey(createdAt))
    if (!activityDay) continue

    activityDay.failureCount += record.ok ? 0 : 1
    activityDay.requestCount += 1
    activityDay.totalTokens += tokenCount
  }

  const maxDailyTokens = Math.max(...activityDays.map((day) => day.totalTokens), 0)
  for (const activityDay of activityDays) {
    activityDay.level = getActivityLevel(activityDay.totalTokens, maxDailyTokens)
  }

  return {
    activityDays,
    maxDailyTokens,
    monthLabels: buildMonthLabels(activityDays),
    recentRecords: sortedRecords.slice(0, RECENT_RECORD_LIMIT),
    summary: {
      currentStreakDays: calculateCurrentStreak(activityDays),
      longestStreakDays: calculateLongestStreak(activityDays),
      peakDailyTokens: maxDailyTokens,
      totalRequests,
      totalTokens,
    },
  }
}

export const getActivityTokenValue = (
  day: LocalUsageActivityDay,
  days: LocalUsageActivityDay[],
  mode: LocalUsageActivityMode,
): number => {
  if (mode === "daily") return day.totalTokens

  if (mode === "weekly") {
    return days
      .filter((item) => item.weekIndex === day.weekIndex)
      .reduce((sum, item) => sum + item.totalTokens, 0)
  }

  const dayIndex = days.findIndex((item) => item.id === day.id)
  if (dayIndex === -1) return day.totalTokens

  return days.slice(0, dayIndex + 1).reduce((sum, item) => sum + item.totalTokens, 0)
}

export const getActivityLevel = (value: number, maxValue: number): number => {
  if (value <= 0 || maxValue <= 0) return 0

  const ratio = value / maxValue
  if (ratio >= 0.75) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.25) return 2
  return 1
}

const buildMonthLabels = (activityDays: LocalUsageActivityDay[]): LocalUsageMonthLabel[] => {
  const labels: LocalUsageMonthLabel[] = []
  let previousMonth = -1

  for (const day of activityDays) {
    const month = day.date.getMonth()
    if (month === previousMonth) continue

    previousMonth = month
    labels.push({
      month: month + 1,
      weekIndex: day.weekIndex,
    })
  }

  return labels
}

const calculateCurrentStreak = (activityDays: LocalUsageActivityDay[]): number => {
  let streak = 0

  for (let index = activityDays.length - 1; index >= 0; index -= 1) {
    if (activityDays[index]!.requestCount === 0) break
    streak += 1
  }

  return streak
}

const calculateLongestStreak = (activityDays: LocalUsageActivityDay[]): number => {
  let current = 0
  let longest = 0

  for (const day of activityDays) {
    if (day.requestCount > 0) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }

  return longest
}

const startOfLocalDay = (value: Date): Date => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

const formatDateKey = (value: Date): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
