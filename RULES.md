# The sixteen checks

Generated from the analyser's own rule table, so it cannot drift from the code.

## MetaTrader — MQL4 and MQL5

| id | severity | what it looks for |
| --- | --- | --- |
| `lot-not-normalised` | 🔴 critical | Lot size is never normalised to the broker's volume step |
| `stops-level` | 🔴 critical | Stop loss and take profit are set without checking the stops level |
| `trade-allowed` | 🟡 warning | Orders are sent without checking that trading is permitted |
| `magic-filter` | 🟡 warning | Open positions are iterated without filtering by magic number |
| `return-ignored` | 🟡 warning | The result of the order send is discarded |
| `double-equality` | 🟡 warning | Floating point values compared with equality |
| `martingale` | 🔴 critical | Position size is multiplied after a loss |
| `five-digit` | 🟡 warning | Point is used without adjusting for 5-digit and 3-digit brokers |
| `sleep-in-ontick` | ⚪ note | Sleep is called inside the tick handler |
| `zero-guard` | 🟡 warning | Division with no guard against a zero denominator |

## TradingView — Pine Script

| id | severity | what it looks for |
| --- | --- | --- |
| `pine-lookahead-missing` | 🔴 critical | Higher-timeframe data requested without setting lookahead |
| `pine-lookahead-on` | 🔴 critical | lookahead_on is switched on |
| `pine-no-offset` | 🔴 critical | Higher-timeframe value read without the [1] offset |
| `pine-version` | ⚪ note | No //@version annotation |
| `pine-calc-every-tick` | 🟡 warning | Strategy calculates on every tick |
| `pine-repainting-varip` | ⚪ note | varip is used |

---

### `lot-not-normalised`

**Lot size is never normalised to the broker's volume step**

*What it costs.* The broker rejects any volume that is not a multiple of its step, so the order simply never opens. It passes every backtest, because the tester accepts whatever volume you hand it.

*The fix.* Read SYMBOL_VOLUME_STEP, floor the lot to a multiple of it, then clamp between SYMBOL_VOLUME_MIN and SYMBOL_VOLUME_MAX before sending.

### `stops-level`

**Stop loss and take profit are set without checking the stops level**

*What it costs.* Every broker refuses stops placed closer to price than its minimum distance. On a quiet pair it works; the first time the spread widens, the order is rejected and the position runs unprotected.

*The fix.* Read SYMBOL_TRADE_STOPS_LEVEL and push the stop out to at least that distance, then check SYMBOL_TRADE_FREEZE_LEVEL before modifying an open position.

### `trade-allowed`

**Orders are sent without checking that trading is permitted**

*What it costs.* When AutoTrading is off, the account is read-only, or the terminal is still connecting, every send fails silently and the robot looks like it simply stopped working.

*The fix.* Guard the send with TERMINAL_TRADE_ALLOWED and MQL_TRADE_ALLOWED, and log the reason when it is refused.

### `magic-filter`

**Open positions are iterated without filtering by magic number**

*What it costs.* The robot will manage, modify and close trades that belong to you or to another EA on the same account. This is the mistake that turns one bad bot into a bad account.

*The fix.* Compare POSITION_MAGIC (or OrderMagicNumber in MQL4) against this robot's own magic number and skip everything else. Filter by symbol too.

### `return-ignored`

**The result of the order send is discarded**

*What it costs.* A rejected order is indistinguishable from a filled one. The robot carries on believing it is in a position that does not exist, and the next decision is built on a false state.

*The fix.* Capture the return value, check the retcode, and read GetLastError on failure. Decide explicitly whether to retry or stand down.

### `double-equality`

**Floating point values compared with equality**

*What it costs.* Two prices that look identical on screen differ in the last bits, so the branch never runs. It fails silently and intermittently, which is the hardest kind of bug to find months later.

*The fix.* Compare with a tolerance: MathAbs(a - b) < _Point / 2, or normalise both sides to the symbol's digits first.

### `martingale`

**Position size is multiplied after a loss**

*What it costs.* This is not a bug, it is a choice — but it is the choice that produces a beautiful equity curve and then removes the account in one losing streak. The simulator above shows what that distribution really looks like.

*The fix.* If it is deliberate, cap the number of steps and the maximum exposure, and test against the worst losing streak in the data rather than the average.

### `five-digit`

**Point is used without adjusting for 5-digit and 3-digit brokers**

*What it costs.* The same input means ten times the distance depending on the broker. A 40-pip stop becomes a 4-pip stop, which the market takes out immediately.

*The fix.* Derive a pip from _Point and _Digits: multiply by 10 when _Digits is 3 or 5, and use that everywhere instead of raw Point.

### `sleep-in-ontick`

**Sleep is called inside the tick handler**

*What it costs.* The terminal runs all charts on one thread for an EA's events. Sleeping blocks incoming ticks, and in the Strategy Tester it is ignored entirely, so live and tested behaviour diverge.

*The fix.* Use a timer event or a timestamp check instead of blocking, so the handler always returns quickly.

### `zero-guard`

**Division with no guard against a zero denominator**

*What it costs.* Indicator buffers return zero before they have enough bars, and at that moment the result is infinity or a silent zero. The first trades after a restart are placed on nonsense values.

*The fix.* Check the denominator is meaningfully above zero before dividing, and return early when the indicator is not ready.

### `pine-lookahead-missing`

**Higher-timeframe data requested without setting lookahead**

*What it costs.* The default reads values that were not knowable at the time, so the backtest sees the future and the live chart repaints underneath the trader. Results look excellent and cannot be traded.

*The fix.* Pass lookahead = barmerge.lookahead_off explicitly, and take the previous bar with [1].

### `pine-lookahead-on`

**lookahead_on is switched on**

*What it costs.* This deliberately reads future data. Anything it produces is unusable for trading, however good the backtest looks.

*The fix.* Use barmerge.lookahead_off unless you are drawing something historical that will never generate a signal.

### `pine-no-offset`

**Higher-timeframe value read without the [1] offset**

*What it costs.* The current higher-timeframe bar is still forming, so its value keeps changing until it closes. Signals appear and disappear in real time even with lookahead off.

*The fix.* Request the expression with a [1] offset so you only ever act on a bar that has closed.

### `pine-version`

**No //@version annotation**

*What it costs.* TradingView falls back to version 1, where much of the modern language is unavailable and behaviour differs from what the code appears to say.

*The fix.* Put //@version=6 on the first line.

### `pine-calc-every-tick`

**Strategy calculates on every tick**

*What it costs.* Backtest and live behaviour will not match: history has no intrabar ticks, so the tested results come from a different signal sequence than the one that trades.

*The fix.* Leave it off unless the strategy genuinely needs intrabar execution, and if it does, validate on a lower timeframe instead.

### `pine-repainting-varip`

**varip is used**

*What it costs.* varip keeps its value across ticks within a bar rather than resetting, which is a legitimate tool but a common source of values that cannot be reproduced on historical data.

*The fix.* Confirm the logic reads the same on a bar that has closed as it does in real time.
