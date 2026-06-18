import type { GeneralSettings } from "@follow/shared/settings/interface"

type TranslationMode = GeneralSettings["translationMode"]
type TranslatedContentFormat = "html" | "markdown"

export interface BuildTranslatedContentOptions {
  source?: string | null
  target?: string | null
  mode: TranslationMode
  format: TranslatedContentFormat
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
])

const MEDIA_SELECTOR = "img,video,audio,iframe,picture,svg,canvas,object,embed"
const MEDIA_TAGS = new Set(MEDIA_SELECTOR.split(","))
const TRANSPARENT_CONTAINER_TAGS = new Set(["article", "div", "main", "section"])
const TRANSLATION_PLACEHOLDER =
  '<span hidden aria-hidden="true" data-follow-translation-placeholder="true"></span>'

const normalizeContent = (content?: string | null) => {
  if (!content) return null

  const trimmed = content.trim()
  return trimmed.length > 0 ? trimmed : null
}

const escapeHtml = (content: string) =>
  content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const stripSourcePrefixFromTargetText = (sourceText: string, targetText: string) => {
  const normalizedSource = sourceText.replaceAll(/\s+/g, " ").trim()
  const normalizedTarget = targetText.replaceAll(/\s+/g, " ").trim()

  if (!normalizedSource || !normalizedTarget.startsWith(normalizedSource)) {
    return targetText
  }

  return normalizedTarget
    .slice(normalizedSource.length)
    .replace(/^[\s:：,，.。;；\-–—]+/, "")
    .trim()
}

const isEchoOnlyTargetNode = (sourceNode: ChildNode, targetNode: ChildNode) => {
  const sourceText = sourceNode.textContent?.trim() ?? ""
  const targetText = targetNode.textContent?.trim() ?? ""
  if (!sourceText || !targetText) return false

  return stripSourcePrefixFromTargetText(sourceText, targetText).length === 0
}

const isMeaningfulNode = (node: ChildNode) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return !!node.textContent?.trim()
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    return !!element.textContent?.trim() || isMediaNode(element)
  }

  return false
}

const isMediaNode = (element: Element) => {
  const tagName = element.tagName.toLowerCase()
  return MEDIA_TAGS.has(tagName) || !!element.querySelector(MEDIA_SELECTOR)
}

const isMediaOnlyNode = (node: ChildNode) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return false

  const element = node as Element
  return isMediaNode(element) && !element.textContent?.trim()
}

const splitVisualParagraphNode = (element: Element) => {
  const groups: ChildNode[][] = []
  let currentGroup: ChildNode[] = []
  let consecutiveBreaks = 0

  for (const child of Array.from(element.childNodes)) {
    const isBreak =
      child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === "br"

    if (isBreak) {
      consecutiveBreaks += 1
      if (consecutiveBreaks >= 2 && currentGroup.length > 0) {
        groups.push(currentGroup)
        currentGroup = []
      }
      continue
    }

    if (consecutiveBreaks === 1) {
      currentGroup.push(element.ownerDocument.createElement("br"))
    }
    consecutiveBreaks = 0
    currentGroup.push(child.cloneNode(true) as ChildNode)
  }

  if (consecutiveBreaks === 1) {
    currentGroup.push(element.ownerDocument.createElement("br"))
  }
  if (currentGroup.length > 0) groups.push(currentGroup)
  if (groups.length < 2) return null

  return groups
    .map((group) => {
      const paragraph = element.ownerDocument.createElement("p")
      paragraph.append(...group)
      return paragraph
    })
    .filter(isMeaningfulNode)
}

const flattenContentNode = (node: ChildNode): ChildNode[] => {
  if (node.nodeType !== Node.ELEMENT_NODE) return [node]

  const element = node as Element
  const visualParagraphs = splitVisualParagraphNode(element)
  if (visualParagraphs) return visualParagraphs

  const tagName = element.tagName.toLowerCase()
  if (!TRANSPARENT_CONTAINER_TAGS.has(tagName) || isMediaOnlyNode(node)) return [node]

  const children = Array.from(element.childNodes).filter(isMeaningfulNode)
  const hasBlockChildren = children.some(
    (child) =>
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has((child as Element).tagName.toLowerCase()),
  )
  if (!hasBlockChildren) return [node]

  return children.flatMap(flattenContentNode)
}

const getTopLevelNodes = (html: string) => {
  if (typeof DOMParser === "undefined") return null

  const document = new DOMParser().parseFromString(html, "text/html")
  const nodes = Array.from(document.body.childNodes).filter(isMeaningfulNode)
  return nodes.flatMap(flattenContentNode)
}

const getNodeHtml = (node: ChildNode) => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).outerHTML
  }

  return `<p>${escapeHtml(node.textContent?.trim() ?? "")}</p>`
}

const isPlainTextParagraph = (node: ChildNode) => {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return false

  const element = node as Element
  const tagName = element.tagName.toLowerCase()
  if (tagName !== "p") return false

  return Array.from(element.children).every((child) => child.tagName.toLowerCase() === "br")
}

const buildPlainHtmlNodeWithText = (node: ChildNode, text: string) => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tagName = (node as Element).tagName.toLowerCase()
    if (tagName === "p") {
      return `<p>${escapeHtml(text)}</p>`
    }
  }

  return `<p>${escapeHtml(text)}</p>`
}

const stripSourceEchoFromHtmlTargetContent = (sourceContent: string, targetContent: string) => {
  const sourceNodes = getTopLevelNodes(sourceContent)
  const targetNodes = getTopLevelNodes(targetContent)

  if (!sourceNodes || !targetNodes || sourceNodes.length !== targetNodes.length) {
    return targetContent
  }

  let changed = false
  const sanitizedTargetNodes = targetNodes.map((targetNode, index) => {
    const sourceNode = sourceNodes[index]
    if (!sourceNode || !isPlainTextParagraph(sourceNode) || !isPlainTextParagraph(targetNode)) {
      return getNodeHtml(targetNode)
    }

    const targetText = targetNode.textContent?.trim() ?? ""
    const cleanedTargetText = stripSourcePrefixFromTargetText(
      sourceNode.textContent?.trim() ?? "",
      targetText,
    )
    if (cleanedTargetText === targetText) {
      return getNodeHtml(targetNode)
    }

    changed = true
    return buildPlainHtmlNodeWithText(targetNode, cleanedTargetText)
  })

  return changed ? sanitizedTargetNodes.join("") : targetContent
}

const stripSourceEchoFromTargetContent = ({
  format,
  sourceContent,
  targetContent,
}: {
  format: TranslatedContentFormat
  sourceContent: string
  targetContent: string
}) =>
  format === "markdown"
    ? stripSourcePrefixFromTargetText(sourceContent, targetContent)
    : stripSourceEchoFromHtmlTargetContent(sourceContent, targetContent)

const buildHtmlParagraphPair = (sourceNode: ChildNode, targetNode: ChildNode) => {
  const sourceText = sourceNode.textContent?.trim() ?? ""
  const targetText = stripSourcePrefixFromTargetText(
    sourceText,
    targetNode.textContent?.trim() ?? "",
  )

  if (isPlainTextParagraph(sourceNode) && isPlainTextParagraph(targetNode)) {
    return `<p data-follow-translation-pair="true">${escapeHtml(sourceText)}<br><small data-follow-translation-target="true">${escapeHtml(
      targetText,
    )}</small></p>`
  }

  return `${getNodeHtml(sourceNode)}${getNodeHtml(targetNode)}`
}

const buildInterleavedHtml = (sourceContent: string, targetContent: string) => {
  const sourceNodes = getTopLevelNodes(sourceContent)
  const targetNodes = getTopLevelNodes(targetContent)

  if (!sourceNodes || !targetNodes) {
    return `${sourceContent}${targetContent}`
  }

  let targetIndex = 0
  const takeNextTextTargetNode = (sourceNode: ChildNode) => {
    while (targetIndex < targetNodes.length) {
      const targetNode = targetNodes[targetIndex++]
      if (!targetNode || isMediaOnlyNode(targetNode)) continue
      if (isEchoOnlyTargetNode(sourceNode, targetNode)) continue
      return targetNode
    }

    return null
  }

  const interleavedHtml = sourceNodes
    .map((sourceNode) => {
      if (isMediaOnlyNode(sourceNode)) {
        return getNodeHtml(sourceNode)
      }

      const targetNode = takeNextTextTargetNode(sourceNode)
      if (targetNode) return buildHtmlParagraphPair(sourceNode, targetNode)

      const sourceHtml = getNodeHtml(sourceNode)
      return isPlainTextParagraph(sourceNode)
        ? sourceHtml
        : `${sourceHtml}${TRANSLATION_PLACEHOLDER}`
    })
    .join("")

  const remainingTargetHtml = targetNodes
    .slice(targetIndex)
    .filter((targetNode) => !isMediaOnlyNode(targetNode))
    .map(getNodeHtml)
    .join("")

  return `${interleavedHtml}${remainingTargetHtml}`
}

const buildTranslationOnlyHtml = (sourceContent: string, targetContent: string) => {
  const sourceNodes = getTopLevelNodes(sourceContent)
  const targetNodes = getTopLevelNodes(targetContent)

  if (!sourceNodes || !targetNodes) {
    return targetContent
  }

  let targetIndex = 0
  const takeNextTextTargetNode = (sourceNode: ChildNode) => {
    while (targetIndex < targetNodes.length) {
      const targetNode = targetNodes[targetIndex++]
      if (!targetNode || isMediaOnlyNode(targetNode)) continue
      if (isEchoOnlyTargetNode(sourceNode, targetNode)) continue
      return targetNode
    }

    return null
  }

  const translatedHtml = sourceNodes
    .map((sourceNode) => {
      if (isMediaOnlyNode(sourceNode)) {
        return getNodeHtml(sourceNode)
      }

      const targetNode = takeNextTextTargetNode(sourceNode)
      return targetNode ? getNodeHtml(targetNode) : getNodeHtml(sourceNode)
    })
    .join("")

  const remainingTargetHtml = targetNodes
    .slice(targetIndex)
    .filter((targetNode) => !isMediaOnlyNode(targetNode))
    .map(getNodeHtml)
    .join("")

  return `${translatedHtml}${remainingTargetHtml}`
}

const buildInterleavedMarkdown = (sourceContent: string, targetContent: string) => {
  const sourceParagraphs = sourceContent.split(/\n{2,}/).map((paragraph) => paragraph.trim())
  const targetParagraphs = targetContent.split(/\n{2,}/).map((paragraph) => paragraph.trim())

  if (targetParagraphs.length < sourceParagraphs.length) {
    return sourceParagraphs
      .map((sourceParagraph, index) => {
        const targetParagraph = targetParagraphs[index]
        if (!targetParagraph) return sourceParagraph
        const cleanedTargetParagraph = stripSourcePrefixFromTargetText(
          sourceParagraph,
          targetParagraph,
        )
        return `${sourceParagraph}\n\n> ${cleanedTargetParagraph}`
      })
      .join("\n\n")
  }

  if (sourceParagraphs.length !== targetParagraphs.length) {
    const cleanedTargetContent = stripSourcePrefixFromTargetText(sourceContent, targetContent)
    return `${sourceContent}\n\n${cleanedTargetContent}`
  }

  return sourceParagraphs
    .map((sourceParagraph, index) => {
      const targetParagraph = stripSourcePrefixFromTargetText(
        sourceParagraph,
        targetParagraphs[index] ?? "",
      )
      return `${sourceParagraph}\n\n> ${targetParagraph}`
    })
    .join("\n\n")
}

export const buildTranslatedContent = ({
  source,
  target,
  mode,
  format,
}: BuildTranslatedContentOptions) => {
  const sourceContent = normalizeContent(source)
  const targetContent = normalizeContent(target)

  if (!sourceContent) return targetContent ?? ""
  if (!targetContent) {
    return mode === "bilingual" && format === "html"
      ? buildInterleavedHtml(sourceContent, "")
      : sourceContent
  }
  if (targetContent === sourceContent) return sourceContent
  const sanitizedTargetContent = stripSourceEchoFromTargetContent({
    format,
    sourceContent,
    targetContent,
  })
  if (!sanitizedTargetContent || sanitizedTargetContent === sourceContent) return sourceContent

  if (mode === "translation-only") {
    return format === "html"
      ? buildTranslationOnlyHtml(sourceContent, sanitizedTargetContent)
      : sanitizedTargetContent
  }

  return format === "markdown"
    ? buildInterleavedMarkdown(sourceContent, sanitizedTargetContent)
    : buildInterleavedHtml(sourceContent, sanitizedTargetContent)
}
