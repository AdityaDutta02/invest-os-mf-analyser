// lib/task-sdk.ts — Terminal AI Task SDK (server-side only)
// Only createDelayedTask is needed so far: the bulk-load cron route
// self-reschedules a 1-minute-out one-shot callback to drain the corpus
// backfill far faster than the platform's 1-hour minimum cron interval,
// without requiring any locally-held credential (the callback receives its
// own task token automatically, same as every other scheduled task).
const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!

interface DelayedTaskParams {
  name: string
  callbackPath: string
  delayMinutes: number // 1-1440
  payload?: Record<string, unknown>
}

interface DelayedTask {
  id: string
  oneShot: true
  nextRunAt: string
}

export async function createDelayedTask(params: DelayedTaskParams, taskToken: string): Promise<DelayedTask> {
  const res = await fetch(`${GATEWAY_URL}/tasks/delayed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${taskToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error: string }).error ?? `createDelayedTask error ${res.status}`)
  }
  return res.json() as Promise<DelayedTask>
}
