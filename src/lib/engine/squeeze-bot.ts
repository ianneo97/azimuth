import type { Candle } from "@/lib/market/types";
import { readSqueeze, type SqueezeRead } from "./coil";

export type SqueezeAction = {
  action: "wait" | "long" | "short" | "flatten" | "none";
  reason: string;
  box: SqueezeRead | null;
};

export function decideSqueeze(
  candles: Candle[],
  pos: { side: "long" | "short" } | null | undefined,
): SqueezeAction {
  const closed = candles.length >= 2 ? candles.slice(0, -1) : candles;
  if (closed.length < 60) {
    return { action: "none", reason: "Not enough closed bars.", box: null };
  }
  const box = readSqueeze(closed);
  if (!box) return { action: "none", reason: "No read.", box: null };

  if (pos?.side === "long") {
    if (box.last < box.low) {
      return { action: "flatten", reason: `Long invalid — close back under ${fmt(box.low)}.`, box };
    }
    if (box.structure === "down") {
      return { action: "flatten", reason: "Long invalid — structure flipped under 90/200.", box };
    }
    return { action: "wait", reason: `Hold long. Die if a close is under ${fmt(box.low)}.`, box };
  }
  if (pos?.side === "short") {
    if (box.last > box.high) {
      return { action: "flatten", reason: `Short invalid — close back over ${fmt(box.high)}.`, box };
    }
    if (box.structure === "up") {
      return { action: "flatten", reason: "Short invalid — structure flipped over 90/200.", box };
    }
    return { action: "wait", reason: `Hold short. Die if a close is over ${fmt(box.high)}.`, box };
  }

  if (box.plan === "wait") return { action: "wait", reason: box.note, box };
  if (box.plan === "long") return { action: "long", reason: box.note, box };
  if (box.plan === "short") return { action: "short", reason: box.note, box };
  return { action: "none", reason: box.note, box };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const d = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(d);
}
