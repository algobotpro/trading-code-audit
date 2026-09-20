# The 31 checks

Generated from the analyser's own rule table, so it cannot drift from the code.

## MetaTrader — MQL4 and MQL5 (25)

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
| `lot-min-max-unclamped` | 🔴 critical | Lot size is stepped but never clamped to the broker's minimum and maximum |
| `freeze-level` | 🔴 critical | Positions are closed or modified without checking the freeze level |
| `margin-not-checked` | 🟡 warning | Orders are sent without checking that the account can afford them |
| `slippage-zero` | 🟡 warning | Market orders are sent with zero slippage |
| `partial-fill-unhandled` | 🔴 critical | A partial fill is treated as a full one |
| `requote-unhandled` | 🟡 warning | Requotes and stale prices are not separated from real failures |
| `no-sl-at-all` | 🔴 critical | Every order is sent with no stop loss, and none is set afterwards |
| `loop-forward-while-closing` | 🔴 critical | Positions are closed inside a loop that counts upward |
| `history-select-missing` | 🔴 critical | Trade history is read without selecting it first |
| `history-select-clobbered` | 🔴 critical | The history list is destroyed in the middle of the loop that walks it |
| `local-time-for-trading` | 🔴 critical | Trading decisions are made from the computer's clock, not the server's |
| `copybuffer-return-ignored` | 🔴 critical | The result of CopyBuffer is not checked |
| `arraysetasseries-missing` | 🔴 critical | An array filled by CopyBuffer or CopyRates is read without setting it as a series |
| `arraysetasseries-on-static` | 🟡 warning | ArraySetAsSeries is called on an array that cannot accept it |
| `refreshrates-in-mql5` | 🔴 critical | RefreshRates is called in what looks like MQL5 code |

## TradingView — Pine Script (6)

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

### `lot-min-max-unclamped`

**Lot size is stepped but never clamped to the broker's minimum and maximum**

*What it costs.* You rounded to the volume step, so you thought about this — but a broker rejects anything below SYMBOL_VOLUME_MIN or above SYMBOL_VOLUME_MAX just as hard. The order simply never opens, and the tester never shows it because the tester accepts whatever volume you hand it.

*The fix.* After flooring to the step, clamp: MathMin(SYMBOL_VOLUME_MAX, MathMax(SYMBOL_VOLUME_MIN, lot)). Read both with SymbolInfoDouble.

### `freeze-level`

**Positions are closed or modified without checking the freeze level**

*What it costs.* The freeze level is not the stops level. The stops level says where you may put a stop; the freeze level says when you may no longer touch something that already exists. Inside that band the server refuses to close, modify or cancel — retcode 10029 — and your exit does not happen at the moment you most need it to.

*The fix.* Read SYMBOL_TRADE_FREEZE_LEVEL and check the distance before modifying or closing. Many brokers report zero, but some enforce the stops level on modification anyway, so MathMax(stops_level, freeze_level) is the safe distance.

### `margin-not-checked`

**Orders are sent without checking that the account can afford them**

*What it costs.* The order is rejected for insufficient margin, and whatever your code does next assumes a position that does not exist. This is the one pre-send check MetaQuotes requires for publication in the Market, which is a fair signal of how often it is skipped.

*The fix.* Call OrderCalcMargin for the intended volume and compare it to AccountInfoDouble(ACCOUNT_MARGIN_FREE) before sending. Decide explicitly what to do when it does not fit — skipping the trade is a decision, silently failing is not.

### `slippage-zero`

**Market orders are sent with zero slippage**

*What it costs.* With a deviation of zero the server must fill at exactly the price you asked for. On a quiet pair it usually can. Around news, or on any broker with real execution, it cannot — and the order is rejected instead of filled. The strategy does not lose money; it simply does not trade, on precisely the days it was written for.

*The fix.* Set a deviation you can live with, in points, and handle the requote return codes rather than hoping for an exact fill.

### `partial-fill-unhandled`

**A partial fill is treated as a full one**

*What it costs.* The server may fill less volume than you asked for. If result.volume is never compared to request.volume, the robot believes it holds a position it does not hold — and every number computed from it afterwards is wrong: the exit volume, the risk, the stop distance.

*The fix.* Compare result.volume with request.volume after every send. Decide explicitly whether to top up the remainder, close what filled, or carry on with the smaller size.

### `requote-unhandled`

**Requotes and stale prices are not separated from real failures**

*What it costs.* Your code does look at the return code, so it is being careful — but a requote is not a failure, it is the server saying “the price moved, ask again”. Treated as a failure, the entry is abandoned. Treated as a success, the robot thinks it is in a trade. Either way the behaviour on a fast market differs from the behaviour in the tester.

*The fix.* Branch on TRADE_RETCODE_REQUOTE and TRADE_RETCODE_PRICE_CHANGED (10004, 10006, 10021 — 138 and 136 in MQL4): refresh the price and retry a bounded number of times, then give up loudly.

### `no-sl-at-all`

**Every order is sent with no stop loss, and none is set afterwards**

*What it costs.* This is not automatically a bug — some strategies genuinely manage risk in code rather than at the broker. But then the exit depends on your robot still running, your VPS still up, and your connection still alive. A stop loss at the broker survives all three failing.

*The fix.* If the absence is deliberate, say so in a comment and make sure there is a code path that exits without a live connection. If it is not deliberate, set sl on the send or immediately after.

### `loop-forward-while-closing`

**Positions are closed inside a loop that counts upward**

*What it costs.* Closing at index 0 moves what was at index 1 down to index 0, while the counter moves up to 1 — so that one is never seen. The loop closes every second position and leaves the rest open. The tester rarely shows it because there is usually only one position there. Live, on the day you wanted everything flat, half of it stays.

*The fix.* Count down: for(int i = PositionsTotal() - 1; i >= 0; i--). On a busy account, or with a FIFO broker, collect the tickets into an array first and act on tickets rather than on indices.

### `history-select-missing`

**Trade history is read without selecting it first**

*What it costs.* HistorySelect builds the history list your program can see. Without it the list is empty and HistoryDealGetTicket returns zero — with no error at all. The loop runs, finds nothing, and the robot concludes it has no closed trades. This is the usual reason an EA cannot find its own history.

*The fix.* Call HistorySelect(from, to) — or HistorySelectByPosition(position_id) — before any HistoryDeal* or HistoryOrder* call, and check that it returned true.

### `history-select-clobbered`

**The history list is destroyed in the middle of the loop that walks it**

*What it costs.* HistoryOrderSelect and HistoryDealSelect do not read from the list HistorySelect built — they clear it and put a single item in it. Calling either inside a loop over HistoryDealsTotal() empties the collection while you are iterating it, so the loop stops early or reads the wrong rows.

*The fix.* Inside the loop use HistoryDealGetTicket(i) and the HistoryDealGet* accessors, which read from the existing list. Keep HistoryOrderSelect and HistoryDealSelect outside any such loop.

### `local-time-for-trading`

**Trading decisions are made from the computer's clock, not the server's**

*What it costs.* TimeLocal is the clock of whatever machine the terminal happens to run on. The same robot then behaves one way on a VPS in Germany and another on a laptop in Tehran, and changes its own behaviour twice a year when daylight saving moves. A session filter built on it is not the filter you tested.

*The fix.* Use TimeCurrent() for anything the market cares about. If you genuinely need a wall-clock hour, derive the broker's offset explicitly rather than assuming it.

### `copybuffer-return-ignored`

**The result of CopyBuffer is not checked**

*What it costs.* CopyBuffer returns -1 on error, and a number smaller than you asked for when the data was not ready before the timeout. The second case is the dangerous one: nothing fails, the tail of your array simply keeps whatever was in it, and the robot decides on stale numbers.

*The fix.* Guard on the count, not on the sign: if(CopyBuffer(h, b, start, count, arr) != count) return. Use BarsCalculated(handle) to know when the indicator is ready at all.

### `arraysetasseries-missing`

**An array filled by CopyBuffer or CopyRates is read without setting it as a series**

*What it costs.* CopyBuffer and CopyRates always place the oldest element at the start of the array, whatever the array's own flag says. So arr[0] — the one you are reading as the current bar — is the oldest bar in the window. There is no error, no warning, and no change in the return value. The robot simply trades on the stalest number it copied.

*The fix.* Call ArraySetAsSeries(arr, true) before the copy, so index 0 is the most recent bar. Confirm with ArrayGetAsSeries if you want to be sure.

### `arraysetasseries-on-static`

**ArraySetAsSeries is called on an array that cannot accept it**

*What it costs.* The series flag cannot be set on a statically sized array or a multidimensional one — the call returns false and the array stays forward-indexed. Because almost nobody reads that return value, the result is the same off-by-the-whole-window error as leaving the call out, but now with a line of code that looks like the problem was handled.

*The fix.* Declare the buffer as a dynamic array — double buf[]; — and resize it with ArrayResize or let CopyBuffer size it. Check the return value of ArraySetAsSeries while you are there.

### `refreshrates-in-mql5`

**RefreshRates is called in what looks like MQL5 code**

*What it costs.* RefreshRates does not exist in MQL5. This is not a call that quietly does nothing — the file will not compile. It is almost always left over from an unfinished port from MQL4, which means there are probably other MQL4 assumptions in the same file.

*The fix.* Read the tick instead: MqlTick t; SymbolInfoTick(_Symbol, t); then use t.bid and t.ask. While you are here, check the rest of the file for other MQL4 leftovers — Bid, Ask and Digits are not predefined variables in MQL5 either.

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
