import type { Candle } from "@/lib/market/types";

export type ProfileLoc = "above" | "value" | "below";
export type ProfileShape = "D" | "P" | "b" | "thin";

export type ProfileRow = {
  price: number;
  vol: number;
  inValue: boolean;
  poc: boolean;
};

export type VolumeProfile = {
  rows: ProfileRow[];
  poc: number;
  vah: number;
  val: number;
  total: number;
  loc: ProfileLoc;
  shape: ProfileShape;
  atHvn: boolean;
  atLvn: boolean;
  note: string;
};

const VALUE_PCT = 0.7;

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = n > 5 ? 10 : n > 2 ? 5 : n > 1 ? 2 : 1;
  return step * pow;
}

function binOf(price: number, lo: number, step: number): number {
  return Math.max(0, Math.floor((price - lo) / step));
}

export function buildProfile(candles: Candle[], lastPrice?: number): VolumeProfile | null {
  if (candles.length < 12) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  const span = hi - lo;
  if (!(span > 0)) return null;
  const step = niceStep(span / 48);
  const bins = Math.max(8, Math.ceil(span / step) + 1);
  const vol = new Array<number>(bins).fill(0);
  let total = 0;
  for (const c of candles) {
    const a = binOf(c.low, lo, step);
    const b = binOf(c.high, lo, step);
    const n = Math.max(1, b - a + 1);
    const share = c.volume / n;
    for (let i = a; i <= b && i < bins; i++) vol[i] += share;
    total += c.volume;
  }
  if (!(total > 0)) return null;

  let pocI = 0;
  for (let i = 1; i < bins; i++) if (vol[i]! > vol[pocI]!) pocI = i;

  let vaLo = pocI;
  let vaHi = pocI;
  let acc = vol[pocI]!;
  const target = total * VALUE_PCT;
  while (acc < target && (vaLo > 0 || vaHi < bins - 1)) {
    const up = vaHi + 1 < bins ? vol[vaHi + 1]! : -1;
    const dn = vaLo > 0 ? vol[vaLo - 1]! : -1;
    if (up > dn) {
      vaHi++;
      acc += vol[vaHi]!;
    } else if (dn > up) {
      vaLo--;
      acc += vol[vaLo]!;
    } else if (vaHi + 1 < bins) {
      vaHi++;
      acc += vol[vaHi]!;
    } else if (vaLo > 0) {
      vaLo--;
      acc += vol[vaLo]!;
    } else break;
  }

  const mean = total / bins;
  const px = (i: number) => lo + (i + 0.5) * step;
  const poc = px(pocI);
  const vah = lo + (vaHi + 1) * step;
  const val = lo + vaLo * step;
  const last = lastPrice ?? candles[candles.length - 1]!.close;
  const loc: ProfileLoc = last > vah ? "above" : last < val ? "below" : "value";

  let upper = 0;
  let lower = 0;
  for (let i = 0; i < bins; i++) {
    if (i > pocI) upper += vol[i]!;
    else if (i < pocI) lower += vol[i]!;
  }
  const filled = vol.filter((v) => v > mean * 0.25).length;
  let shape: ProfileShape = "D";
  if (filled < bins * 0.28) shape = "thin";
  else if (upper > lower * 1.35) shape = "P";
  else if (lower > upper * 1.35) shape = "b";

  const lastBin = Math.min(bins - 1, binOf(last, lo, step));
  const atHvn = vol[lastBin]! >= mean * 1.6;
  const atLvn = vol[lastBin]! > 0 && vol[lastBin]! <= mean * 0.35;

  const rows: ProfileRow[] = vol.map((v, i) => ({
    price: px(i),
    vol: v,
    inValue: i >= vaLo && i <= vaHi,
    poc: i === pocI,
  }));

  const note =
    loc === "above"
      ? `Above value. POC ${poc.toPrecision(6)} · VAH ${vah.toPrecision(6)}.`
      : loc === "below"
        ? `Below value. VAL ${val.toPrecision(6)} · POC ${poc.toPrecision(6)}.`
        : `In value (${shape}). VAL ${val.toPrecision(6)} · POC ${poc.toPrecision(6)} · VAH ${vah.toPrecision(6)}.`;

  return { rows, poc, vah, val, total, loc, shape, atHvn, atLvn, note };
}

export function profileGate(
  profile: VolumeProfile | null,
  close: number,
  atr: number | null,
  mode: "trend" | "reversion",
  side: "long" | "short",
): { ok: boolean; why: string } | null {
  if (!profile) return null;
  const a0 = atr != null && atr > 0 ? atr : 0;
  const { loc, vah, val, poc, atHvn, shape } = profile;

  if (side === "long") {
    if (mode === "trend") {
      if (a0 > 0 && close > vah + 0.5 * a0) {
        return { ok: false, why: "Chase — extended above VAH." };
      }
      if (loc === "below" && close < val) {
        return { ok: false, why: "Under value — wait for VAL reclaim." };
      }
      if (atHvn && close < poc) {
        return { ok: false, why: "HVN under POC — absorption." };
      }
    } else {
      if (loc === "above") return { ok: false, why: "Above value — not a fade." };
      if (loc === "value" && close > poc) {
        return { ok: false, why: "In value, above POC — late fade." };
      }
    }
    return { ok: true, why: profile.note };
  }

  if (mode === "trend") {
    if (a0 > 0 && close < val - 0.5 * a0) {
      return { ok: false, why: "Chase — extended under VAL." };
    }
    if (loc === "above" && close > vah) {
      return { ok: false, why: "Over value — wait for VAH lose." };
    }
    if (atHvn && close > poc) {
      return { ok: false, why: "HVN over POC — absorption." };
    }
  } else {
    if (loc === "below") return { ok: false, why: "Below value — not a fade." };
    if (loc === "value" && close < poc) {
      return { ok: false, why: "In value, under POC — late fade." };
    }
  }
  return { ok: true, why: `${shape} profile · ${loc}.` };
}
