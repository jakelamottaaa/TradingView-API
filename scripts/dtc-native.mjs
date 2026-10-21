/** Read-only DTC source assessment; never sends Telegram or broker requests. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertNativeContext(info, symbol, session) {
  if (info.full_name !== symbol) throw new Error('SUBSTITUTED_FEED');
  if (!session || info.subsession_id !== session) throw new Error('SESSION_NOT_VERIFIED');
}

export function nativeDtcBuys(data, options) {
  const { symbol, now, buyPlot = 'DTC_Buy_Signal', atrPlot = 'DTC_ATR', after = -Infinity, maxAge = Infinity } = options;
  if (!/^[A-Z0-9_]+:[A-Z0-9][A-Z0-9_.-]*$/.test(symbol) || !Number.isFinite(now)) throw new Error('INVALID_CONTEXT');
  if (!Object.values(data.indicator.plots).includes(buyPlot)) throw new Error('BUY_PLOT_MISSING');
  const candles = new Map(); let previous = -1;
  for (const c of data.candles) {
    if (!Number.isSafeInteger(c.time) || c.time % 60 || c.time <= previous
      || ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
      || Math.min(c.open, c.high, c.low, c.close) <= 0 || c.volume < 0
      || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close)) throw new Error('INVALID_CANDLES');
    candles.set(c.time, c); previous = c.time;
  }
  const seen = new Set(); const events = [];
  const last = data.candles.at(-1)?.time;
  let closedBars = 0;
  for (const row of data.values) {
    if (seen.has(row.$time)) throw new Error('DUPLICATE_STUDY_ROW');
    seen.add(row.$time);
    const c = candles.get(row.$time);
    if (!c) continue; // TradingView may return study warmup rows before requested candles.
    const value = row[buyPlot];
    if (Number.isFinite(value) && value !== 0 && value !== 1) throw new Error('NON_BINARY_BUY_PLOT');
    // Require a successor from the native stream: a frozen intrabar flag is not a confirmed BUY.
    if (!(c.time < last && c.time + 60 <= now - 2)) continue;
    closedBars += 1;
    if (value !== 1 || c.time + 60 <= after || now - (c.time + 60) > maxAge) continue;
    const atr = Number.isFinite(row[atrPlot]) && row[atrPlot] > 0 ? row[atrPlot] : null;
    events.push({ source: 'tradingview_native_dtc', symbol, bar_open: c.time, signal_at: c.time + 60, entry: c.close, atr });
  }
  return { events, closedBars, unconfirmedBars: data.candles.length - closedBars };
}

export function observeNativeDtc(data, time, buyPlot = 'DTC_Buy_Signal') {
  const candle = data.candles.find(c => c.time === time);
  const row = data.values.find(r => r.$time === time);
  const value = row?.[buyPlot];
  return { bar_open: time, barPresent: !!candle, studyPresent: !!row,
    buy: !candle || !row || (value !== 0 && value !== 1) ? null : value === 1,
    close: candle?.close ?? null, successorPresent: data.candles.some(c => c.time > time) };
}

function assertDtcDefaults(indicator) {
  if (!/DTC.*1\.3\.6/i.test(indicator.description + ' ' + indicator.shortDescription)) throw new Error('DTC_VERSION_NOT_VERIFIED');
  const expected = { 'EMA 1': 30, 'EMA 2': 35, 'EMA 3': 40, 'EMA 4': 45, 'EMA 5': 50, 'EMA 6': 60,
    'Show Buy/Sell Signals': true, 'Enable ATR Volatility Filter': true,
    'ATR Period': 14, 'ATR Average Period': 50, 'ATR Threshold Multiplier': 1, 'SL Mode': 'Small' };
  const inputs = Object.values(indicator.inputs);
  for (const [name, value] of Object.entries(expected)) {
    if (inputs.find(input => input.name === name)?.value !== value) throw new Error('DTC_DEFAULTS_NOT_VERIFIED');
  }
}

async function main() {
  if (!process.env.SESSION || !process.env.SIGNATURE) throw new Error('SESSION_REQUIRED');
  const { getUser, getPrivateIndicators, getIndicator, getSymbolInfo, getIndicatorData, watchIndicator } = await import('../dist/index.js');
  const credentials = { session: process.env.SESSION, signature: process.env.SIGNATURE };
  await getUser(credentials, { signal: AbortSignal.timeout(15_000) });
  console.log(JSON.stringify({ event: 'account', authenticated: true }));
  const symbol = process.env.DTC_SYMBOL || 'NASDAQ:AAPL';
  const session = process.env.DTC_SESSION || 'extended';
  const info = await getSymbolInfo({ symbol, session, credentials, timeoutMs: 15_000 });
  console.log(JSON.stringify({ event: 'symbol', requested: symbol, resolved: info.full_name,
    requestedSession: session, resolvedSession: info.subsession_id ?? null,
    sessions: (info.subsessions || []).map(s => ({ id: s.id, description: s.description })) }));
  if (process.argv.includes('--inspect-session')) return;
  // Never replace the user's 24h chart with regular/extended by default.
  if (!process.env.DTC_SESSION) throw new Error('EXPLICIT_DTC_SESSION_REQUIRED');
  assertNativeContext(info, symbol, session);
  let id = process.env.DTC_INDICATOR;
  if (!id) {
    const scripts = await getPrivateIndicators(credentials, { signal: AbortSignal.timeout(15_000) });
    const matches = scripts.filter(s => /DTC.*1\.3\.6/i.test(s.name));
    if (matches.length !== 1) throw new Error('SET_DTC_INDICATOR');
    id = matches[0].id;
  }
  const indicator = await getIndicator(id, { credentials, signal: AbortSignal.timeout(15_000) });
  assertDtcDefaults(indicator);
  const query = { symbol, session, indicator, credentials, timeframe: '1', count: 2000, timeoutMs: 20_000 };
  const options = { symbol, now: Date.now() / 1000,
    buyPlot: process.env.DTC_BUY_PLOT || 'DTC_Buy_Signal', atrPlot: process.env.DTC_ATR_PLOT || 'DTC_ATR' };
  const initial = await getIndicatorData(query);
  const result = nativeDtcBuys(initial, options);
  console.log(JSON.stringify({ event: 'history', source: 'tradingview_native_dtc', symbol, session,
    timeframe: '1', scriptVersion: indicator.version, candles: initial.candles.length,
    firstOpen: initial.candles[0]?.time, lastOpen: initial.candles.at(-1)?.time,
    buyCount: result.events.length, closedBars: result.closedBars,
    atrPlotAvailable: Object.values(indicator.plots).includes(options.atrPlot),
    qualifiedForProduction: false, reason: 'Chart comparison, sustained live coverage and delivery remain unverified' }));
  const at = process.argv.find(arg => arg.startsWith('--at='));
  if (at) {
    const times = at.slice(5).split(',').map(Number);
    if (!times.length || times.some(t => !Number.isSafeInteger(t) || t < 0 || t % 60)) throw new Error('INVALID_OBSERVATION_TIMES');
    for (const time of times) console.log(JSON.stringify({ event: 'bar_comparison', symbol, session,
      ...observeNativeDtc(initial, time, options.buyPlot) }));
  }
  for (const event of result.events) console.log(JSON.stringify({ event: 'historical_buy', ...event }));
  const watchArg = process.argv.find(arg => arg.startsWith('--watch-seconds='));
  if (!watchArg) return;
  const seconds = Number(watchArg.split('=')[1]);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('INVALID_WATCH_DURATION');
  const started = Date.now() / 1000; const sent = new Set();
  let callbacks = 0; let advances = 0; let latest = initial.candles.at(-1)?.time; let errors = 0;
  let pending;
  const publish = (data) => {
      const next = data.candles.at(-1)?.time;
      if (next > latest) advances += 1;
      latest = next;
      for (const event of nativeDtcBuys(data, { ...options, now: Date.now() / 1000, after: started, maxAge: 90 }).events) {
        if (sent.has(event.bar_open)) continue;
        sent.add(event.bar_open);
        console.log(JSON.stringify({ event: 'new_native_buy', ...event, riskLevelsReady: event.atr !== null }));
      }
  };
  const watcher = await watchIndicator(query, {
    onData(data) { callbacks += 1; pending = data; publish(data); },
    onError(error) { errors += 1; console.log(JSON.stringify({ event: 'stream_error', code: error?.code || 'ERROR' })); },
  });
  // Recheck a successor-backed result after the two-second close margin even
  // when an illiquid symbol has no immediate second update. Never invent a bar.
  const poll = setInterval(() => {
    if (pending && watcher.isActive) {
      try { publish(pending); } catch { errors += 1; }
    }
  }, 2000);
  let deadline;
  try { await Promise.race([new Promise(r => { deadline = setTimeout(r, seconds * 1000); }), watcher.closed]); }
  finally { clearInterval(poll); clearTimeout(deadline); await watcher.stop(); }
  console.log(JSON.stringify({ event: 'stream_summary', callbacks, advances, errors, newBuys: sent.size,
    productionSwitched: false, telegramSent: false, reliabilityComparisonComplete: false }));
  if (errors || advances === 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Upstream errors can embed private account/script data. Print only a code.
    const allowed = new Set(['SESSION_REQUIRED', 'EXPLICIT_DTC_SESSION_REQUIRED', 'SET_DTC_INDICATOR',
      'DTC_VERSION_NOT_VERIFIED', 'DTC_DEFAULTS_NOT_VERIFIED', 'SUBSTITUTED_FEED', 'SESSION_NOT_VERIFIED',
      'BUY_PLOT_MISSING', 'INVALID_OBSERVATION_TIMES', 'NON_BINARY_BUY_PLOT', 'INVALID_CANDLES', 'DUPLICATE_STUDY_ROW', 'INVALID_WATCH_DURATION']);
    const code = allowed.has(error?.message) ? error.message : /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'PROBE_FAILED';
    console.error(JSON.stringify({ event: 'failure', code })); process.exitCode = 1;
  });
}
