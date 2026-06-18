import { describe, expect, test } from "vitest"

import { defaultResources } from "./default-resource.electron"

describe("electron default i18n resources", () => {
  test("uses localized AI resources for Chinese languages", () => {
    expect(defaultResources["zh-CN"].ai?.["features.title"]).toBe("功能")
    expect(defaultResources["zh-CN"].ai?.["settings.panel_style.label"]).toBe("面板样式")
    expect(defaultResources["zh-TW"].ai?.["features.title"]).toBe("功能")
    expect(defaultResources["zh-TW"].ai?.["settings.panel_style.label"]).toBe("面板樣式")
  })
})
