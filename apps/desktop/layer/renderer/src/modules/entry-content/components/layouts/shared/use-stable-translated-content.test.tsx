import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useStableTranslatedContent } from "./use-stable-translated-content"

const reactActGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

const Probe = ({ target }: { target?: string }) => {
  const content = useStableTranslatedContent({
    format: "html",
    mode: "bilingual",
    source: "<p>Original paragraph.</p>",
    target,
  })

  return <div>{content}</div>
}

describe("useStableTranslatedContent", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it("renders the first translation delta immediately and throttles later deltas", async () => {
    await act(async () => root.render(<Probe />))

    await act(async () => root.render(<Probe target="<p>Translated one.</p>" />))
    expect(container.textContent).toContain("Translated one.")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
      root.render(<Probe target="<p>Translated two.</p>" />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
      root.render(<Probe target="<p>Translated three.</p>" />)
    })

    expect(container.textContent).toContain("Translated one.")
    expect(container.textContent).not.toContain("Translated three.")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
    })

    expect(container.textContent).toContain("Translated three.")
  })
})
