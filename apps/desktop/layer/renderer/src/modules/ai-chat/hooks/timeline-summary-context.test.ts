import { FeedViewType } from "@follow/constants"
import { describe, expect, it } from "vitest"

import { ROUTE_FEED_IN_FOLDER, ROUTE_FEED_PENDING } from "~/constants"

import {
  createTimelineSummaryContextBlocks,
  ensureTimelineEntriesContextBlock,
  hasTimelineEntriesContextBlock,
} from "./timeline-summary-context"

describe("createTimelineSummaryContextBlocks", () => {
  it("creates timeline context blocks for the current view, feed, and unread filter", () => {
    expect(
      createTimelineSummaryContextBlocks({
        entryIds: ["entry-1", "entry-2"],
        feedId: "feed-1",
        unreadOnly: true,
        view: FeedViewType.Articles,
      }),
    ).toEqual([
      { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
      { id: "mainFeed", type: "mainFeed", value: "feed-1" },
      { id: "unreadOnly", type: "unreadOnly", value: "true" },
      { id: "timelineEntries", type: "timelineEntries", value: "entry-1,entry-2" },
    ])
  })

  it("trims empty timeline entry ids", () => {
    expect(
      createTimelineSummaryContextBlocks({
        entryIds: [" entry-1 ", "", "entry-2"],
        feedId: null,
        unreadOnly: false,
        view: FeedViewType.SocialMedia,
      }),
    ).toEqual([
      { id: "mainView", type: "mainView", value: `${FeedViewType.SocialMedia}` },
      { id: "timelineEntries", type: "timelineEntries", value: "entry-1,entry-2" },
    ])
  })

  it("omits the pending feed placeholder", () => {
    expect(
      createTimelineSummaryContextBlocks({
        feedId: ROUTE_FEED_PENDING,
        unreadOnly: false,
        view: FeedViewType.All,
      }),
    ).toEqual([{ id: "mainView", type: "mainView", value: `${FeedViewType.All}` }])
  })

  it("resolves category feeds before sending the timeline context", () => {
    expect(
      createTimelineSummaryContextBlocks({
        feedId: `${ROUTE_FEED_IN_FOLDER}AI`,
        resolveCategoryFeedIds: () => ["feed-a", "feed-b"],
        unreadOnly: false,
        view: FeedViewType.Articles,
      }),
    ).toEqual([
      { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
      { id: "mainFeed", type: "mainFeed", value: "feed-a,feed-b" },
    ])
  })

  it("detects whether timeline entries are available for summary", () => {
    expect(
      hasTimelineEntriesContextBlock([
        { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
      ]),
    ).toBe(false)

    expect(
      hasTimelineEntriesContextBlock([
        { id: "timelineEntries", type: "timelineEntries", value: "entry-1" },
      ]),
    ).toBe(true)
  })

  it("replaces stale timeline entries with the latest entry ids", () => {
    expect(
      ensureTimelineEntriesContextBlock(
        [
          { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
          { id: "timelineEntries", type: "timelineEntries", value: "old-entry" },
        ],
        ["entry-1", "entry-2"],
      ),
    ).toEqual([
      { id: "mainView", type: "mainView", value: `${FeedViewType.Articles}` },
      { id: "timelineEntries", type: "timelineEntries", value: "entry-1,entry-2" },
    ])
  })
})
