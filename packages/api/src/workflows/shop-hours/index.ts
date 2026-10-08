import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { OpenPeriod, WeeklyHours } from "@oja/domain"
import { pauseInForce } from "../../modules/shop-hours/filters"
import { SHOP_HOURS_MODULE, type ShopHoursModuleService } from "../../modules/shop-hours"

// Writes to a shop's hours (ADR 0004, #68). Each is one step, undone if a workflow it runs in fails.

const service = (container: { resolve: <T>(key: string) => T }) => container.resolve<ShopHoursModuleService>(SHOP_HOURS_MODULE)

type WeeklyHoursRow = { id: string; seller_id: string; weekly: WeeklyHours }

/** Sets the shop's weekly hours, replacing the ones it had. */
const setWeeklyHoursStep = createStep(
  "set-shop-weekly-hours-step",
  async (input: { seller_id: string; weekly: WeeklyHours }, { container }) => {
    const shopHours = service(container)
    // The model keeps the hours as untyped JSON.
    const [previous] = (await shopHours.listShopWeeklyHours({ seller_id: input.seller_id })) as unknown as WeeklyHoursRow[]
    const saved = previous
      ? await shopHours.updateShopWeeklyHours({ id: previous.id, weekly: input.weekly as never })
      : await shopHours.createShopWeeklyHours({ seller_id: input.seller_id, weekly: input.weekly as never })
    return new StepResponse(saved as unknown as WeeklyHoursRow, { previous: previous ?? null, id: saved.id })
  },
  async (undo, { container }) => {
    if (!undo) return
    if (undo.previous) await service(container).updateShopWeeklyHours({ id: undo.previous.id, weekly: undo.previous.weekly as never })
    else await service(container).deleteShopWeeklyHours(undo.id)
  }
)

export const setShopWeeklyHoursWorkflow = createWorkflow(
  "set-shop-weekly-hours",
  (input: { seller_id: string; weekly: WeeklyHours }) => new WorkflowResponse(setWeeklyHoursStep(input))
)

export type HoursExceptionInput = {
  seller_id: string
  starts_on: string
  ends_on: string
  closed: boolean
  periods: OpenPeriod[]
  note: string | null
}

const createExceptionStep = createStep(
  "create-shop-hours-exception-step",
  async (input: HoursExceptionInput, { container }) => {
    const created = await service(container).createShopHoursExceptions({ ...input, periods: input.periods as never })
    return new StepResponse(created, created.id)
  },
  async (id, { container }) => {
    if (id) await service(container).deleteShopHoursExceptions(id)
  }
)

export const createShopHoursExceptionWorkflow = createWorkflow(
  "create-shop-hours-exception",
  (input: HoursExceptionInput) => new WorkflowResponse(createExceptionStep(input))
)

const deleteExceptionStep = createStep(
  "delete-shop-hours-exception-step",
  async (input: { id: string }, { container }) => {
    await service(container).softDeleteShopHoursExceptions(input.id)
    return new StepResponse(undefined, input.id)
  },
  async (id, { container }) => {
    if (id) await service(container).restoreShopHoursExceptions(id)
  }
)

export const deleteShopHoursExceptionWorkflow = createWorkflow(
  "delete-shop-hours-exception",
  (input: { id: string }) => new WorkflowResponse(deleteExceptionStep(input))
)

/** Ends an exception that has started on an earlier day, keeping the days already past. */
const endExceptionStep = createStep(
  "end-shop-hours-exception-step",
  async (input: { id: string; ends_on: string }, { container }) => {
    const [previous] = await service(container).listShopHoursExceptions({ id: input.id })
    await service(container).updateShopHoursExceptions({ id: input.id, ends_on: input.ends_on })
    return new StepResponse(undefined, { id: input.id, ends_on: previous!.ends_on })
  },
  async (undo, { container }) => {
    if (undo) await service(container).updateShopHoursExceptions(undo)
  }
)

export const endShopHoursExceptionWorkflow = createWorkflow(
  "end-shop-hours-exception",
  (input: { id: string; ends_on: string }) => new WorkflowResponse(endExceptionStep(input))
)

type PauseRow = { id: string; seller_id: string; starts_at: Date; ends_at: Date | null; note: string | null }

/** The shop's pause in force at `at`, if any. */
async function currentPause(shopHours: ShopHoursModuleService, sellerId: string, at: Date): Promise<PauseRow | undefined> {
  const pauses = (await shopHours.listShopPauses(pauseInForce(sellerId, at))) as PauseRow[]
  return pauses[0]
}

export type PauseShopInput = { seller_id: string; at: Date; ends_at: Date | null; note: string | null }

/** How to undo a pause: put back the one it changed, or remove the one it started. */
type PauseUndo = { previous: PauseRow | null; id: string }

/** Pauses the shop from `at`; pausing a paused shop changes when the pause ends and its note. */
const pauseShopStep = createStep(
  "pause-shop-step",
  async (input: PauseShopInput, { container }) => {
    const shopHours = service(container)
    const current = await currentPause(shopHours, input.seller_id, input.at)
    if (current) {
      const saved = await shopHours.updateShopPauses({ id: current.id, ends_at: input.ends_at, note: input.note })
      return new StepResponse<PauseRow, PauseUndo>(saved as PauseRow, { previous: current, id: current.id })
    }
    const created = await shopHours.createShopPauses({
      seller_id: input.seller_id,
      starts_at: input.at,
      ends_at: input.ends_at,
      note: input.note,
    })
    return new StepResponse<PauseRow, PauseUndo>(created as PauseRow, { previous: null, id: created.id })
  },
  async (undo, { container }) => {
    if (!undo) return
    const shopHours = service(container)
    if (undo.previous) await shopHours.updateShopPauses({ id: undo.id, ends_at: undo.previous.ends_at, note: undo.previous.note })
    else await shopHours.deleteShopPauses(undo.id)
  }
)

export const pauseShopWorkflow = createWorkflow("pause-shop", (input: PauseShopInput) => new WorkflowResponse(pauseShopStep(input)))

/** Ends the shop's pause at `at`; kept, so the clocks still know the shop was paused. Nothing to do when not paused. */
const resumeShopStep = createStep(
  "resume-shop-step",
  async (input: { seller_id: string; at: Date }, { container }) => {
    const shopHours = service(container)
    const current = await currentPause(shopHours, input.seller_id, input.at)
    if (!current) return new StepResponse(undefined, null)
    await shopHours.updateShopPauses({ id: current.id, ends_at: input.at })
    return new StepResponse(undefined, { id: current.id, ends_at: current.ends_at })
  },
  async (undo, { container }) => {
    if (undo) await service(container).updateShopPauses({ id: undo.id, ends_at: undo.ends_at })
  }
)

export const resumeShopWorkflow = createWorkflow(
  "resume-shop",
  (input: { seller_id: string; at: Date }) => new WorkflowResponse(resumeShopStep(input))
)
