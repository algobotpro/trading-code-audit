import type { Program } from './lang/structure';

export type Severity = 'critical' | 'warning' | 'note';
export type Dialect = 'mql' | 'pine' | 'unknown';

export type Finding = {
  /** کلید ترجمه — متن یافته در messages است، نه اینجا */
  ruleId: string;
  severity: Severity;
  /** شمارهٔ خط، از ۱. صفر یعنی یافته به کل فایل مربوط است. */
  line: number;
  /** خط منبع، بریده‌شده — تا کاربر بتواند خودش چک کند */
  excerpt: string;
};

export type AuditResult = {
  dialect: Dialect;
  findings: Finding[];
  lineCount: number;
  counts: Record<Severity, number>;
};

export type Rule = {
  id: string;
  severity: Severity;
  dialect: Dialect;
  /** خطوط را می‌گیرد (بدون کامنت و رشته) و شمارهٔ خطوط مشکوک را برمی‌گرداند */
  run: (ctx: RuleContext) => number[];
};

export type RuleContext = {
  /**
   * ساختار برنامه: بلوک‌ها، دستورها، فراخوانی‌ها و انتساب‌ها.
   *
   * قاعده‌هایی که از اینجا استفاده می‌کنند می‌توانند بپرسند «این
   * فراخوانی داخل کدام تابع است» و «این آرگومان از کجا آمده» — چیزی
   * که با has/find ممکن نبود. قاعده‌های قدیمی دست‌نخورده کار می‌کنند.
   */
  program: Program;
  /** کد با کامنت‌ها و محتوای رشته‌ها پاک‌شده، ولی با همان تعداد خط */
  masked: string;
  /** همان، خط‌به‌خط */
  lines: string[];
  /** خطوط اصلی، برای نمایش به کاربر */
  raw: string[];
  /** آیا این الگو جایی در کل فایل هست */
  has: (re: RegExp) => boolean;
  /**
   * همان، ولی روی منبع اصلی و دست‌نخورده.
   *
   * لازم است چون بعضی چیزهای معنادار عمداً داخل کامنت زندگی می‌کنند:
   * `//@version=6` در Pine و `#property` در MQL. اگر این‌ها را روی نسخهٔ
   * ماسک‌شده بگردی، همیشه «پیدا نشد» می‌گیری و به کاربر هشدار غلط می‌دهی.
   */
  hasRaw: (re: RegExp) => boolean;
  /** شمارهٔ همهٔ خطوطی که با الگو می‌خوانند */
  find: (re: RegExp) => number[];
};
