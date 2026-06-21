import { describe, expect, it } from "vitest"

import { buildTranslatedContent } from "./translated-content"

describe("buildTranslatedContent", () => {
  it("keeps a source html paragraph together in bilingual mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: "<p>Original one. Original two.</p>",
      target: "<p>Translated one. Translated two.</p>",
    })

    expect(result).not.toContain("<hr")
    expect(result).toContain("Original one. Original two.")
    expect(result.indexOf("Original one. Original two.")).toBeLessThan(
      result.indexOf("Translated one. Translated two."),
    )
  })

  it("keeps paragraph pairing when translated text is shorter than the source", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: "<p>Original one. Original two.</p>",
      target: "<p>Translated paragraph.</p>",
    })

    expect(result.indexOf("Original one. Original two.")).toBeLessThan(
      result.indexOf("Translated paragraph."),
    )
  })

  it("interleaves translated leading paragraphs while the rest is still pending", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: "<p>Original one.</p><p>Original two.</p>",
      target: "<p>Translated one.</p>",
    })

    expect(result.indexOf("Original one.")).toBeLessThan(result.indexOf("Translated one."))
    expect(result.indexOf("Translated one.")).toBeLessThan(result.indexOf("Original two."))
    expect(result).not.toBe("<p>Original one.</p><p>Original two.</p><p>Translated one.</p>")
  })

  it("interleaves visual paragraphs separated by double html breaks", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: "<div>Original one.<br><br>Original two.</div>",
      target: "<p>Translated one.</p><p>Translated two.</p>",
    })

    expect(result.indexOf("Original one.")).toBeLessThan(result.indexOf("Translated one."))
    expect(result.indexOf("Translated one.")).toBeLessThan(result.indexOf("Original two."))
    expect(result.indexOf("Original two.")).toBeLessThan(result.indexOf("Translated two."))
    expect(result).not.toContain("<li")
  })

  it("interleaves content inside nested article wrappers with media siblings", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source:
        '<div><div><img src="cover.svg" alt="Cover"></div></div><div><div><p>Original introduction.</p><h3>Summary</h3><ul><li>Original first point.</li><li>Original second point.</li></ul><p>Original conclusion.</p></div></div><div><img src="footer.svg" alt="Footer"></div>',
      target:
        "<p>Translated introduction.</p><h3>Translated summary</h3><ul><li>Translated first point.</li><li>Translated second point.</li></ul><p>Translated conclusion.</p>",
    })

    expect(result.indexOf("cover.svg")).toBeLessThan(result.indexOf("Original introduction."))
    expect(result.indexOf("Original introduction.")).toBeLessThan(
      result.indexOf("Translated introduction."),
    )
    expect(result.indexOf("Translated introduction.")).toBeLessThan(result.indexOf("Summary"))
    expect(result.indexOf("Summary")).toBeLessThan(result.indexOf("Translated summary"))
    expect(result.indexOf("Translated summary")).toBeLessThan(
      result.indexOf("Original first point."),
    )
    expect(result.indexOf("Original conclusion.")).toBeLessThan(
      result.indexOf("Translated conclusion."),
    )
    expect(result.indexOf("Translated conclusion.")).toBeLessThan(result.indexOf("footer.svg"))
  })

  it("keeps media nodes in place while partial html translation is streaming", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source:
        '<p>Before media.</p><img src="cover.jpg" alt="Cover"><video controls src="clip.mp4"></video><p>After media.</p>',
      target: "<p>Translated before.</p>",
    })

    expect(result).toContain('<img src="cover.jpg" alt="Cover">')
    expect(result).toContain('<video controls="" src="clip.mp4"></video>')
    expect(result.indexOf("Translated before.")).toBeLessThan(result.indexOf("cover.jpg"))
    expect(result.indexOf("clip.mp4")).toBeLessThan(result.indexOf("After media."))
  })

  it("does not consume translated paragraphs for source media nodes", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: '<p>Before media.</p><img src="cover.jpg" alt="Cover"><p>After media.</p>',
      target: "<p>Translated before.</p><p>Translated after.</p>",
    })

    expect(result).toContain('<img src="cover.jpg" alt="Cover">')
    expect(result.indexOf("Translated before.")).toBeLessThan(result.indexOf("cover.jpg"))
    expect(result.indexOf("cover.jpg")).toBeLessThan(result.indexOf("After media."))
    expect(result.indexOf("After media.")).toBeLessThan(result.indexOf("Translated after."))
  })

  it("reserves translation slots so media node positions stay stable while streaming", () => {
    const source =
      '<p>Before <a href="https://example.com">media</a>.</p><img src="cover.jpg"><p>After media.</p>'
    const partial = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source,
      target: null,
    })
    const complete = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source,
      target: "<p>Translated before.</p><p>Translated after.</p>",
    })

    const partialNodes = Array.from(
      new DOMParser().parseFromString(partial, "text/html").body.children,
    )
    const completeNodes = Array.from(
      new DOMParser().parseFromString(complete, "text/html").body.children,
    )

    expect(partialNodes).toHaveLength(completeNodes.length)
    expect(partialNodes.findIndex((node) => node.tagName === "IMG")).toBe(
      completeNodes.findIndex((node) => node.tagName === "IMG"),
    )
    expect(partial).toContain('data-follow-translation-placeholder="true"')
  })

  it("removes source text accidentally echoed by the translation model", () => {
    const source =
      "<p>OpenAI launches the Partner Network, investing $150M to help global partners accelerate enterprise AI adoption, deployment, and transformation.</p>"
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source,
      target:
        "<p>OpenAI launches the Partner Network, investing $150M to help global partners accelerate enterprise AI adoption, deployment, and transformation. OpenAI 推出合作伙伴网络，投资 1.5 亿美元，帮助全球合作伙伴加速企业 AI 的采用、部署和转型。</p>",
    })

    const sourceOccurrences = result.match(/OpenAI launches the Partner Network/g)?.length ?? 0

    expect(sourceOccurrences).toBe(1)
    expect(result).toContain("OpenAI 推出合作伙伴网络")
  })

  it("skips a separate echoed source paragraph in bilingual html mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "bilingual",
      source: "<p>Hello world.</p>",
      target: "<p>Hello world.</p><p>Translated hello.</p>",
    })

    expect(result.match(/Hello world/g)?.length ?? 0).toBe(1)
    expect(result).toContain("Translated hello.")
    expect(result.indexOf("Hello world.")).toBeLessThan(result.indexOf("Translated hello."))
  })

  it("shows only the translated body in translation-only mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "translation-only",
      source: "<p>Original body</p>",
      target: "<p>Translated body</p>",
    })

    expect(result).toBe("<p>Translated body</p>")
  })

  it("keeps source media in place in translation-only html mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "translation-only",
      source:
        '<p>Before media.</p><img src="cover.jpg" alt="Cover"><video controls src="clip.mp4"></video><p>After media.</p>',
      target: "<p>Translated before.</p><p>Translated after.</p>",
    })

    expect(result).toContain('<img src="cover.jpg" alt="Cover">')
    expect(result).toContain('<video controls="" src="clip.mp4"></video>')
    expect(result.indexOf("Translated before.")).toBeLessThan(result.indexOf("cover.jpg"))
    expect(result.indexOf("clip.mp4")).toBeLessThan(result.indexOf("Translated after."))
  })

  it("keeps untranslated source text visible in translation-only html mode while streaming", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "translation-only",
      source: '<p>Before media.</p><img src="cover.jpg" alt="Cover"><p>After media.</p>',
      target: "<p>Translated before.</p>",
    })

    expect(result).toContain("Translated before.")
    expect(result).toContain('<img src="cover.jpg" alt="Cover">')
    expect(result).toContain("After media.")
  })

  it("removes echoed source text in translation-only html mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "translation-only",
      source: "<p>Hello world.</p>",
      target: "<p>Hello world. 你好，世界。</p>",
    })

    expect(result).toBe("<p>你好，世界。</p>")
  })

  it("skips a separate echoed source paragraph in translation-only html mode", () => {
    const result = buildTranslatedContent({
      format: "html",
      mode: "translation-only",
      source: "<p>Hello world.</p>",
      target: "<p>Hello world.</p><p>Translated hello.</p>",
    })

    expect(result).toBe("<p>Translated hello.</p>")
  })

  it("falls back to the source body when the translation is unavailable", () => {
    const result = buildTranslatedContent({
      format: "markdown",
      mode: "bilingual",
      source: "Original body",
      target: null,
    })

    expect(result).toBe("Original body")
  })
})
