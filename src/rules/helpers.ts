import { enclosingFunction, insideLoop, provenance, textOf, type Call, type Program } from '../lang/structure';

// قاعده‌ها فقط از همین فایل می‌خوانند، نه مستقیم از lang/structure —
// یعنی اگر روزی امضای لایهٔ ساختار عوض شود، یک فایل باید تغییر کند نه ده تا.
export { enclosingFunction, insideLoop, provenance, textOf };
export type { Call, Program };

/**
 * کمک‌کارهای مشترک قاعده‌ها.
 *
 * هر قاعده عمداً محافظه‌کار است: فقط وقتی هشدار می‌دهد که نشانه‌اش در
 * کل فایل غایب باشد، نه اینکه حدس بزند. دلیلش ساده است — این ابزار
 * نمایندهٔ کیفیت کار توست. یک هشدار غلط روی کد سالمِ یک برنامه‌نویس
 * باتجربه، بیشتر از ده هشدار درست به اعتبارت لطمه می‌زند.
 *
 * متن هر یافته در messages/*.json است تا سه‌زبانه بماند.
 */

export const ORDER_SEND = /\b(OrderSend|PositionOpen|trade\.(Buy|Sell|PositionOpen)|CTrade)\b/;

/* ===================================================================
   کمک‌کارهای ساختاری

   همهٔ اینها روی مدل توکن کار می‌کنند، نه روی متن. تفاوتش در عمل این
   است که می‌شود پرسید «آرگومان حجمِ *این* فراخوانی از کجا آمده»
   به‌جای «آیا این کلمه جایی در فایل هست».
   =================================================================== */

/** فراخوانی‌هایی که یک سفارش باز می‌کنند، به هر یک از شکل‌های رایجش */
export function orderOpens(p: Program): Call[] {
  return p.calls.filter((c) =>
    /^(OrderSend|PositionOpen)$/.test(c.name) ||
    /\.(Buy|Sell|PositionOpen|BuyStop|SellStop|BuyLimit|SellLimit)$/.test(c.qualified),
  );
}

/**
 * آرگومان حجم را در امضاهای مختلف پیدا می‌کند.
 *
 * ‏MQL4: OrderSend(symbol, cmd, **volume**, price, …)
 * ‏MQL5: OrderSend(request, result) — حجم داخل request.volume است و
 *        provenance خودش از روی `request` دنبالش می‌گردد
 * ‏CTrade: trade.Buy(**volume**, symbol, …) و
 *         trade.PositionOpen(symbol, type, **volume**, …)
 */
export function volumeArg(c: Call): { from: number; to: number } | null {
  if (c.name === 'OrderSend') {
    if (c.args.length >= 7) return c.args[2] ?? null; // MQL4
    return c.args[0] ?? null; // MQL5 — خودِ request
  }
  if (/\.(Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit)$/.test(c.qualified)) return c.args[0] ?? null;
  if (/PositionOpen$/.test(c.qualified) || c.name === 'PositionOpen') return c.args[2] ?? c.args[0] ?? null;
  return c.args[0] ?? null;
}

/**
 * آرگومان‌های حد ضرر و حد سود، در امضاهای رایج.
 *
 * ‏MQL4 OrderSend(sym, cmd, vol, price, slip, **sl**, **tp**, …)
 * ‏MQL4 OrderModify(ticket, price, **sl**, **tp**, …)
 * ‏CTrade Buy(vol, sym, price, **sl**, **tp**, …)
 * ‏CTrade PositionModify(sym, **sl**, **tp**)
 * ‏MQL5 OrderSend(request, result) → از روی خود request دنبال می‌شود
 */
export function stopArgs(c: Call): { from: number; to: number }[] {
  const pick = (...ix: number[]) =>
    ix.map((i) => c.args[i]).filter((a): a is { from: number; to: number } => !!a);
  if (c.name === 'OrderSend') return c.args.length >= 7 ? pick(5, 6) : pick(0);
  if (c.name === 'OrderModify') return pick(2, 3);
  if (/\.(Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit)$/.test(c.qualified)) return pick(3, 4);
  if (/PositionModify$/.test(c.qualified) || c.name === 'PositionModify') return pick(1, 2);
  return [];
}

/** آرگومانی که فقط عدد صفر است، یعنی حدی گذاشته نمی‌شود */
export function isZeroLiteral(p: Program, a: { from: number; to: number }): boolean {
  const txt = textOf(p, a.from, a.to).replace(/\s+/g, '');
  return txt === '0' || txt === '0.0' || txt === '';
}

/** فقط اولین n خطِ یکتا — فهرست بلند یافته‌ها را کسی نمی‌خواند */
export function firstLines(cs: Call[], n: number): number[] {
  return [...new Set(cs.map((c) => c.line))].slice(0, n);
}

