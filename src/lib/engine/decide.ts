import type { Candle } from "@/lib/market/types";
import type { Position } from "./paper";
import { readSignal } from "./signal";
import { decideSqueeze } from "./squeeze-bot";
import { currentStance, strategyById, TAPE_STRATS, type StrategyId } from "./strategies";
import { decideWyckoff } from "./wyckoff";

export type BotAction = "wait" | "long" | "short" | "flatten" | "none";

export function decideAction(
  strategy: StrategyId,
  candles: Candle[],
  pos: Position | undefined,
): { action: BotAction; reason: string } {
  let raw: { action: BotAction; reason: string };
  if (strategy === "wyckoff") raw = decideWyckoff(candles, pos);
  else if (strategy === "coil-break") raw = decideSqueeze(candles, pos);
  else if (strategy === "buy-hold") {
    raw = pos
      ? { action: "wait", reason: "Holding the coin." }
      : { action: "long", reason: "Buy and hold." };
  } else {
    const st = currentStance(candles, strategy);
    if (pos && st.stance === "flat") raw = { action: "flatten", reason: st.reason };
    else if (!pos && st.stance === "long") raw = { action: "long", reason: st.reason };
    else raw = { action: "wait", reason: st.reason };
  }
  if ((raw.action === "long" || raw.action === "short") && !pos) {
    const family = strategyById(strategy).family;
    const gate = readSignal(candles, family, raw.action === "short" ? "short" : "long");
    if (!gate.ok) return { action: "wait", reason: gate.why };
  }
  return raw;
}

export const LIVE_STRATS: StrategyId[] = TAPE_STRATS;
