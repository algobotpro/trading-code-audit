import { maskCommentsAndStrings } from './mask';
import { analyse } from './lang/structure';
import { rules } from './rules';
import type { AuditResult, Dialect, Finding, RuleContext, Severity } from './types';

export type { AuditResult, Finding, Severity, Dialect } from './types';

/** تشخیص زبان از روی نشانه‌های قطعی، نه حدس */
export function detectDialect(src: string): Dialect {
  if (
    /\/\/@version\s*=|\bindicator\s*\(|\bstrategy\s*\(|\brequest\.security\b|\bplotshape\b/.test(
      src,
    )
  ) {
    return 'pine';
  }
  // ⚠️ نشانه‌ها عمداً فراتر از OnTick/OnInit هستند.
  //
  // نسخهٔ قبلی فقط چند نقطهٔ ورود و #property را می‌شناخت. یعنی هر
  // فایلی که نقطهٔ ورود نداشت — یک ‎.mqh کتابخانه‌ای، یا فقط تابعی که
  // کاربر کپی کرده تا همان را چک کند — «زبان ناشناخته» می‌گرفت و هیچ
  // قاعده‌ای رویش اجرا نمی‌شد. کاربر یک پیام مؤدبانه می‌دید و فکر
  // می‌کرد ابزار کار نمی‌کند. با تست رگرسیون پیدا شد، نه با خواندن کد.
  if (
    /\bOn(Tick|Init|Deinit|Calculate|Timer|Trade|ChartEvent)\b/.test(src) ||
    /\b(OrderSend|OrderSelect|OrdersTotal|OrderClose|OrderModify|OrderDelete|OrderTicket|OrderLots|OrderMagicNumber)\b/.test(src) ||
    /\b(PositionsTotal|PositionSelect|PositionGetTicket|PositionGetDouble|PositionGetInteger)\b/.test(src) ||
    /\b(SymbolInfoDouble|SymbolInfoInteger|SymbolInfoString|MarketInfo|AccountBalance|AccountInfoDouble)\b/.test(src) ||
    /\b(MqlTick|MqlTradeRequest|MqlTradeResult|MqlRates|CTrade|CPositionInfo)\b/.test(src) ||
    /#property|#include\s*<|\bextern\s+(double|int|bool|string)\b|\binput\s+(double|int|bool|string|datetime|color)\b/.test(src) ||
    /\b_Symbol\b|\b_Point\b|\b_Digits\b|\bINIT_SUCCEEDED\b/.test(src)
  ) {
    return 'mql';
  }
  return 'unknown';
}

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'note'];

/**
 * یک گذر ایستا روی کد. هیچ شبکه‌ای در کار نیست و هیچ‌جا چیزی ذخیره
 * نمی‌شود — همین وعده است که باعث می‌شود یک تریدر حاضر شود استراتژی‌اش
 * را داخل کادر بگذارد.
 */
export function audit(source: string): AuditResult {
  const raw = source.split('\n');
  const masked = maskCommentsAndStrings(source);
  const lines = masked.split('\n');
  const dialect = detectDialect(masked);

  const ctx: RuleContext = {
    program: analyse(source, dialect),
    masked,
    lines,
    raw,
    has: (re) => re.test(masked),
    hasRaw: (re) => re.test(source),
    find: (re) => lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter((n) => n > 0),
  };

  const findings: Finding[] = [];
  for (const rule of rules) {
    if (rule.dialect !== dialect) continue;
    let hits: number[] = [];
    try {
      hits = rule.run(ctx);
    } catch {
      // یک قاعدهٔ خراب نباید کل گزارش را از کار بیندازد
      hits = [];
    }
    for (const line of hits) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        line,
        excerpt: (raw[line - 1] ?? '').trim().slice(0, 120),
      });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.line - b.line,
  );

  const counts: Record<Severity, number> = { critical: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;

  return { dialect, findings, lineCount: raw.length, counts };
}
