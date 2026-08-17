import { createFileRoute } from "@tanstack/react-router";
import { DeskApp } from "@/components/desk/app";
import { AppErrorComponent } from "@/lib/error-component";
import { fetchKlines, fetchSnapshot } from "@/lib/market/server";
import type { Candle, MarketSnapshot } from "@/lib/market/types";

async function withBudget<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const [snapshot, candles] = await Promise.all([
      withBudget(fetchSnapshot(), 2500),
      withBudget(
        fetchKlines({ data: { symbol: "BTCUSDT", interval: "5m", limit: 360 } }),
        2500,
      ),
    ]);
    return {
      snapshot: snapshot as MarketSnapshot | undefined,
      candles: candles as Candle[] | undefined,
    };
  },
  staleTime: 4_000,
  errorComponent: AppErrorComponent,
  component: Home,
});

function Home() {
  const { snapshot, candles } = Route.useLoaderData();
  return <DeskApp initialSnapshot={snapshot} initialKlines={candles} />;
}
