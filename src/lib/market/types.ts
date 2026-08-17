export type Interval = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuy: number;
};

export type Ticker = {
  symbol: string;
  last: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  quoteVolume: number;
  bid: number;
  ask: number;
};

export type OraclePrice = {
  symbol: string;
  price: number;
  conf: number;
  expo: number;
  publishTime: number;
  ema: number;
};

export type MarketSnapshot = {
  tickers: Ticker[];
  oracles: OraclePrice[];
  fetchedAt: number;
};

export type BookLevel = { price: number; qty: number };

export type OrderBook = {
  lastUpdateId: number;
  bids: BookLevel[];
  asks: BookLevel[];
};

export type AggTrade = {
  id: number;
  price: number;
  qty: number;
  t: number;
  isBuyerMaker: boolean;
};
