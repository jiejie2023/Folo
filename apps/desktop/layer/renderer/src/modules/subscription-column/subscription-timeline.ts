import { ROUTE_TIMELINE_SYNCED, ROUTE_VIEW_ALL } from "~/constants"

export const insertSyncedTimeline = (timelineIds: string[]) => {
  const withoutSynced = timelineIds.filter((timelineId) => timelineId !== ROUTE_TIMELINE_SYNCED)
  const allIndex = withoutSynced.indexOf(ROUTE_VIEW_ALL)
  const insertIndex = allIndex === -1 ? 0 : allIndex + 1

  return [
    ...withoutSynced.slice(0, insertIndex),
    ROUTE_TIMELINE_SYNCED,
    ...withoutSynced.slice(insertIndex),
  ]
}
