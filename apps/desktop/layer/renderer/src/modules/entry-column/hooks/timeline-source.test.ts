import { FeedViewType } from "@follow/constants"
import { describe, expect, it } from "vitest"

import { ROUTE_FEED_PENDING } from "~/constants/app"

import { getTimelineFolderFeedIds, mergeEntryIds, shouldUseViewFeedIds } from "./timeline-source"

describe("timeline source selection", () => {
  it.each([
    FeedViewType.All,
    FeedViewType.Articles,
    FeedViewType.SocialMedia,
    FeedViewType.Pictures,
    FeedViewType.Videos,
    FeedViewType.Audios,
    FeedViewType.Notifications,
  ])("uses all feeds from top-level view %s", (view) => {
    expect(
      shouldUseViewFeedIds({
        feedId: ROUTE_FEED_PENDING,
        folderIds: [],
        inboxId: undefined,
        isCollection: false,
        isSyncedTimeline: false,
        listId: undefined,
        view,
      }),
    ).toBe(true)
  })

  it("keeps the synced timeline on its dedicated feed set", () => {
    expect(
      shouldUseViewFeedIds({
        feedId: ROUTE_FEED_PENDING,
        folderIds: [],
        inboxId: undefined,
        isCollection: false,
        isSyncedTimeline: true,
        listId: undefined,
        view: FeedViewType.All,
      }),
    ).toBe(false)
  })

  it("does not replace a selected category with all feeds from the view", () => {
    expect(
      shouldUseViewFeedIds({
        feedId: "folder-01 AI",
        folderIds: ["feed-1", "feed-2"],
        inboxId: undefined,
        isCollection: false,
        isSyncedTimeline: false,
        listId: undefined,
        view: FeedViewType.SocialMedia,
      }),
    ).toBe(false)
  })

  it("limits synced categories to feeds that are actually synced", () => {
    expect(
      getTimelineFolderFeedIds({
        allowedFeedIds: ["shared-feed", "cloud-feed"],
        folderIds: ["local-feed", "shared-feed", "cloud-feed"],
      }),
    ).toEqual(["shared-feed", "cloud-feed"])
  })

  it("keeps normal categories unchanged", () => {
    expect(
      getTimelineFolderFeedIds({
        allowedFeedIds: ["local-feed", "cloud-feed"],
        folderIds: ["local-feed", "cloud-feed"],
      }),
    ).toEqual(["local-feed", "cloud-feed"])
  })

  it("removes private or hidden feeds from category timelines", () => {
    expect(
      getTimelineFolderFeedIds({
        allowedFeedIds: ["visible-feed"],
        folderIds: ["visible-feed", "private-feed", "hidden-feed"],
      }),
    ).toEqual(["visible-feed"])
  })

  it("keeps feed-list entries and fills missing ids from the view index", () => {
    expect(mergeEntryIds(["entry-2", "entry-1"], ["entry-3", "entry-2"])).toEqual([
      "entry-2",
      "entry-1",
      "entry-3",
    ])
  })
})
