import type { WithOptimistic } from "@follow/hooks"
import { createOptimisticConfig, useOptimisticMutation } from "@follow/hooks"
import type { LocalAITask } from "@follow/shared/settings/interface"
import type {
  AITask,
  CreateTaskRequest,
  TaskCreateResponse,
  TaskDeleteResponse,
  TaskGetResponse,
  TaskTestRunResponse,
  TaskUpdateResponse,
  UpdateTaskRequest,
} from "@follow-app/client-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import { nanoid } from "nanoid"

import { getAISettings, setAISetting } from "~/atoms/settings/ai"
import { followApi } from "~/lib/api-client"
import { AIPersistService } from "~/modules/ai-chat/services"
import type { BizUIMessage } from "~/modules/ai-chat/store/types"
import { createDesktopLocalAIBridge } from "~/modules/local-ai/bridge"
import { getLocalAIProfileId } from "~/modules/local-ai/hooks"

const MAX_AI_TASKS = 10

// Use the generic optimistic wrapper type
type OptimisticAITask = WithOptimistic<AITask>

const aiTaskKey = "ai-task"
export const aiTaskKeys = {
  list: [aiTaskKey, "list"] as const,
  details: [aiTaskKey, "detail"] as const,
  detail: (id: string) => [...aiTaskKeys.details, id] as const,
  testRun: [aiTaskKey, "test-run"] as const,
}

const isLocalAITaskMode = () => getLocalAIProfileId("tasks") !== null

const successResponse = <T>(data: T) => ({ code: 0, data }) as const

const getLocalAITasks = (): LocalAITask[] => getAISettings().aiTasks ?? []

const setLocalAITasks = (tasks: LocalAITask[]) => {
  setAISetting("aiTasks", tasks)
}

const findLocalAITask = (id: string): LocalAITask => {
  const task = getLocalAITasks().find((item) => item.id === id)
  if (!task) {
    throw new Error("Local AI task not found")
  }
  return task
}

type TestRunAITaskOptions = {
  now?: Date
  reschedule?: boolean
  timeout?: number
}

const getNextRunAt = (
  schedule: CreateTaskRequest["schedule"],
  after: Date = new Date(),
): string | null => {
  const reference = dayjs(after)

  switch (schedule.type) {
    case "once": {
      const date = dayjs(schedule.date)
      return date.isAfter(reference) ? date.toISOString() : null
    }
    case "daily": {
      return getNextDailyRunAt(schedule.timeOfDay, reference)
    }
    case "weekly": {
      return getNextWeeklyRunAt(schedule.dayOfWeek, schedule.timeOfDay, reference)
    }
    case "monthly": {
      return getNextMonthlyRunAt(schedule.dayOfMonth, schedule.timeOfDay, reference)
    }
    default: {
      return null
    }
  }
}

const getNextDailyRunAt = (timeOfDay: string, reference: dayjs.Dayjs): string => {
  const time = dayjs(timeOfDay)
  let candidate = reference
    .hour(time.hour())
    .minute(time.minute())
    .second(time.second())
    .millisecond(time.millisecond())
  if (!candidate.isAfter(reference)) {
    candidate = candidate.add(1, "day")
  }
  return candidate.toISOString()
}

const getNextWeeklyRunAt = (
  dayOfWeek: number,
  timeOfDay: string,
  reference: dayjs.Dayjs,
): string => {
  const time = dayjs(timeOfDay)
  let candidate = reference
    .day(dayOfWeek)
    .hour(time.hour())
    .minute(time.minute())
    .second(time.second())
    .millisecond(time.millisecond())
  if (!candidate.isAfter(reference)) {
    candidate = candidate.add(1, "week")
  }
  return candidate.toISOString()
}

const getNextMonthlyRunAt = (
  dayOfMonth: number,
  timeOfDay: string,
  reference: dayjs.Dayjs,
): string => {
  const time = dayjs(timeOfDay)
  const applyDayAndTime = (value: dayjs.Dayjs) =>
    value
      .date(Math.min(dayOfMonth, value.daysInMonth()))
      .hour(time.hour())
      .minute(time.minute())
      .second(time.second())
      .millisecond(time.millisecond())

  let candidate = applyDayAndTime(reference)
  if (!candidate.isAfter(reference)) {
    candidate = applyDayAndTime(reference.add(1, "month"))
  }
  return candidate.toISOString()
}

const getPostRunScheduleUpdate = (
  task: LocalAITask,
  timestamp: Date,
): Pick<LocalAITask, "isEnabled" | "nextRunAt"> => {
  if (task.schedule.type === "once") {
    return {
      isEnabled: false,
      nextRunAt: null,
    }
  }

  return {
    isEnabled: task.isEnabled,
    nextRunAt: getNextRunAt(task.schedule, timestamp),
  }
}

const normalizeTaskOptions = (
  options: CreateTaskRequest["options"] | UpdateTaskRequest["options"],
): LocalAITask["options"] => ({
  notifyChannels: options?.notifyChannels ?? ["email"],
})

const createLocalTask = (input: CreateTaskRequest): LocalAITask => {
  const now = new Date().toISOString()
  return {
    createdAt: now,
    id: `local-ai-task-${nanoid(10)}`,
    isEnabled: input.isEnabled ?? true,
    lastError: null,
    lastResult: null,
    lastRunAt: null,
    name: input.name,
    nextRunAt: getNextRunAt(input.schedule),
    options: normalizeTaskOptions(input.options),
    prompt: input.prompt,
    runCount: 0,
    schedule: input.schedule,
    updatedAt: now,
  }
}

const updateLocalTask = (task: LocalAITask, input: UpdateTaskRequest): LocalAITask => {
  const schedule = input.schedule ?? task.schedule
  return {
    ...task,
    isEnabled: input.isEnabled ?? task.isEnabled,
    name: input.name ?? task.name,
    nextRunAt: input.schedule ? getNextRunAt(schedule) : task.nextRunAt,
    options: input.options ? normalizeTaskOptions(input.options) : task.options,
    prompt: input.prompt ?? task.prompt,
    schedule,
    updatedAt: new Date().toISOString(),
  }
}

const extractTaskPromptText = (prompt: string): string => {
  try {
    const parsed: unknown = JSON.parse(prompt)
    const text = collectTextFromLexicalState(parsed).join("\n").trim()
    return text || prompt
  } catch {
    return prompt
  }
}

const collectTextFromLexicalState = (value: unknown): string[] => {
  if (typeof value === "string") return []
  if (Array.isArray(value)) return value.flatMap(collectTextFromLexicalState)
  if (!isRecord(value)) return []

  const text = typeof value.text === "string" ? [value.text] : []
  const children = Array.isArray(value.children)
    ? value.children.flatMap(collectTextFromLexicalState)
    : []
  const root = isRecord(value.root) ? collectTextFromLexicalState(value.root) : []

  return [...text, ...children, ...root]
}

const buildLocalTaskRunMessages = ({
  output,
  prompt,
  sessionId,
  timestamp,
}: {
  output: string
  prompt: string
  sessionId: string
  timestamp: Date
}): BizUIMessage[] => {
  const assistantTimestamp = new Date(timestamp.getTime() + 1)
  return [
    {
      createdAt: timestamp,
      id: `${sessionId}-user`,
      parts: [{ text: prompt, type: "text" }],
      role: "user",
    },
    {
      createdAt: assistantTimestamp,
      id: `${sessionId}-assistant`,
      metadata: {
        finishTime: assistantTimestamp.toISOString(),
      },
      parts: [{ text: output, type: "text" }],
      role: "assistant",
    },
  ]
}

const persistLocalTaskRunReport = async ({
  output,
  prompt,
  sessionId,
  task,
  timestamp,
}: {
  output: string
  prompt: string
  sessionId: string
  task: LocalAITask
  timestamp: Date
}) => {
  await AIPersistService.ensureSession(sessionId, {
    createdAt: timestamp,
    isLocal: true,
    title: task.name,
    updatedAt: timestamp,
  })
  await AIPersistService.upsertMessages(
    sessionId,
    buildLocalTaskRunMessages({
      output,
      prompt,
      sessionId,
      timestamp,
    }),
  )
}

const replaceLocalTask = (updatedTask: LocalAITask) => {
  setLocalAITasks(
    getLocalAITasks().map((task) => (task.id === updatedTask.id ? updatedTask : task)),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const listAITasks = async (): Promise<AITask[]> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.list().then((res) => res.data)
  }

  return getLocalAITasks()
}

export const getAITask = async (id: string): Promise<AITask> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.get({ id }).then((res) => res.data)
  }

  return findLocalAITask(id)
}

export const createAITask = async (input: CreateTaskRequest): Promise<TaskCreateResponse> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.create(input)
  }

  const task = createLocalTask(input)
  setLocalAITasks([task, ...getLocalAITasks()])
  return successResponse(task) satisfies TaskCreateResponse
}

export const updateAITask = async (input: UpdateTaskRequest): Promise<TaskUpdateResponse> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.update(input)
  }

  const updatedTask = updateLocalTask(findLocalAITask(input.id), input)
  replaceLocalTask(updatedTask)
  return successResponse(updatedTask) satisfies TaskUpdateResponse
}

export const deleteAITask = async ({ id }: { id: string }): Promise<TaskDeleteResponse> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.delete({ id })
  }

  setLocalAITasks(getLocalAITasks().filter((task) => task.id !== id))
  return successResponse(null) satisfies TaskDeleteResponse
}

export const testRunAITask = async (
  { id }: { id: string },
  options?: TestRunAITaskOptions,
): Promise<TaskTestRunResponse> => {
  if (!isLocalAITaskMode()) {
    return followApi.aiTask.testRun({ id }, options)
  }

  const profileId = getLocalAIProfileId("tasks")
  if (!profileId) {
    throw new Error("Local AI profile is not configured for tasks")
  }

  const task = findLocalAITask(id)
  const timestamp = options?.now ?? new Date()
  const prompt = extractTaskPromptText(task.prompt)
  const sessionId = `ai-task-${task.id}-${nanoid(8)}`
  const scheduleUpdate = options?.reschedule ? getPostRunScheduleUpdate(task, timestamp) : {}

  try {
    const result = await createDesktopLocalAIBridge().runTask({
      context: {
        task: {
          id: task.id,
          name: task.name,
          schedule: task.schedule,
        },
      },
      feature: "tasks",
      profileId,
      prompt,
    })
    const output = result.output.trim()
    const updatedTask: LocalAITask = {
      ...task,
      ...scheduleUpdate,
      lastError: null,
      lastResult: output,
      lastRunAt: timestamp.toISOString(),
      runCount: task.runCount + 1,
      updatedAt: timestamp.toISOString(),
    }

    replaceLocalTask(updatedTask)
    await persistLocalTaskRunReport({
      output,
      prompt,
      sessionId,
      task: updatedTask,
      timestamp,
    })

    return successResponse({
      result: output,
      sessionId,
      taskId: task.id,
    }) satisfies TaskTestRunResponse
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    replaceLocalTask({
      ...task,
      ...scheduleUpdate,
      lastError: message,
      lastRunAt: timestamp.toISOString(),
      runCount: task.runCount + 1,
      updatedAt: timestamp.toISOString(),
    })

    return successResponse({
      error: message,
      taskId: task.id,
    }) satisfies TaskTestRunResponse
  }
}

export const runDueLocalAITasks = async (now = new Date()): Promise<number> => {
  if (!isLocalAITaskMode()) return 0

  const dueTasks = getLocalAITasks().filter((task) => {
    if (!task.isEnabled || !task.nextRunAt) return false
    return !dayjs(task.nextRunAt).isAfter(now)
  })

  for (const task of dueTasks) {
    await testRunAITask({ id: task.id }, { now, reschedule: true })
  }

  return dueTasks.length
}

// Queries

export const useAITaskListQuery = () => {
  const { data } = useQuery({
    queryKey: aiTaskKeys.list,
    queryFn: listAITasks,
  })
  return data
}

export const useCanCreateNewAITask = () => {
  const tasks = useAITaskListQuery()
  return !tasks || tasks.length < MAX_AI_TASKS
}

export const useAITaskQuery = (id: string | undefined, opts?: { enabled?: boolean }) => {
  const enabled = !!id && (opts?.enabled ?? true)
  const { data } = useQuery({
    queryKey: id ? aiTaskKeys.detail(id) : aiTaskKeys.details,
    queryFn: () =>
      getAITask(id as string).then((data) => successResponse(data) satisfies TaskGetResponse),
    enabled,
  })
  return data?.data
}

// Mutations

export const useCreateAITaskMutation = () => {
  return useOptimisticMutation(
    createOptimisticConfig.forCreate<OptimisticAITask, CreateTaskRequest, TaskCreateResponse>({
      mutationFn: createAITask,
      queryKey: aiTaskKeys.list,
      generateOptimistic: (variables) => ({
        name: variables.name,
        prompt: variables.prompt,
        isEnabled: variables.isEnabled ?? true,
        schedule: variables.schedule,
        options: variables.options ?? { notifyChannels: ["email"] },
        userId: "temp-user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        lastResult: null,
        lastError: null,
      }),

      errorMessage: "Failed to create AI task",
      retryable: false,
    }),
  )
}

export const useUpdateAITaskMutation = () => {
  return useOptimisticMutation(
    createOptimisticConfig.forUpdate<OptimisticAITask, UpdateTaskRequest>({
      mutationFn: updateAITask,
      queryKey: aiTaskKeys.list,
      getId: (variables) => variables.id,
      errorMessage: "Failed to update AI task",
      retryable: false,
    }),
  )
}

export const useDeleteAITaskMutation = () => {
  return useOptimisticMutation(
    createOptimisticConfig.forDelete<OptimisticAITask, { id: string }>({
      mutationFn: deleteAITask,
      queryKey: aiTaskKeys.list,
      getId: (variables) => variables.id,

      errorMessage: "Failed to delete AI task",
      retryable: false,
    }),
  )
}

export const useTestRunAITaskMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: aiTaskKeys.testRun,
    mutationFn: ({ id }: { id: string }) => testRunAITask({ id }, { timeout: 80000 }),
    onSuccess: async (_res, { id }) => {
      // Refresh task list and detail to reflect any updated run info
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiTaskKeys.list }),
        queryClient.invalidateQueries({ queryKey: aiTaskKeys.detail(id) }),
      ])
    },
  })
}
