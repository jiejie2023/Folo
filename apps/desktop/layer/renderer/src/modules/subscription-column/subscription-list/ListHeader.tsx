import { FeedViewType, getView } from "@follow/constants"
import { useSyncedFeedIds } from "@follow/store/subscription/hooks"
import { useUnreadByIds, useUnreadByView } from "@follow/store/unread/hooks"
import { stopPropagation } from "@follow/utils"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { useRouteParams } from "~/hooks/biz/useRouteParams"

import {
  closeSubscriptionSearchPanel,
  openSubscriptionSearchPanel,
  useSubscriptionSearchState,
} from "../atom"
import { UnreadNumber } from "../UnreadNumber"
import { SortButton } from "./SortButton"

export const ListHeader = ({ view }: { view: FeedViewType }) => {
  const { t } = useTranslation()

  const { isSyncedTimeline, timelineId, view: activeView } = useRouteParams()
  const unreadByView = useUnreadByView(view)
  const syncedFeedIds = useSyncedFeedIds(FeedViewType.All)
  const syncedUnread = useUnreadByIds(syncedFeedIds)
  const totalUnread = isSyncedTimeline ? syncedUnread : unreadByView
  const [searchState, setSearchState] = useSubscriptionSearchState()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const navigateEntry = useNavigateEntry()
  const isActiveView = isSyncedTimeline ? view === FeedViewType.All : view === activeView
  const isSearchingCurrentView = isActiveView && searchState.isOpen

  useEffect(() => {
    if (isSearchingCurrentView) {
      searchInputRef.current?.focus()
    }
  }, [isSearchingCurrentView])

  return (
    <div onClick={stopPropagation} className="mx-3 flex items-center justify-between p-1">
      {isSearchingCurrentView ? (
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-xl bg-fill-secondary px-2 text-sm text-text">
          <i className="i-mgc-search-cute-re mr-1.5 size-4 shrink-0 text-text-tertiary" />
          <input
            ref={searchInputRef}
            value={searchState.query}
            onChange={(event) => {
              setSearchState((state) => ({ ...state, query: event.target.value }))
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSubscriptionSearchPanel()
              }
            }}
            placeholder={t("search.placeholder")}
            className="min-w-0 grow bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
          {searchState.query && (
            <button
              type="button"
              className="center size-5 shrink-0 rounded-full text-text-tertiary transition-colors hover:bg-fill-tertiary hover:text-text-secondary"
              onClick={() => {
                setSearchState((state) => ({ ...state, query: "" }))
              }}
              title={t("words.close", { ns: "common" })}
            >
              <i className="i-mgc-close-cute-re size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div
          className="min-w-0 flex-1 truncate text-base font-bold"
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
      )}
      <div className="ml-2 flex items-center gap-3 text-base text-text-secondary lg:text-sm">
        <button
          type="button"
          className="center rounded text-text-secondary transition-colors hover:text-text"
          title={isSearchingCurrentView ? t("words.close", { ns: "common" }) : t("words.search")}
          aria-label={
            isSearchingCurrentView ? t("words.close", { ns: "common" }) : t("words.search")
          }
          onClick={
            isSearchingCurrentView ? closeSubscriptionSearchPanel : openSubscriptionSearchPanel
          }
        >
          <i
            className={
              isSearchingCurrentView ? "i-mgc-close-cute-re size-4" : "i-mgc-search-cute-re size-4"
            }
          />
        </button>
        <SortButton />
        <UnreadNumber unread={totalUnread} className="text-xs !text-inherit" />
      </div>
    </div>
  )
}
