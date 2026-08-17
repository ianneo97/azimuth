import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyLiquidations,
  applyStops,
  emptyBook,
  hydrateBook,
  STARTING_CASH,
  type PaperBook,
} from "@/lib/engine/paper";
import { LIVE_STRATS } from "@/lib/engine/decide";
import type { StrategyId } from "@/lib/engine/strategies";
import type { Interval } from "@/lib/market/types";

export const LIVE_FRAMES: Interval[] = ["5m", "15m", "1h"];

export type LiveLane = {
  id: StrategyId;
  interval: Interval;
  book: PaperBook;
  lastBarBySymbol: Record<string, number>;
  lastNote: string;
};

export function liveKey(id: StrategyId, interval: Interval): string {
  return `${id}__${interval}`;
}

export function emptyLane(id: StrategyId, interval: Interval): LiveLane {
  return {
    id,
    interval,
    book: emptyBook(STARTING_CASH),
    lastBarBySymbol: {},
    lastNote: "Idle.",
  };
}
