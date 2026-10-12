import type { Rule } from '../types';
import {
  enclosingFunction,
  firstLines,
  orderOpens,
  provenance,
  textOf,
  volumeArg,
  type Program,
} from './helpers';

/**
 * دستهٔ A و بخشی از B، E، F، J — محدودیت‌های بروکر، پیمایش، زمان، هندل.
 *
 * هر قاعدهٔ اینجا از مستندات رسمی متاکوتس راستی‌آزمایی شده، نه از حافظه.
 * سه قاعده‌ای که می‌خواستیم بنویسیم و غلط بودند در
 * `docs/RULES-ROADMAP.md` ثبت شده‌اند — از جمله «iMA در هر تیک هندل نشت
 * می‌دهد» که ادعای رایجی است و **غلط است**: MQL5 هندل‌های با پارامتر
 * یکسان را خودش یکی می‌کند.
 */

/** فراخوانی‌هایی که یک پوزیشن یا سفارش موجود را دست می‌زنند */
const TOUCHES_EXISTING =
  /^(OrderClose|OrderDelete|OrderModify|PositionClose|PositionModify|OrderCloseBy)$/;

/**
 * آیا این فایل نشانه‌های قطعی MQL5 دارد؟
 *
 * ⚠️ فقط چیزهایی که در MQL4 **نیستند**. `SymbolInfoDouble`،
 * `SymbolInfoInteger`، `CopyRates` و `OnCalculate` از build 600 در MQL4 هم
 * هستند، و نسخهٔ قبلی همین‌ها را نشانهٔ MQL5 می‌گرفت — یعنی یک اکسپرت سالم
 * MQL4 که `RefreshRates()` را درست به‌کار می‌برد، هشدار بحرانی «کامپایل
 * نمی‌شود» می‌گرفت.
 */
function looksLikeMql5(p: Program): boolean {
  const all = textOf(p, 0, p.toks.length);
  const pre = p.toks.filter((t) => t.kind === 'pre').map((t) => t.text).join('\n');
  return (
    /\b(MqlTradeRequest|MqlTradeResult|MqlTradeTransaction|CTrade|CPositionInfo|PositionsTotal|PositionGetTicket|PositionSelect|PositionSelectByTicket|PositionGetDouble|PositionGetInteger|CopyBuffer|OnTradeTransaction|HistorySelect)\b/.test(all) ||
    /#include\s*<Trade\//.test(pre)
  );
}

const whole = (p: Program) => textOf(p, 0, p.toks.length);

export const mqlBroker: Rule[] = [
  /* ═══════════════════════════ A · محدودیت‌های بروکر ═══════════════════ */
  {
    id: 'lot-min-max-unclamped',
    severity: 'critical',
    dialect: 'mql',
    /**
     * عمداً فقط وقتی شلیک می‌کند که گام حجم **رعایت شده باشد**.
     *
     * دلیلش این است که اگر گام هم رعایت نشده باشد، `lot-not-normalised`
     * همان خط را علامت می‌زند و دو یافته روی یک مشکل، گزارش را شلوغ
     * می‌کند بدون اینکه چیزی اضافه کند. این قاعده برای کسی است که به
     * گام فکر کرده ولی به کف و سقف نه — و بروکر حجم زیر `VOLUME_MIN` را
     * همان‌قدر رد می‌کند که حجم نانرمال را.
     */
    run: ({ program }) => {
      const dirty = orderOpens(program).filter((c) => {
        const vol = volumeArg(c);
        if (!vol) return false;
        const prov = provenance(program, vol);
        const stepHandled = /SYMBOL_VOLUME_STEP|MODE_LOTSTEP|LotStep|VolumeStep/i.test(prov);
        if (!stepHandled) return false;
        return !/SYMBOL_VOLUME_MIN|SYMBOL_VOLUME_MAX|MODE_MINLOT|MODE_MAXLOT|MinLot|MaxLot/i.test(
          prov,
        );
      });
      return firstLines(dirty, 2);
    },
  },
  {
    id: 'freeze-level',
    severity: 'critical',
    dialect: 'mql',
    /**
     * `SYMBOL_TRADE_FREEZE_LEVEL` با `SYMBOL_TRADE_STOPS_LEVEL` یکی نیست و
     * جای دیگری را می‌گیرد: stops level می‌گوید حد را **کجا بگذار**،
     * freeze level می‌گوید چیزی که **الان وجود دارد** را کِی نمی‌توانی
     * دست بزنی. نقض اولی retcode 10016 می‌دهد، دومی 10029.
     *
     * پس خواندن stops level این قاعده را ساکت نمی‌کند — عمداً.
     */
    run: ({ program }) => {
      const touches = program.calls.filter(
        (c) => TOUCHES_EXISTING.test(c.name) || /\.(PositionClose|OrderDelete|PositionModify)$/.test(c.qualified),
      );
      if (touches.length === 0) return [];
      if (/SYMBOL_TRADE_FREEZE_LEVEL|MODE_FREEZELEVEL|FreezeLevel/i.test(whole(program))) return [];
      return firstLines(touches, 2);
    },
  },
  {
    id: 'margin-not-checked',
    severity: 'warning',
    dialect: 'mql',
    /**
     * همان بررسی‌ای که خود متاکوتس برای انتشار در Market الزامی کرده:
     * پیش از هر ارسال، کفایت وجه را با `OrderCalcMargin()` در برابر
     * `ACCOUNT_MARGIN_FREE` بسنج.
     *
     * ⚠️ این قاعده عمداً دربارهٔ balance در برابر equity حرفی نمی‌زند.
     * برای آن هیچ «خطر نام‌دار» مستندی وجود ندارد و ادعایش کردن یعنی
     * چیزی گفتن که نمی‌توانیم پشتش بایستیم.
     */
    run: ({ program }) => {
      const opens = orderOpens(program);
      if (opens.length === 0) return [];
      if (
        /OrderCalcMargin|AccountFreeMarginCheck|ACCOUNT_MARGIN_FREE|AccountFreeMargin|CheckMoneyForTrade/i.test(
          whole(program),
        )
      ) {
        return [];
      }
      return firstLines(opens, 1);
    },
  },
  {
    id: 'slippage-zero',
    severity: 'warning',
    dialect: 'mql',
    /** MQL4: `OrderSend(symbol, cmd, volume, price, **slippage**, …)` */
    run: ({ program }) => {
      const dirty = program.calls.filter((c) => {
        if (c.name !== 'OrderSend' || c.args.length < 7) return false;
        const slip = c.args[4];
        if (!slip) return false;
        return textOf(program, slip.from, slip.to).replace(/\s+/g, '') === '0';
      });
      return firstLines(dirty, 1);
    },
  },
  {
    id: 'partial-fill-unhandled',
    severity: 'critical',
    dialect: 'mql',
    /**
     * ‏MQL5: `OrderSend(request, result)` ممکن است بخشی از حجم را پر کند.
     * اگر `result.volume` با `request.volume` سنجیده نشود، اکسپرت باور
     * می‌کند در پوزیشن کاملی است که نیست، و هر محاسبهٔ بعدی — حد ضرر،
     * حجم خروج، ریسک — روی عدد غلط بنا می‌شود.
     */
    run: ({ program }) => {
      const mql5Send = program.calls.filter((c) => c.name === 'OrderSend' && c.args.length === 2);
      if (mql5Send.length === 0) return [];
      // آیا جایی حجمِ نتیجه با چیزی مقایسه شده؟
      if (/\.\s*volume\s*(<|>|!=|==|<=|>=)/.test(whole(program))) return [];
      if (/deal_volume|filled|partial/i.test(whole(program))) return [];
      return firstLines(mql5Send, 1);
    },
  },
  {
    id: 'requote-unhandled',
    severity: 'warning',
    dialect: 'mql',
    /**
     * فقط وقتی شلیک می‌کند که کد **دارد** retcode را نگاه می‌کند — یعنی
     * حواسش به نتیجه هست — ولی هیچ‌کدام از کدهای ریکوت و قیمت‌کهنه را
     * جدا نکرده. روی کدی که اصلاً نتیجه را نمی‌خواند، `return-ignored`
     * حرف اصلی را می‌زند و این یکی چیزی اضافه نمی‌کند.
     */
    run: ({ program }) => {
      const all = whole(program);
      if (!/retcode|GetLastError/i.test(all)) return [];
      const opens = orderOpens(program);
      if (opens.length === 0) return [];
      if (
        // 10020 همان TRADE_RETCODE_PRICE_CHANGED است و از این فهرست جا مانده بود،
        // پس کسی که عدد خام را نوشته بود هشدار می‌گرفت. 135 هم همتای MQL4 آن است.
        // عدد خام فقط وقتی حساب است که با چیزی مقایسه شده باشد — `135` به‌عنوان
        // دوره یا فاصله نباید این قاعده را ساکت کند.
        /TRADE_RETCODE_REQUOTE|TRADE_RETCODE_PRICE_CHANGED|TRADE_RETCODE_PRICE_OFF|ERR_REQUOTE|ERR_PRICE_CHANGED|ERR_OFF_QUOTES|(?:==|!=|\bcase)\s*(?:1000[46]|1002[01]|13[568])\b|\b(?:1000[46]|1002[01]|13[568])\s*(?:==|!=)/.test(
          all,
        )
      ) {
        return [];
      }
      return firstLines(opens, 1);
    },
  },
  {
    id: 'no-sl-at-all',
    severity: 'critical',
    dialect: 'mql',
    /**
     * هر ارسالی حد ضرر صفر دارد و هیچ‌جا بعداً حدی گذاشته نمی‌شود.
     * این لزوماً باگ نیست — بعضی استراتژی‌ها عمداً بدون حد کار می‌کنند —
     * ولی اگر عمدی است باید تصمیمی باشد که گرفته شده، نه چیزی که جا مانده.
     */
    run: ({ program }) => {
      const opens = orderOpens(program);
      if (opens.length === 0) return [];
      const all = whole(program);
      if (/OrderModify|PositionModify|SetStopLoss|\bsl\s*=\s*[^0\s]/i.test(all)) return [];
      const everyOpenHasZeroSl = opens.every((c) => {
        if (c.name === 'OrderSend' && c.args.length >= 7) {
          const sl = c.args[5];
          return !!sl && textOf(program, sl.from, sl.to).replace(/\s+/g, '') === '0';
        }
        return false;
      });
      return everyOpenHasZeroSl ? firstLines(opens, 1) : [];
    },
  },

  /* ═══════════════════════════ B · پیمایش ══════════════════════════════ */
  {
    id: 'loop-forward-while-closing',
    severity: 'critical',
    dialect: 'mql',
    /**
     * حلقه‌ای که رو به جلو می‌رود و حین حرکت می‌بندد، یکی‌درمیان جا
     * می‌گذارد — و این از آن باگ‌هایی است که در تستر هرگز دیده نمی‌شود
     * چون آنجا معمولاً یک پوزیشن باز است.
     *
     * وقتی ایندکس ۰ بسته می‌شود، آنچه در ایندکس ۱ بود می‌آید روی ۰، ولی
     * شمارنده رفته روی ۱. یعنی دقیقاً یکی در میان بسته می‌شود و بقیه
     * باز می‌مانند — در روزی که می‌خواستی همه را ببندی.
     *
     * اصطلاح درست: از آخر به اول. (و روی حساب شلوغ یا بروکر FIFO،
     * بهتر است اول تیکت‌ها را در آرایه جمع کنی و بعد عمل کنی.)
     */
    run: ({ program }) => {
      const hits: number[] = [];
      for (const b of program.blocks) {
        if (b.kind !== 'loop') continue;
        // سرِ حلقه: توکن‌های پیش از «{»
        const headFrom = Math.max(0, b.from - 40);
        const head = textOf(program, headFrom, b.from);
        const ascending = /\bi \+\+|\+\+ i|i \+= 1/.test(head);
        const overOrders = /(OrdersTotal|PositionsTotal|ObjectsTotal)\s*\(/.test(head);
        const lessThan = /<\s*(OrdersTotal|PositionsTotal|\w+)/.test(head);
        if (!ascending || !overOrders || !lessThan) continue;
        const body = textOf(program, b.from, b.to);
        if (!/\b(OrderClose|OrderDelete|PositionClose)\b|\.\s*(PositionClose|OrderDelete)\b/.test(body)) {
          continue;
        }
        hits.push(program.toks[b.from]?.line ?? b.line);
      }
      return [...new Set(hits)].slice(0, 2);
    },
  },
  {
    id: 'history-select-missing',
    severity: 'critical',
    dialect: 'mql',
    /**
     * بدون `HistorySelect()` فهرست تاریخچهٔ برنامه خالی است، و
     * `HistoryDealGetTicket()` بی‌هیچ خطایی صفر برمی‌گرداند. حلقه هیچ
     * کاری نمی‌کند و کسی متوجه نمی‌شود — «اکسپرت من معامله‌های بستهٔ
     * خودش را پیدا نمی‌کند».
     */
    run: ({ program }) => {
      const users = program.calls.filter((c) =>
        /^(HistoryDealGetTicket|HistoryOrderGetTicket|HistoryDealsTotal|HistoryOrdersTotal|HistoryDealGetDouble|HistoryDealGetInteger)$/.test(
          c.name,
        ),
      );
      if (users.length === 0) return [];
      if (/HistorySelect|HistorySelectByPosition/.test(whole(program))) return [];
      return firstLines(users, 1);
    },
  },
  {
    id: 'history-select-clobbered',
    severity: 'critical',
    dialect: 'mql',
    /**
     * `HistoryDealSelect()` فهرست معامله‌هایی را که `HistorySelect()` ساخته
     * **پاک می‌کند** و فقط یک معامله در آن می‌گذارد؛ `HistoryOrderSelect()`
     * همین کار را با فهرست سفارش‌ها می‌کند. صدا زدن هر کدام داخل حلقه‌ای که
     * روی فهرست **خودش** می‌چرخد، یعنی فهرست وسط پیمایش زیر پای حلقه خالی می‌شود.
     */
    run: ({ program }) => {
      const hits: number[] = [];
      for (const b of program.blocks) {
        if (b.kind !== 'loop') continue;
        const head = textOf(program, Math.max(0, b.from - 40), b.from);
        const body = textOf(program, b.from, b.to);
        // هر تابع فقط فهرست **خودش** را پاک می‌کند: HistoryDealSelect فهرست
        // معامله‌ها را، HistoryOrderSelect فهرست سفارش‌ها را. پس
        // HistoryOrderSelect داخل حلقه‌ای روی معامله‌ها — برای خواندن سفارشِ
        // والد یک معامله — درست است و نباید علامت بخورد.
        const deals = /HistoryDealsTotal/.test(head) && /\bHistoryDealSelect\b/.test(body);
        const orders = /HistoryOrdersTotal/.test(head) && /\bHistoryOrderSelect\b/.test(body);
        if (!deals && !orders) continue;
        hits.push(program.toks[b.from]?.line ?? b.line);
      }
      return [...new Set(hits)].slice(0, 2);
    },
  },

  /* ═══════════════════════════ E · زمان ════════════════════════════════ */
  {
    id: 'local-time-for-trading',
    severity: 'critical',
    dialect: 'mql',
    /**
     * `TimeLocal()` ساعت کامپیوتری است که ترمینال رویش اجرا می‌شود؛
     * `TimeCurrent()` ساعت سرور معاملاتی. اگر منطق ورود روی ساعت محلی
     * بنا شود، همان اکسپرت روی VPS آلمان و لپ‌تاپ تهران دو رفتار
     * متفاوت دارد — و با تغییر ساعت تابستانی، خودش هم عوض می‌شود.
     */
    run: ({ program }) => {
      const dirty = program.calls.filter((c) => {
        if (!/^(TimeLocal|TimeGMT)$/.test(c.name)) return false;
        const fn = enclosingFunction(c.block);
        if (!fn) return false;
        const body = textOf(program, fn.from, fn.to);
        return /OrderSend|PositionOpen|\.\s*(Buy|Sell)\s*\(/.test(body);
      });
      return firstLines(dirty, 2);
    },
  },

  /* ═══════════════════════════ F · هندل اندیکاتور ═════════════════════ */
  {
    id: 'copybuffer-return-ignored',
    severity: 'critical',
    dialect: 'mql',
    /**
     * `CopyBuffer` منفی برمی‌گرداند اگر خطا باشد، و **عددی کمتر از
     * درخواست** اگر داده تا پایان مهلت آماده نشده باشد. حالت دوم است که
     * خطرناک است: خطایی رخ نمی‌دهد، فقط دُم آرایه دست‌نخورده و کهنه
     * می‌ماند و اکسپرت روی آن تصمیم می‌گیرد.
     *
     * پس محافظ درست `!= count` است، نه `!= -1`.
     */
    run: ({ program }) => {
      const dropped = program.calls.filter((c) => c.name === 'CopyBuffer' && !c.resultUsed);
      return firstLines(dropped, 2);
    },
  },
  {
    id: 'arraysetasseries-missing',
    severity: 'critical',
    dialect: 'mql',
    /**
     * قاتل خاموش.
     *
     * `CopyBuffer` و `CopyRates` **همیشه** قدیمی‌ترین عنصر را در ابتدای
     * حافظه می‌گذارند، صرف‌نظر از اینکه آرایه سری باشد یا نه. بدون
     * `ArraySetAsSeries(arr, true)`، آن `arr[0]` که فکر می‌کنی کندل
     * جاری است، **قدیمی‌ترین کندل پنجره** است. نه خطایی، نه هشداری،
     * نه تغییری در مقدار برگشتی — فقط معامله روی دادهٔ کهنه.
     */
    run: ({ program }) => {
      const copies = program.calls.filter((c) =>
        /^Copy(Buffer|Rates|Time|Open|High|Low|Close|TickVolume|RealVolume|Spread)$/.test(c.name),
      );
      if (copies.length === 0) return [];
      const all = whole(program);
      const dirty = copies.filter((c) => {
        const last = c.args[c.args.length - 1];
        if (!last) return false;
        const name = textOf(program, last.from, last.to).trim().split(/\s+/).pop();
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) return false;
        return !new RegExp(`ArraySetAsSeries\\s*\\(\\s*${name}\\b`).test(all);
      });
      return firstLines(dirty, 2);
    },
  },
  {
    id: 'arraysetasseries-on-static',
    severity: 'warning',
    dialect: 'mql',
    /**
     * پرچم سری روی آرایهٔ ایستا یا چندبعدی قابل تنظیم نیست —
     * `ArraySetAsSeries` در این حالت `false` برمی‌گرداند و آرایه
     * رو به جلو می‌ماند. چون تقریباً هیچ‌کس این مقدار برگشتی را
     * نمی‌خواند، نتیجه همان اشتباه بالاست، این‌بار با یک خط کد که
     * ظاهرش می‌گوید مسئله حل شده.
     */
    run: ({ program }) => {
      const all = whole(program);
      const dirty = program.calls.filter((c) => {
        if (c.name !== 'ArraySetAsSeries') return false;
        const first = c.args[0];
        if (!first) return false;
        const name = textOf(program, first.from, first.to).trim();
        if (!/^[A-Za-z_]\w*$/.test(name)) return false;
        // اعلانی با اندازهٔ ثابت — `double buf [ 10 ]` — یا چندبعدی: `double m [ ] [ 4 ]`.
        //
        // ⚠️ نوع پیش از نام الزامی است. نسخهٔ قبلی فقط `buf[0]` را می‌گشت و
        // هر **خواندنِ** آرایه با اندیس عددی را اعلان ایستا می‌دید — یعنی
        // تقریباً هر اکسپرتی که `buf[0]` را می‌خواند این هشدار را می‌گرفت.
        // نوع هر شناسه‌ای می‌تواند باشد (ساختار کاربر هم: `S buf[10]`)، به‌جز
        // کلیدواژه‌هایی که پیش از یک خواندن می‌آیند. اعلان‌های چندتایی هم:
        // `double a[10], buf[10]` — مقداردهی اولیهٔ قبلی‌ها نمی‌تواند پرانتز
        // داشته باشد، تا ویرگولِ داخل یک فراخوانی با ویرگولِ اعلان قاطی نشود.
        const T = '(?!(?:return|else|case|delete|new|sizeof)\\b)[A-Za-z_]\\w*';
        const prev = '(?:[A-Za-z_]\\w*\\s*(?:\\[[^\\]]*\\]\\s*)*(?:=[^,;(){}]*)?,\\s*)*';
        return new RegExp(
          `\\b${T}\\s+${prev}${name}\\s*\\[\\s*\\d+\\s*\\]|\\b${T}\\s+${prev}${name}\\s*\\[\\s*\\d*\\s*\\]\\s*\\[`,
        ).test(all);
      });
      return firstLines(dirty, 2);
    },
  },

  /* ═══════════════════════════ J · MQL4 در برابر MQL5 ═════════════════ */
  {
    id: 'refreshrates-in-mql5',
    severity: 'critical',
    dialect: 'mql',
    /**
     * `RefreshRates()` در MQL5 **وجود ندارد**. نه اینکه بی‌اثر باشد —
     * اصلاً در زبان نیست و کد کامپایل نمی‌شود. معمولاً بازماندهٔ یک
     * انتقال ناتمام از MQL4 است.
     *
     * جایگزین: `MqlTick t; SymbolInfoTick(_Symbol, t);`
     */
    run: ({ program }) => {
      if (!looksLikeMql5(program)) return [];
      const calls = program.calls.filter((c) => c.name === 'RefreshRates');
      return firstLines(calls, 1);
    },
  },
];
