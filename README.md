# trading-code-audit

A static analyser for MetaTrader Expert Advisors and TradingView Pine scripts.
It looks for sixteen failure patterns that pass the Strategy Tester and cost
money on a live account.

No network. No telemetry. It never executes the code it reads.

**Try it without installing anything:** <https://algobot-pro.com/en/tools/ea-code-audit>
(runs entirely in your browser — the page makes no request with your code in it).

---

## What it actually does

Most "MQL linters" are a pile of regular expressions. This one starts the same
way every compiler does:

1. **Tokenise.** `src/lang/lex.ts` turns the file into tokens, keeping line
   numbers exact through block comments and multi-line strings.
2. **Build structure.** `src/lang/structure.ts` derives the block tree
   (functions, loops, branches), statement boundaries, every call with its
   argument spans, and the assignment chain.
3. **Ask structural questions.** The rules in `src/rules.ts` then ask things a
   regex cannot: *is this call's return value used? is this loop filtered by
   magic number? where did the number in this argument come from?*

That third point is the one that matters. Consider:

```mql5
void Report(){ double s = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP); Print(s); }

void OnTick(){
   double lot = AccountBalance()*0.02/1000.0;      // never normalised
   OrderSend(_Symbol, OP_BUY, lot, Ask, 3, 0, 0);  // and the result is dropped
}
```

A whole-file search for `SYMBOL_VOLUME_STEP` finds it — in `Report`, for an
unrelated purpose — and concludes the lot is fine. On a four-thousand-line
project that false negative is close to guaranteed, because *somewhere* in a
real codebase someone has read the volume step.

This analyser traces the value that reached *that* argument, through
assignments and through your own helper functions, and reports both problems.
It also stays quiet on the inverse case:

```mql5
class CRiskManager {
   double Lot(double risk){
      m_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      if(m_step <= 0.0) return 0.0;
      return MathFloor(risk/m_step)*m_step;
   }
};
// trade.Buy(g_risk.Lot(...), ...) — clean, and it says nothing
```

## The checks

Sixteen, listed in full with what each one costs and how to fix it:
**[RULES.md](RULES.md)**

## Usage

It is not on npm. Install it straight from this repository:

```bash
npm install github:algobotpro/trading-code-audit
```

Or clone it and copy `src/` into your project — there is no build step and no
dependencies.

```ts
import { audit } from 'trading-code-audit';

const result = audit(sourceText);
// result.dialect  -> 'mql' | 'pine' | 'unknown'
// result.findings -> [{ ruleId, severity, line, excerpt }]
// result.counts   -> { critical, warning, note }
```

The entry point is TypeScript (`src/index.ts`), not compiled JavaScript. Any
bundler resolves it as-is; plain Node needs 22.6 or newer, with
`--experimental-strip-types`.

Finding text is not in this package. Each finding carries a `ruleId`; the
wording for all three severities lives in whatever locale file you use, which
is how the live tool serves English, Persian and Arabic from one engine.

## Running the tests

```bash
node --experimental-strip-types --no-warnings test/audit-check.mjs
```

Fifteen cases and a time budget. Seven are real bugs it must catch, three are
malformed input it must survive, and five are **correct code it must stay
silent on** — those last five are the ones worth having. A false positive on an
experienced developer's working code costs more credibility than ten true
findings earn.

The suite also fails if a 400-line file takes longer than 120 ms, because the
analyser re-runs on every keystroke in the browser.

## Honest limits

- **A clean result is not a certificate.** It means these sixteen patterns are
  absent. It says nothing about whether your logic is right or your edge real.
- **It is heuristic, not a compiler.** It follows your helper functions, but it
  can still miss a pattern it has not seen. Every finding names a line so you
  can check it and dismiss it.
- **Pine coverage is thinner than MQL coverage** — six checks against ten.
- **cTrader's C# is not covered.**

## Performance

Measured, warm, on synthetic EAs of realistic shape:

| lines | time |
| --- | --- |
| 150 | 4 ms |
| 700 | 9 ms |
| 3,000 | 25 ms |
| 7,200 | 70 ms |

## Why this exists

It is the first pass of a paid code audit, written down and given away.

It was built by [AlgoBot Pro](https://algobot-pro.com), a software team. Where we
are sharpest is systems that handle money and time correctly, and that discipline
does not stop at the execution engine — expert advisors and Pine indicators, but
also the market-data pipelines under them, the dashboards and client portals on
top, and the mobile and desktop clients people actually watch them from. This
analyser exists because the same sixteen mistakes kept arriving in other people's
code, and writing them down once was cheaper than explaining them again.

If you find a failure pattern it should catch, open an issue with a minimal
reproduction — that is the most useful contribution there is.

A note for contributors: the inline commentary in `src/` is written in Persian,
because that is the language of the people who maintain it day to day. Every
comment explains *why* a decision was made rather than what the line does, so
a machine translation reads fine. Issues and pull requests in English are
welcome and will be answered in English.

## Licence

MIT. See [LICENSE](LICENSE).
