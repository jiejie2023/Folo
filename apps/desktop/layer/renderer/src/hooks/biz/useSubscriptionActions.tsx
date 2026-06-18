import { Kbd } from "@follow/components/ui/kbd/Kbd.js"
import { isLocalSubscription } from "@follow/store/subscription/source"
import { subscriptionSyncService } from "@follow/store/subscription/store"
import type { SubscriptionModel } from "@follow/store/subscription/types"
import { whoami } from "@follow/store/user/getters"
import { useMutation } from "@tanstack/react-query"
import { useHotkeys } from "react-hotkeys-hook"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { navigateEntry } from "./useNavigateEntry"
import { getRouteParams } from "./useRouteParams"

export const useDeleteSubscription = ({ onSuccess }: { onSuccess?: () => void } = {}) => {
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async ({
      subscription,
      feedIdList,
    }: {
      subscription?: SubscriptionModel
      feedIdList?: string[]
    }) => {
      if (feedIdList) {
        await subscriptionSyncService.unsubscribe(feedIdList)
        toast.success(t("notify.unfollow_feed_many"))
        return
      }

      if (!subscription) return

      const shouldManageLocally = isLocalSubscription(subscription) || !whoami()

      subscriptionSyncService
        .unsubscribe([subscription.feedId, subscription.listId])
        .then(([feed]) => {
          if (!shouldManageLocally) {
            subscriptionSyncService.fetch()
          }

          if (!subscription) return
          if (!feed) return
          const undo = async () => {
            if (shouldManageLocally && feed.type === "feed") {
              await subscriptionSyncService.subscribeLocal({
                feed,
                subscription: {
                  url: feed.url,
                  view: subscription.view,
                  category: subscription.category,
                  isPrivate: subscription.isPrivate,
                  feedId: feed.id,
                  listId: undefined,
                  title: subscription.title,
                  hideFromTimeline: subscription.hideFromTimeline,
                },
                entries: [],
              })
            } else {
              await subscriptionSyncService.subscribe({
                url: feed.type === "feed" ? feed.url : undefined,
                listId: feed.type === "list" ? feed.id : undefined,
                view: subscription.view,
                category: subscription.category,
                isPrivate: subscription.isPrivate,
                feedId: feed.id,
                title: feed.title,
                hideFromTimeline: subscription.hideFromTimeline,
              })
            }

            toast.dismiss(toastId)
          }

          const toastId = toast.warning("", {
            duration: 3000,
            description: <UnfollowInfo title={feed.title!} undo={undo} />,
            action: {
              label: (
                <span className={"flex items-center gap-1 px-1"}>
                  {t("words.undo")}
                  <Kbd className="inline-flex items-center border border-border bg-transparent text-white">
                    $mod+Z
                  </Kbd>
                </span>
              ),
              onClick: undo,
            },
          })
        })
    },

    onSuccess: (_) => {
      onSuccess?.()
    },
    onMutate(variables) {
      if (getRouteParams().feedId === variables.subscription?.feedId) {
        navigateEntry({
          feedId: null,
          entryId: null,
          view: getRouteParams().view,
        })
      }
    },
  })
}

const UnfollowInfo = ({ title, undo }: { title: string; undo: () => any }) => {
  useHotkeys("ctrl+z,meta+z", undo, {
    preventDefault: true,
  })
  return (
    <span className="font-medium text-text">
      <Trans
        ns="app"
        i18nKey="notify.unfollow_feed"
        components={{
          FeedItem: <i className="mr-px font-semibold">{title}</i>,
        }}
      />
    </span>
  )
}

export const useBatchUpdateSubscription = () => {
  return useMutation({
    mutationFn: async ({
      feedIdList,
      category,
      view,
    }: {
      feedIdList: string[]
      category?: string | null
      view: number
    }) => {
      await subscriptionSyncService.batchUpdateSubscription({
        category,
        feedIds: feedIdList,
        view,
      })
    },
  })
}

export const useSyncLocalSubscriptionToAccount = () => {
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async (feedId: string) => {
      await subscriptionSyncService.syncLocalToCloud(feedId)
    },
    onSuccess: () => {
      toast.success(t("subscription_source.sync_to_account_success"))
    },
    onError: () => {
      toast.error(t("subscription_source.sync_to_account_error"))
    },
  })
}
