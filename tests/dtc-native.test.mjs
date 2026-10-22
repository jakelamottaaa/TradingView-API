import { test } from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../scripts/dtc-native.mjs');
const start = 1_800_000_000;
const bars = [0, 60, 120].map(t => ({ time: start + t, open: 10, high: 11, low: 9, close: 10, volume: 100 }));
function fixture() {
  return { indicator: { plots: { plot_0: 'DTC_Buy_Signal', plot_1: 'DTC_ATR' }, version: '1.0' }, candles: bars,
    values: [{ $time: start, DTC_Buy_Signal: 1, DTC_ATR: .25 }, { $time: start + 60, DTC_Buy_Signal: 0, DTC_ATR: .3 }, { $time: start + 120, DTC_Buy_Signal: 1, DTC_ATR: .4 }] };
}
test('native extraction emits exact BUY plot values only on confirmed successor-backed bars', () => {
  assert.equal(typeof api.nativeDtcBuys, 'function');
  const result = api.nativeDtcBuys(fixture(), { symbol: 'TEST:AAA', now: start + 183 });
  assert.deepEqual(result.events, [{ source: 'tradingview_native_dtc', symbol: 'TEST:AAA', bar_open: start,
    signal_at: start + 60, entry: 10, atr: .25 }]);
  assert.equal(result.closedBars, 2);
  assert.equal(result.unconfirmedBars, 1);
});
test('native extraction filters startup/history and freshness without fabricating ATR', () => {
  assert.equal(typeof api.nativeDtcBuys, 'function');
  const data = fixture(); delete data.values[0].DTC_ATR;
  assert.equal(api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 123 }).events[0].atr, null);
  assert.equal(api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 183, maxAge: 90 }).events.length, 0);
  assert.equal(api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 183, after: start + 61 }).events.length, 0);
});
test('native extraction rejects an absent signal plot, wrong numeric plot and duplicate rows', () => {
  assert.equal(typeof api.nativeDtcBuys, 'function');
  const data = fixture();
  assert.throws(() => api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 183, buyPlot: 'Missing' }));
  data.values[0].DTC_Buy_Signal = 10;
  assert.throws(() => api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 183 }));
  data.values[0].DTC_Buy_Signal = 1; data.values.push(data.values[0]);
  assert.throws(() => api.nativeDtcBuys(data, { symbol: 'TEST:AAA', now: start + 183 }));
});
test('native context refuses substituted feeds and an unverified 24h session', () => {
  assert.equal(typeof api.assertNativeContext, 'function');
  assert.throws(() => api.assertNativeContext({ full_name: 'BATS:AAA', subsession_id: 'extended' }, 'NASDAQ:AAA', 'extended'));
  assert.throws(() => api.assertNativeContext({ full_name: 'NASDAQ:AAA', subsession_id: 'extended' }, 'NASDAQ:AAA', '24h'));
  assert.throws(() => api.assertNativeContext({ full_name: 'NASDAQ:AAA' }, 'NASDAQ:AAA', 'extended'));
  api.assertNativeContext({ full_name: 'NASDAQ:AAA', subsession_id: 'extended' }, 'NASDAQ:AAA', 'extended');
});

test('historical comparison distinguishes absent candles/study rows from a false BUY', () => {
  assert.equal(typeof api.observeNativeDtc, 'function');
  const data = fixture();
  assert.equal(api.observeNativeDtc(data, start + 600).buy, null);
  assert.equal(api.observeNativeDtc(data, start + 60).buy, false);
  assert.equal(api.observeNativeDtc(data, start).buy, true);
  data.values = data.values.filter(r => r.$time !== start);
  const missing = api.observeNativeDtc(data, start);
  assert.equal(missing.barPresent, true);
  assert.equal(missing.studyPresent, false);
  assert.equal(missing.buy, null);
});
