import type { Rule } from '../types';


/**
 * هر فراخوانی `request.security()` (یا `security()` قدیمی)، با آرگومان‌هایش.
 *
 * چرا ساختاری و نه خط‌به‌خط: نسخهٔ قبلی می‌پرسید «آیا روی این خط یک `[1]`
 * هست؟». یعنی آفستی که روی **نتیجه** گذاشته شده —
 * `request.security(..., close, lookahead = barmerge.lookahead_on)[1]` — یا هر
 * `x[1]` دیگری روی همان خط، نشت آینده را ساکت می‌کرد، و فراخوانی‌ای که روی
 * چند خط شکسته شده بود اصلاً درست خوانده نمی‌شد. حالا پرانتزها شمرده می‌شوند
 * و فقط آرگومان `expression` بررسی می‌شود.
 */
type SecurityCall = {
  /** خطِ شروع فراخوانی، از ۱ */
  line: number;
  /** متن آرگومان expression */
  expression: string;
  lookahead: 'on' | 'off' | null;
  /** خطی که lookahead رویش نوشته شده — یا خط شروع، اگر ننوشته */
  lookaheadLine: number;
};

function securityCalls(masked: string): SecurityCall[] {
  const out: SecurityCall[] = [];
  const lineAt = (i: number) => masked.slice(0, i).split('\n').length;
  for (const m of masked.matchAll(/\b(?:request\.)?security\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length;
    let depth = 0;
    let argStart = open;
    const args: { text: string; at: number }[] = [];
    let i = open;
    for (; i < masked.length; i++) {
      const c = masked[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) {
        args.push({ text: masked.slice(argStart, i), at: argStart });
        argStart = i + 1;
      }
    }
    args.push({ text: masked.slice(argStart, i), at: argStart });

    const named = (k: string) => args.find((a) => new RegExp(`^\\s*${k}\\s*=`).test(a.text));
    const positional = args.filter((a) => !/^\s*[A-Za-z_]\w*\s*=[^=]/.test(a.text));
    const expr = named('expression') ?? positional[2];
    const look = named('lookahead') ?? args.find((a) => /barmerge\.lookahead_(on|off)/.test(a.text));
    const which = look && /barmerge\.lookahead_on/.test(look.text) ? 'on' : look ? 'off' : null;
    out.push({
      line: lineAt(m.index ?? 0),
      expression: expr ? expr.text.replace(/^\s*expression\s*=/, '') : '',
      lookahead: which,
      lookaheadLine: look ? lineAt(look.at + (look.text.length - look.text.trimStart().length)) : lineAt(m.index ?? 0),
    });
  }
  return out;
}

/** آیا عبارت درخواستی دست‌کم یک کندل جابه‌جا شده — `close[1]`، `ta.ema(close, 20)[1]` */
const OFFSET = /\[\s*[1-9]\d*\s*\]/;

/** قاعده‌های Pine Script */
export const pineRules: Rule[] = [
  /* ---------------------------------------------------------------
     Pine v4 / v5 / v6
     --------------------------------------------------------------- */
  {
    id: 'pine-lookahead-missing',
    severity: 'critical',
    dialect: 'pine',
    /**
     * پیش‌فرض `lookahead_off` است و آینده را نمی‌خواند — ولی شکل بدون repaint
     * هم نیست. فراخوانی‌ای که lookahead را انتخاب نکرده علامت می‌خورد.
     */
    run: ({ masked }) =>
      [...new Set(securityCalls(masked).filter((c) => c.lookahead === null).map((c) => c.line))].slice(0, 2),
  },
  {
    id: 'pine-lookahead-on',
    severity: 'critical',
    dialect: 'pine',
    /**
     * فقط `lookahead_on` **بدون** جابه‌جایی روی عبارت درخواستی.
     *
     * `request.security(..., close[1], lookahead = barmerge.lookahead_on)` همان
     * شکلی است که مستندات TradingView (صفحهٔ Repainting) تنها راه بدون
     * repaint می‌داند. نشت آینده فقط وقتی است که خودِ عبارت جابه‌جا نشده
     * باشد: روی کندل‌های تاریخی، مقدار نهایی کندل تایم‌فریم بالاتر پیش از
     * بسته شدنش خوانده می‌شود.
     */
    run: ({ masked }) =>
      [
        ...new Set(
          securityCalls(masked)
            .filter((c) => c.lookahead === 'on' && !OFFSET.test(c.expression))
            .map((c) => c.lookaheadLine),
        ),
      ].slice(0, 2),
  },
  {
    id: 'pine-no-offset',
    severity: 'critical',
    dialect: 'pine',
    run: ({ masked }) =>
      [...new Set(securityCalls(masked).filter((c) => !OFFSET.test(c.expression)).map((c) => c.line))].slice(0, 2),
  },
  {
    id: 'pine-version',
    severity: 'note',
    dialect: 'pine',
    // روی منبع خام، چون خودِ این خط یک کامنت است
    run: ({ hasRaw }) => (hasRaw(/\/\/@version\s*=/) ? [] : [0]),
  },
  {
    id: 'pine-calc-every-tick',
    severity: 'warning',
    dialect: 'pine',
    run: ({ find }) => find(/calc_on_every_tick\s*=\s*true/).slice(0, 1),
  },
  {
    id: 'pine-repainting-varip',
    severity: 'note',
    dialect: 'pine',
    run: ({ find }) => find(/\bvarip\b/).slice(0, 1),
  },
];
