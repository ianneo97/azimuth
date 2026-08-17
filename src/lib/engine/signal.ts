import type { Candle } from "@/lib/market/types";
import { adx, atr, ema, sma } from "./indicators";
import { buildProfile, profileGate, type VolumeProfile } from "./profile";

export type TapeFamily = "benchmark" | "trend" | "reversion" | "router";

export type HtfBias = "up" | "down" | "flat";

export type HtfRead = { bias: HtfBias; why: string };

export type TapeCache = {
  ema12: Array<number | null>;
  ema20: Array<number | null>;
  ema26: Array<number | null>;
  atr14: Array<number | null>;
  adx14: Array<number | null>;
  volSma: Array<number | null>;
};

export function buildTape(candles: Candle[]): TapeCache {
  const closes = candles.map((c) => c.close);
  return {
    ema12: ema(closes, 12),
    ema20: ema(closes, 20),
    ema26: ema(closes, 26),
    atr14: atr(candles, 14),
    adx14: adx(candles, 14),
    volSma: sma(
      candles.map((c) => c.volume),
      20,
    ),
  };
}

export function inferBucketMs(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const dt = Math.max(1, candles[candles.length - 1]!.t - candles[candles.length - 2]!.t);
  if (dt <= 2_000) return 60_000;
  if (dt <= 90_000) return 15 * 60_000;
  if (dt <= 6 * 60_000) return 15 * 60_000;
  if (dt <= 20 * 60_000) return 60 * 60_000;
  if (dt <= 70 * 60_000) return 4 * 3_600_000;
  if (dt <= 5 * 3_600_000) return 24 * 3_600_000;
  return 0;
}

export function foldByMs(candles: Candle[], bucketMs: number): Candle[] {
  if (bucketMs <= 0 || candles.length === 0) return candles;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let bucket = -1;
  for (const c of candles) {
    const b = Math.floor(c.t / bucketMs);
    if (cur && b === bucket) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.quoteVolume += c.quoteVolume;
      cur.trades += c.trades;
      cur.takerBuy += c.takerBuy;
    } else {
      if (cur) out.push(cur);
      bucket = b;
      cur = {
        t: b * bucketMs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        quoteVolume: c.quoteVolume,
        trades: c.trades,
        takerBuy: c.takerBuy,
      };
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function readHtf(candles: Candle[]): HtfRead {
  const ms = inferBucketMs(candles);
  if (!ms) return { bias: "flat", why: "No HTF on this interval." };
  const htf = foldByMs(candles, ms);
  const closed = htf.length >= 2 ? htf.slice(0, -1) : htf;
  if (closed.length < 28) return { bias: "flat", why: "HTF still filling." };
  const tape = buildTape(closed);
  const i = closed.length - 1;
  const e12 = tape.ema12[i];
  const e26 = tape.ema26[i];
  if (e12 == null || e26 == null) return { bias: "flat", why: "HTF warming." };
  if (e12 > e26) return { bias: "up", why: "HTF 12 over 26." };
  if (e12 < e26) return { bias: "down", why: "HTF 12 under 26." };
  return { bias: "flat", why: "HTF flat." };
}

export function passEntry(
  candles: Candle[],
  tape: TapeCache,
  i: number,
  family: TapeFamily,
  side: "long" | "short" = "long",
  _htf?: HtfRead,
  profile?: VolumeProfile | null,
): { ok: boolean; why: string } {
  if (family === "benchmark") return { ok: true, why: "Benchmark." };
  if (i < 26 || i >= candles.length) return { ok: false, why: "Not enough bars." };

  const bar = candles[i]!;
  const range = bar.high - bar.low;
  const loc = range > 0 ? (bar.close - bar.low) / range : 0.5;
  const a0 = tape.atr14[i];
  const e20 = tape.ema20[i];
  const e12 = tape.ema12[i];
  const e26 = tape.ema26[i];
  const dmi = tape.adx14[i];
  const vRef = tape.volSma[i - 1] ?? tape.volSma[i];
  const volMult = vRef && vRef > 0 ? bar.volume / vRef : 1;
  const spent =
    i >= 20 && candles[i - 20]!.close > 0
      ? bar.close / candles[i - 20]!.close - 1
      : 0;

  const trending = dmi != null && dmi >= 22;
  const quiet = dmi != null && dmi < 16;
  const mode: "trend" | "reversion" =
    family === "router" ? (trending ? "trend" : "reversion") : family === "reversion" ? "reversion" : "trend";

  if (side === "long") {
    if (a0 != null && a0 > 0 && e20 != null && bar.close - e20 > 2 * a0) {
      return { ok: false, why: "Chase — 2 ATR over EMA 20." };
    }
    if (mode === "trend" && spent > 0.08) {
      return { ok: false, why: "Day already ran 8%." };
    }
    if (mode === "trend" && volMult < 0.9) {
      return { ok: false, why: "No volume behind the long." };
    }
    if (mode === "reversion" && volMult > 3.2) {
      return { ok: false, why: "Climax print — not a fade." };
    }
    if (mode === "trend" && loc < 0.45) {
      return { ok: false, why: "Closed weak — lower half of the bar." };
    }
    if (mode === "trend" && quiet) {
      return { ok: false, why: "ADX dead — no trend." };
    }
    if (mode === "reversion" && trending && dmi != null && dmi >= 28) {
      return { ok: false, why: "ADX 28+ — skip the fade." };
    }
    if (mode === "trend" && e12 != null && e26 != null && e12 < e26) {
      return { ok: false, why: "Against 12/26." };
    }
    const pg = profileGate(profile ?? null, bar.close, a0, mode, "long");
    if (pg && !pg.ok) return pg;
    return { ok: true, why: "Tape clear." };
  }

  if (a0 != null && a0 > 0 && e20 != null && e20 - bar.close > 2 * a0) {
    return { ok: false, why: "Chase — 2 ATR under EMA 20." };
  }
  if (mode === "trend" && spent < -0.08) {
    return { ok: false, why: "Day already dumped 8%." };
  }
  if (mode === "trend" && volMult < 0.9) {
    return { ok: false, why: "No volume behind the short." };
  }
  if (mode === "trend" && loc > 0.55) {
    return { ok: false, why: "Closed strong — upper half of the bar." };
  }
  if (mode === "trend" && e12 != null && e26 != null && e12 > e26) {
    return { ok: false, why: "Against 12/26." };
  }
  const pg = profileGate(profile ?? null, bar.close, a0, mode, "short");
  if (pg && !pg.ok) return pg;
  return { ok: true, why: "Tape clear." };
}

export function readSignal(
  candles: Candle[],
  family: TapeFamily,
  side: "long" | "short" = "long",
): { ok: boolean; why: string; htf: HtfRead; profile: VolumeProfile | null } {
  const closed = candles.length >= 2 ? candles.slice(0, -1) : candles;
  const htf = readHtf(closed);
  const profile = buildProfile(closed);
  if (closed.length < 30) return { ok: false, why: "Not enough closed bars.", htf, profile };
  return {
    ...passEntry(closed, buildTape(closed), closed.length - 1, family, side, htf, profile),
    htf,
    profile,
  };
}
