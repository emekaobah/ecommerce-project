import { describe, expect, test } from "bun:test"
import type { FulfilmentState } from "./fulfilment"
import { ORDER_STAGES, orderStageOf, statesInStage, type OrderStage } from "./order-stage"

describe("orderStageOf", () => {
  test.each<[FulfilmentState, OrderStage]>([
    ["new", "new"],
    ["accepted", "picking"],
    ["picking", "picking"],
    ["partially_available", "picking"],
    ["packed", "ready"],
    ["label_booked", "ready"],
    ["ready_for_pickup", "ready"],
    ["courier_confirmed", "out"],
    ["handed_to_courier", "out"],
    ["in_transit", "out"],
  ])("puts %s orders in %s", (state, stage) => {
    expect(orderStageOf(state)).toBe(stage)
  })

  test.each<FulfilmentState>(["rejected", "cancelled", "delivered", "collected", "not_collected"])(
    "puts finished %s orders in no stage",
    (state) => {
      expect(orderStageOf(state)).toBeNull()
    },
  )
})

describe("statesInStage", () => {
  test("lists the states each stage holds", () => {
    expect(statesInStage("new")).toEqual(["new"])
    expect(statesInStage("picking")).toEqual(["accepted", "picking", "partially_available"])
    expect(statesInStage("ready")).toEqual(["packed", "label_booked", "ready_for_pickup"])
    expect(statesInStage("out")).toEqual(["courier_confirmed", "handed_to_courier", "in_transit"])
  })

  test("the stages run in the order the tiles show them", () => {
    expect(ORDER_STAGES).toEqual(["new", "picking", "ready", "out"])
  })
})
