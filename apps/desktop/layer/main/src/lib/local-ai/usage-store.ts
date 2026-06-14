import { randomUUID } from "node:crypto"

import { store } from "~/lib/store"

import type { LocalAIUsageRecord } from "./types"

const USAGE_RECORDS_KEY = "localAIUsageRecords"
const MAX_USAGE_RECORDS = 500

export const recordLocalAIUsage = (
  input: Omit<LocalAIUsageRecord, "createdAt" | "id">,
): LocalAIUsageRecord => {
  const record: LocalAIUsageRecord = {
    ...input,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
  }

  store.set(USAGE_RECORDS_KEY, [record, ...readUsageRecords()].slice(0, MAX_USAGE_RECORDS))

  return record
}

export const listLocalAIUsage = (limit?: number): LocalAIUsageRecord[] => {
  const records = readUsageRecords()

  if (typeof limit !== "number") {
    return records
  }

  return records.slice(0, Math.max(0, limit))
}

export const clearLocalAIUsage = (): void => {
  store.set(USAGE_RECORDS_KEY, [])
}

const readUsageRecords = (): LocalAIUsageRecord[] =>
  [...(store.get(USAGE_RECORDS_KEY) ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
