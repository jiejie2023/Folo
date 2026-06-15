import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"

import { aiTaskKeys, runDueLocalAITasks } from "~/modules/ai-task/query"

const LOCAL_AI_TASK_SCHEDULER_INTERVAL = 60_000

export const LocalAITaskSchedulerProvider = () => {
  const queryClient = useQueryClient()
  const runningRef = useRef(false)

  const runScheduler = useCallback(async () => {
    if (runningRef.current) return

    runningRef.current = true
    try {
      const runCount = await runDueLocalAITasks()
      if (runCount > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: aiTaskKeys.list }),
          queryClient.invalidateQueries({ queryKey: aiTaskKeys.details }),
        ])
      }
    } catch (error) {
      console.error("Failed to run local AI task scheduler:", error)
    } finally {
      runningRef.current = false
    }
  }, [queryClient])

  useEffect(() => {
    void runScheduler()

    const intervalId = window.setInterval(runScheduler, LOCAL_AI_TASK_SCHEDULER_INTERVAL)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runScheduler()
      }
    }

    window.addEventListener("focus", runScheduler)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("focus", runScheduler)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [runScheduler])

  return null
}
