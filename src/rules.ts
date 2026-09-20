import type { Rule } from './types';
import { enclosingFunction, insideLoop, provenance, textOf, type Call, type Program } from './lang/structure';

/**
 * قواعد تحلیل ایستا.
 *
 * هر قاعده عمداً محافظه‌کار است: فقط وقتی هشدار می‌دهد که نشانه‌اش در
 * کل فایل غایب باشد، نه اینکه حدس بزند. دلیلش ساده است — این ابزار
 * نمایندهٔ کیفیت کار توست. یک هشدار غلط روی کد سالمِ یک برنامه‌نویس
 * باتجربه، بیشتر از ده هشدار درست به اعتبارت لطمه می‌زند.
 *
 * متن هر یافته در messages/*.json است تا سه‌زبانه بماند.
 */

const ORDER_SEND = /\b(OrderSend|PositionOpen|trade\.(Buy|Sell|PositionOpen)|CTrade)\b/;

/* ===================================================================
   کمک‌کارهای ساختاری

   همهٔ اینها روی مدل توکن کار می‌کنند، نه روی متن. تفاوتش در عمل این
   است که می‌شود پرسید «آرگومان حجمِ *این* فراخوانی از کجا آمده»
   به‌جای «آیا این کلمه جایی در فایل هست».
   =================================================================== */

/** فراخوانی‌هایی که یک سفارش باز می‌کنند، به هر یک از شکل‌های رایجش */
function orderOpens(p: Program): Call[] {
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
function volumeArg(c: Call): { from: number; to: number } | null {
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
function stopArgs(c: Call): { from: number; to: number }[] {
  const pick = (...ix: number[]) =>
    ix.map((i) => c.args[i]).filter((a): a is { from: number; to: number } => !!a);
  if (c.name === 'OrderSend') return c.args.length >= 7 ? pick(5, 6) : pick(0);
  if (c.name === 'OrderModify') return pick(2, 3);
  if (/\.(Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit)$/.test(c.qualified)) return pick(3, 4);
  if (/PositionModify$/.test(c.qualified) || c.name === 'PositionModify') return pick(1, 2);
  return [];
}

/** آرگومانی که فقط عدد صفر است، یعنی حدی گذاشته نمی‌شود */
function isZeroLiteral(p: Program, a: { from: number; to: number }): boolean {
  const txt = textOf(p, a.from, a.to).replace(/\s+/g, '');
  return txt === '0' || txt === '0.0' || txt === '';
}

/** فقط اولین n خطِ یکتا — فهرست بلند یافته‌ها را کسی نمی‌خواند */
function firstLines(cs: Call[], n: number): number[] {
  return [...new Set(cs.map((c) => c.line))].slice(0, n);
}

export const rules: Rule[] = [
  /* ---------------------------------------------------------------
     MQL4 / MQL5
     --------------------------------------------------------------- */
  {
    id: 'lot-not-normalised',
    severity: 'critical',
    dialect: 'mql',
    /**
     * نسخهٔ قبلی می‌پرسید «آیا کلمهٔ SYMBOL_VOLUME_STEP جایی در این فایل
     * هست؟». روی یک فایل صد خطی جواب می‌داد. روی یک پروژهٔ چهارهزار
     * خطی تقریباً همیشه «بله» بود — چون یک‌جایی، برای یک کار دیگر،
     * کسی گام حجم را خوانده بود — و قاعده دقیقاً همان‌جا که باید
     * می‌دید ساکت می‌شد.
     *
     * حالا سؤال این است: مقداری که به آرگومان حجمِ **همین** فراخوانی
     * رسیده، از مسیری آمده که گام حجم را خوانده باشد؟ ردِ انتساب‌ها و
     * بدنهٔ تابع‌های کاربر هم دنبال می‌شود، پس یک `NormalizeLots()`
     * خانگی درست تشخیص داده می‌شود.
     */
    run: ({ program }) => {
      const dirty = orderOpens(program).filter((c) => {
        const vol = volumeArg(c);
        if (!vol) return false;
        return !/SYMBOL_VOLUME_STEP|MODE_LOTSTEP|LotStep|NormalizeLot|VolumeStep/i.test(
          provenance(program, vol),
        );
      });
      return firstLines(dirty, 2);
    },
  },
  {
    id: 'stops-level',
    severity: 'critical',
    dialect: 'mql',
    /**
     * همان اصلاح: به‌جای «این ثابت جایی در فایل هست؟»، تابعی که دارد
     * حد را می‌گذارد بررسی می‌شود. اگر همان تابع حد مجاز بروکر را
     * خوانده باشد، حواسش بوده.
     */
    run: ({ program, find, has }) => {
      const LEVEL = /SYMBOL_TRADE_STOPS_LEVEL|MODE_STOPLEVEL|StopsLevel|FreezeLevel|SYMBOL_TRADE_FREEZE_LEVEL/i;
      const setters = program.calls.filter(
        (c) =>
          /^(OrderModify|PositionModify|OrderSend)$/.test(c.name) ||
          /\.(PositionModify|OrderModify|Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit)$/.test(
            c.qualified,
          ),
      );
      if (setters.length === 0) {
        // بدون فراخوانی شناخته‌شده: همان بررسی قدیمی، تا کدی که با
        // ساختار غیرمعمول نوشته شده کامل از قلم نیفتد
        if (!has(/StopLoss|TakeProfit/i)) return [];
        if (has(LEVEL)) return [];
        return find(/StopLoss|TakeProfit/i).slice(0, 1);
      }
      const dirty = setters.filter((c) => {
        const stops = stopArgs(c).filter((a) => !isZeroLiteral(program, a));
        // حدی گذاشته نمی‌شود → حد مجاز بروکر هم موضوعیت ندارد
        if (stops.length === 0) return false;
        // ردِ خودِ همان عدد: اگر تابعی که فاصله را می‌سازد حد مجاز را
        // خوانده باشد، حواسش بوده — حتی اگر آن تابع جای دیگری باشد
        return !stops.some((a) => LEVEL.test(provenance(program, a)));
      });
      return firstLines(dirty, 2);
    },
  },
  {
    id: 'trade-allowed',
    severity: 'warning',
    dialect: 'mql',
    run: ({ find, has }) => {
      if (!has(ORDER_SEND)) return [];
      if (has(/TERMINAL_TRADE_ALLOWED|IsTradeAllowed|MQL_TRADE_ALLOWED/i)) return [];
      return find(ORDER_SEND).slice(0, 1);
    },
  },
  {
    id: 'magic-filter',
    severity: 'warning',
    dialect: 'mql',
    /**
     * فیلتر مجیک باید داخل **همان حلقه‌ای** باشد که دارد پوزیشن‌ها را
     * می‌بندد. نسخهٔ قبلی کل فایل را می‌گردید، پس یک اکسپرت که در
     * تابع گزارش‌گیری‌اش مجیک را می‌خواند و در تابع بستن نمی‌خواند،
     * کاملاً سالم به‌نظر می‌رسید — و همین یکی است که حساب را خالی می‌کند.
     */
    run: ({ program }) => {
      const MAGIC = /OrderMagicNumber|POSITION_MAGIC|MagicNumber|ORDER_MAGIC|Magic/i;
      const ACTS = /^(OrderClose|OrderDelete|OrderModify|PositionClose)$/;
      const acts = program.calls.filter(
        (c) => ACTS.test(c.name) || /\.(PositionClose|OrderDelete|PositionModify)$/.test(c.qualified),
      );
      const dirty = acts.filter((c) => {
        if (!insideLoop(c.block)) return false;
        // دامنه: نزدیک‌ترین حلقه، نه کل فایل
        let scope = c.block;
        while (scope.parent && scope.kind !== 'loop') scope = scope.parent;
        const loopText = textOf(program, scope.from, scope.to);
        return !MAGIC.test(loopText);
      });
      return firstLines(dirty, 2);
    },
  },
  {
    id: 'return-ignored',
    severity: 'warning',
    dialect: 'mql',
    /**
     * نسخهٔ قبلی دنبال خطی می‌گشت که **با** OrderSend شروع شود. یعنی
     * `if(OrderSelect(i)) OrderClose(...);` را نمی‌دید — با اینکه
     * دقیقاً همان‌جا مقدار برگشتی دور ریخته می‌شود. حالا سؤال نحوی
     * است: آیا این فراخوانی خودش کل دستور است؟
     */
    run: ({ program }) => {
      const CHECKED = /^(OrderSend|OrderClose|OrderModify|OrderDelete|PositionClose|PositionModify|OrderSelect|PositionSelect)$/;
      const dropped = program.calls.filter(
        (c) =>
          !c.resultUsed &&
          (CHECKED.test(c.name) || /\.(Buy|Sell|PositionOpen|PositionClose)$/.test(c.qualified)),
      );
      return firstLines(dropped, 3);
    },
  },
  {
    id: 'double-equality',
    severity: 'warning',
    dialect: 'mql',
    run: ({ lines }) =>
      lines
        .map((l, i) =>
          /(price|lot|lots|point|bid|ask|profit|balance|equity|volume)\s*(==|!=)/i.test(l) ||
          /(==|!=)\s*\d+\.\d+/.test(l)
            ? i + 1
            : 0,
        )
        .filter((n) => n > 0)
        .slice(0, 3),
  },
  {
    id: 'martingale',
    severity: 'critical',
    dialect: 'mql',
    // نام متغیر معمولاً `currentLot` است نه `lot`، پس مرز واژه قبل از
    // «lot» کافی نیست و باید پیشوند را هم قبول کنیم
    run: ({ lines }) =>
      lines
        .map((l, i) =>
          /\b\w*(lot|lots|volume)\w*\s*(\*=|=[^;=]*\*)[^;]*\b(2|multiplier|factor|martin)/i.test(l)
            ? i + 1
            : 0,
        )
        .filter((n) => n > 0)
        .slice(0, 2),
  },
  {
    id: 'five-digit',
    severity: 'warning',
    dialect: 'mql',
    run: ({ find, has }) => {
      if (!has(/\b_?Point\b/)) return [];
      if (has(/_Digits\s*==\s*[35]|Digits\s*\(\s*\)\s*==\s*[35]|pipFactor|PointAdjust/i)) return [];
      return find(/\b_?Point\b/).slice(0, 1);
    },
  },
  {
    id: 'sleep-in-ontick',
    severity: 'note',
    dialect: 'mql',
    /**
     * «داخل OnTick» حالا واقعاً یعنی داخل OnTick. قبلاً هر Sleep در هر
     * جای فایل علامت می‌خورد، از جمله در OnDeinit یا یک تابع کمکی که
     * فقط در initialize صدا می‌شود — و آنجا Sleep هیچ ایرادی ندارد.
     */
    run: ({ program }) => {
      const TICK = /^(OnTick|OnCalculate|start)$/;
      const inTick = program.calls.filter((c) => {
        if (c.name !== 'Sleep') return false;
        const fn = enclosingFunction(c.block);
        return !!fn?.name && TICK.test(fn.name);
      });
      return firstLines(inTick, 2);
    },
  },
  {
    id: 'zero-guard',
    severity: 'warning',
    dialect: 'mql',
    /**
     * تقسیم بر متغیری که در همان تابع هیچ‌جا در برابر صفر بررسی نشده.
     * قبلاً یک `!= 0` در هر گوشهٔ فایل کافی بود تا کل قاعده ساکت شود.
     */
    run: ({ program, find, has }) => {
      const GUARD = /(!=|>=|<=|>|<|==)\s*0(\.0)?\b|MathAbs|fabs/i;
      const hits: number[] = [];
      for (const s of program.stmts) {
        const toks = program.toks;
        for (let i = s.from; i < s.to - 1; i++) {
          if (toks[i].kind !== 'op' || toks[i].text !== '/') continue;
          const denom = toks[i + 1];
          if (denom.kind !== 'id') continue;
          const fn = enclosingFunction(s.block);
          const scope = fn ? textOf(program, fn.from, fn.to) : '';
          // آیا همین مخرج جایی در همین تابع در برابر صفر بررسی شده؟
          const near = new RegExp(
            denom.text.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '\\s*(!=|>|<|==|>=|<=)\\s*0',
          );
          if (near.test(scope) || GUARD.test(textOf(program, s.from, s.to))) continue;
          // ثابت‌هایی که بروکر می‌دهد (گام حجم، اندازهٔ تیک، Point) عملاً
          // هیچ‌وقت صفر نیستند. متنِ خودِ این قاعده هم دربارهٔ بافر
          // اندیکاتور است، نه دربارهٔ این‌ها — پس علامت‌زدنشان یعنی
          // یافته‌ای که توضیحش با چیزی که پیدا شده نمی‌خواند.
          if (/SymbolInfo|AccountInfo|MarketInfo|_Point|_Digits|TickSize|TickValue/i.test(
              provenance(program, { from: i + 1, to: i + 2 }))) continue;
          hits.push(denom.line);
          break;
        }
      }
      if (hits.length === 0) {
        // بدون ساختار قابل‌تشخیص، همان بررسی قدیمی
        const divides = /\/\s*[A-Za-z_]\w*/;
        if (!has(divides) || has(/(!=|>=|<=|>|<|==)\s*0(\.0)?\b/)) return [];
        return find(divides).slice(0, 1);
      }
      return [...new Set(hits)].slice(0, 2);
    },
  },

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
    run: ({ find }) => find(/lookahead\s*=\s*barmerge\.lookahead_on/).slice(0, 2),
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
