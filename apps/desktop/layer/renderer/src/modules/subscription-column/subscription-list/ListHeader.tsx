import { FeedViewType, getView } from "@follow/constants"
import { useSyncedFeedIds } from "@follow/store/subscription/hooks"
import { useUnreadByIds, useUnreadByView } from "@follow/store/unread/hooks"
import { stopPropagation } from "@follow/utils"
import { useTranslation } from "react-i18next"

import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { useRouteParams } from "~/hooks/biz/useRouteParams"

import { UnreadNumber } from "../UnreadNumber"
import { SortButton } from "./SortButton"

export const ListHeader = ({ view }: { view: FeedViewType }) => {
  const { t } = useTranslation()

  const { isSyncedTimeline, timelineId } = useRouteParams()
  const unreadByView = useUnreadByView(view)
  const syncedFeedIds = useSyncedFeedIds(FeedViewType.All)
  const syncedUnread = useUnreadByIds(syncedFeedIds)
  const totalUnread = isSyncedTimeline ? syncedUnread : unreadByView

  const navigateEntry = useNavigateEntry()

  return (
    <div onClick={stopPropagation} className="mx-3 flex items-center justify-between p-1">
      <div
        className="text-base font-bold"
        onClick={(e) => {
          e.stopPropagation()
          if (!document.hasFocus()) return
          if (view !== undefined) {
            navigateEntry({
              entryId: null,
              feedId: null,
              view,
              timelineId: isSyncedTimeline ? timelineId : undefined,
            })
          }
        }}
      >
        {isSyncedTimeline
          ? t("subscription_source.synced")
          : view !== undefined &&
            t(getView(view).name, {
              ns: "common",
            })}
      </div>
      <div className="ml-2 flex items-center gap-3 text-base text-text-secondary lg:text-sm">
        <SortButton />
        <UnreadNumber unread={totalUnread} className="text-xs !text-inherit" />
      </div>
    </div>
  )
}
