import type { Rule } from '../types';


/** قاعده‌های Pine Script */
export const pineRules: Rule[] = [
  /* ---------------------------------------------------------------
     Pine v4 / v5 / v6
     --------------------------------------------------------------- */
  {
    id: 'pine-lookahead-missing',
    severity: 'critical',
    dialect: 'pine',
    run: ({ find, has }) => {
      if (!has(/\b(request\.)?security\s*\(/)) return [];
      if (has(/lookahead\s*=/)) return [];
      return find(/\b(request\.)?security\s*\(/).slice(0, 2);
    },
  },
  {
    id: 'pine-lookahead-on',
    severity: 'critical',
    dialect: 'pine',
    /**
     * فقط `lookahead_on` **بدون** جابه‌جایی `[1]`.
     *
     * نسخهٔ قبلی هر `lookahead_on` را بحرانی علامت می‌زد — از جمله
     * `request.security(..., close[1], lookahead = barmerge.lookahead_on)`،
     * که مستندات خود TradingView (صفحهٔ Repainting) دقیقاً همان را تنها
     * شکل بدون repaint می‌داند. نشت آینده فقط وقتی است که عبارت جابه‌جا
     * نشده باشد: روی کندل‌های تاریخی، مقدار نهایی کندل تایم‌فریم بالاتر
     * پیش از بسته شدنش خوانده می‌شود.
     */
    run: ({ lines }) =>
      lines
        .map((l, i) =>
          /lookahead\s*=\s*barmerge\.lookahead_on/.test(l) && !/\[\s*[1-9]\d*\s*\]/.test(l) ? i + 1 : 0,
        )
        .filter((n) => n > 0)
        .slice(0, 2),
  },
  {
    id: 'pine-no-offset',
    severity: 'critical',
    dialect: 'pine',
    run: ({ lines }) =>
      lines
        .map((l, i) =>
          /\b(request\.)?security\s*\(/.test(l) && !/\[\s*1\s*\]/.test(l) ? i + 1 : 0,
        )
        .filter((n) => n > 0)
        .slice(0, 2),
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
