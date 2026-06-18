export const canUseTimelineAI = ({
  aiEnabled,
  localProfileId,
}: {
  aiEnabled: boolean
  localProfileId: string | null
}): boolean => aiEnabled || localProfileId !== null
