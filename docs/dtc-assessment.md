# Native DTC source assessment

This fork adds an opt-in, read-only DTC 1.3.6 assessment. It reads TradingView's
study plots; it does not reconstruct BUY conditions from candles, deliver
Telegram messages, change a production service, place orders or switch providers.
Live account/DTC/24h access and superiority over the existing source remain
unverified until genuine observations are captured.

## Android session setup, with 2FA retained

Use Node 20+ (Node 24 recommended) and install/build this checkout:

```sh
npm ci
npm run build
npm run dtc:session
```

The helper prints a loopback-only URL, valid for 15 minutes. Open it on the same
device. With Firefox for Android, install the official
[Cookie-Editor add-on](https://addons.mozilla.org/en-US/android/addon/cookie-editor/),
sign in to TradingView normally, and complete your usual 2FA or Google/Apple
sign-in. On the TradingView tab, open Cookie-Editor and copy only `sessionid`
and `sessionid_sign` into the local form. Never paste them into chat or GitHub.
The helper does not accept your account password or perform login.

The form creates ignored `.env` with mode 0600 and only `SESSION`/`SIGNATURE`.
It refuses to overwrite an existing file. Retain the source app's normal account
security; the library's password login cannot handle 2FA/CAPTCHA. Session cookies
are credentials too. The helper rejects unrelated origins and never reflects
cookie values in responses. It uses same-origin referrer policy because browsers
otherwise send `Origin: null` on the form POST with `no-referrer`.

## Resolve account, feed and session first

```sh
npm run dtc:inspect
```

This authenticates and reports only the requested/resolved symbol and available
session identifiers, without printing account details, script IDs or tokens.
The initial inspection defaults to NASDAQ:AAPL and extended hours **for discovery
only**. It does not equate extended hours with the user's 24h chart.

Add local settings to `.env` after inspection:

```dotenv
DTC_SYMBOL=EXCHANGE:TICKER
DTC_SESSION=the_exact_verified_session_id
# Optional when exactly one saved DTC 1.3.6 script cannot be discovered:
DTC_INDICATOR=your_account_accessible_script_id
# Normalized plot names, if they differ from these defaults:
DTC_BUY_PLOT=DTC_Buy_Signal
DTC_ATR_PLOT=DTC_ATR
```

Use only account-accessible scripts/data. The assessment refuses a substituted
feed or unverified session, and checks DTC title/version and default EMA/ATR/risk
inputs. A matching symbol in `pro_name` alone is insufficient if `full_name`
identifies another feed.

## Capture native events

```sh
mkdir -p .dtc-assessment
npm run dtc:assess > .dtc-assessment/history.jsonl
# Compare specific UTC bar-opening epochs without treating missing bars as false:
npm run dtc:assess -- --at=1800000000 > .dtc-assessment/comparison.jsonl
npm run dtc:assess -- --watch-seconds=120 > .dtc-assessment/live.jsonl
```

The study is executed by TradingView. The script pins its resolved definition for
the run, requests 2,000 one-minute bars and reports actual returned history bounds.
Historical BUY events are explicitly labeled and never sent. Streaming output
excludes pre-startup signals, expires new events after 90 seconds and deduplicates
each symbol/bar. It requires both the existing two-second close margin and a
successor native candle; the newest candle is therefore unconfirmed in this probe.
A final session candle without a successor may be omitted and is a coverage limit.
No empty minutes are synthesized or removed from TradingView's sequence.

ATR is read only from an actual native plot. The original indicator may not
expose it: `atr:null` means unavailable, never a locally estimated value. To
assess full reference levels, the owner can expose the existing native `atrVal`
as a hidden plot in their private DTC copy without changing BUY logic:

```pine
plot(atrVal, title="DTC ATR", display=display.none)
```

Do not publish the private script, IDs, account captures or credentials in this
public fork. `.dtc-assessment/` is ignored. Errors report codes rather than
potentially private upstream messages.

## Evidence needed before replacing the current source

- Exact DTC source/inputs, feed, ordinary 1m candles, adjustments, session and
  history alignment with the user's chart; include true and false BUY examples.
- Native BUY timestamps/entry/ATR compared with the existing event ledger.
- Actual non-benchmark closed-candle advances and native study updates during an
  active session. HTTP/account access, heartbeats and old snapshots are not proof.
- Coverage of the changing four-board union, connection failures/recovery,
  confirmation latency and resource usage. This first probe covers one symbol.
- Preserve the existing durable Telegram outbox, dedup and credentials only after
  source qualification. Do not mix engines or silently downgrade the session.

The fork is unofficial. Successful synthetic tests establish extraction and
session-import behavior, not TradingView compatibility or delivery reliability.
No deployment or new Telegram delivery is claimed by this work.

## Local assessment checkpoint, 2026-10-21

The owner's normal browser session authenticated with 2FA retained. Native symbol
metadata advertised and resolved the `24h` subsession. Exactly one saved DTC 1.3.6
study matched; its EMA/ATR/Small-stop defaults were verified. The original study's
native alert predicate is exposed as `DTC_Buy_Signal`. No private source or IDs
were published in this fork.

Five account-authenticated symbol requests returned 2,000 native one-minute bars
and study outputs each. For this account, NASDAQ requests resolved to BATS feeds;
this must match the chart's actual data entitlement before production selection.
In a private seven-event comparison, six exact native bar/study pairs had a false
BUY predicate; one reference minute had no native bar and remains unavailable,
not a false signal. The user's reported example was among the six false native
predicates, with a different native close from its original IBKR-derived event.

The recently patched IBKR calculation was also evaluated offline on the retained
inputs where available. Two reference events still qualified locally while their
native predicates were false; three others no longer qualified after empty-minute
normalization, one signal minute was omitted by that policy, and one had no retained
IBKR input. This is bounded alignment evidence, not a production latency or
availability comparison. These were historical references, not new deliveries.

ATR is not exposed by the original saved study. Full native risk levels, dynamic
four-board coverage, actual active-session update continuity, recovery/resource
qualification and Telegram delivery remain pending. The current production source
was not switched. Real captures stay only in ignored local storage.

A bounded 90-second watch of one reference symbol produced one initial callback,
zero candle advances, zero stream errors and no new BUY events. This does not
prove live update continuity or greater uptime. The test occurred before the
normal US premarket session. No Telegram message was sent.

Local verification passed type checks, lint, 176 existing tests and eight new DTC
checks; two existing tests were skipped. Build/package smoke passed under scoped
Node 24; Bun was unavailable locally and its smoke was skipped. A real Chromium
form submission was verified after reproducing and correcting `Origin: null`.
Hosted CI and full production qualification are separate from these observations.
