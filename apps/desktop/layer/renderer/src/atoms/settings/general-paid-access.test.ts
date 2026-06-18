import { UserRole } from "@follow/constants"
import { useUserStore } from "@follow/store/user/store"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { clearAISettings, getAISettings, setAISetting } from "./ai"
import { clearGeneralSettings, getGeneralSettings, setGeneralSetting } from "./general"
import { shouldPrefetchAITranslation } from "./local-ai-paid-access"

const enableLocalTranslation = () => {
  const { localAI } = getAISettings()

  setAISetting("localAI", {
    ...localAI,
    enabled: true,
    defaultProfileId: null,
    featureProfileIds: {
      translation: "profile-local",
    },
    featureRouting: {
      ...localAI.featureRouting,
      translation: "local",
    },
  })
}

describe("general paid setting access", () => {
  beforeEach(() => {
    Object.defineProperty(window, "dispatchEvent", {
      configurable: true,
      value: vi.fn(),
    })
    clearAISettings()
    clearGeneralSettings()
    useUserStore.setState({
      role: UserRole.Free,
      roleEndAt: null,
      whoami: null,
    })
  })

  test("allows free accounts to enable translation settings when local AI translation is configured", () => {
    enableLocalTranslation()

    setGeneralSetting("translation", true)
    setGeneralSetting("translationMode", "translation-only")

    expect(getGeneralSettings().translation).toBe(true)
    expect(getGeneralSettings().translationMode).toBe("translation-only")
  })

  test("keeps cloud-only translation settings locked for free accounts", () => {
    setGeneralSetting("translation", true)
    setGeneralSetting("translationMode", "translation-only")

    expect(getGeneralSettings().translation).toBe(false)
    expect(getGeneralSettings().translationMode).toBe("bilingual")
  })

  test("allows translation prefetch for free accounts when local AI translation is configured", () => {
    expect(
      shouldPrefetchAITranslation({
        enabled: true,
        isLocalAITranslationAccessEnabled: true,
        userRole: UserRole.Free,
      }),
    ).toBe(true)
  })

  test("keeps cloud-only translation prefetch disabled for free accounts", () => {
    expect(
      shouldPrefetchAITranslation({
        enabled: true,
        isLocalAITranslationAccessEnabled: false,
        userRole: UserRole.Free,
      }),
    ).toBe(false)
  })
})
