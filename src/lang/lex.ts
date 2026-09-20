import type { Dialect } from '../types';

/**
 * توکنایزر MQL و Pine.
 *
 * چرا از regex جدا شد: تحلیل‌گر قبلی کامنت‌ها و رشته‌ها را ماسک می‌کرد و
 * بعد روی متن regex می‌زد. برای «آیا این کلمه جایی در فایل هست؟» کافی
 * بود، ولی نمی‌توانست بگوید این فراخوانی داخل کدام تابع است، مقدار
 * برگشتی‌اش مصرف شده یا نه، و آرگومان سومش از کجا آمده. سه‌تای اینها
 * دقیقاً همان چیزهایی‌اند که تفاوت یک هشدار درست و یک هشدار الکی را
 * می‌سازند.
 *
 * عمداً tree-sitter نیست. یک گرامر WASM برای MQL وجود ندارد (باید
 * می‌نوشتیمش)، برای Pine هم همین‌طور، و هر کدامشان یک تا دو مگابایت به
 * صفحه‌ای اضافه می‌کرد که کل استدلالش این است که همه‌چیز داخل مرورگر
 * خودت اجرا می‌شود. این فایل چند کیلوبایت است و همان کاری را می‌کند که
 * قاعده‌ها لازم دارند.
 */

export type TokKind = 'id' | 'num' | 'str' | 'op' | 'nl' | 'pre';

export type Tok = {
  kind: TokKind;
  text: string;
  /** شمارهٔ خط، از ۱ */
  line: number;
};

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * عملگرهای چندنویسه‌ای، گروه‌بندی‌شده با نویسهٔ اول.
 *
 * نسخهٔ اول یک آرایهٔ صاف بود و برای هر عملگرِ تک‌نویسه‌ای هم کل
 * فهرست را می‌گشت. روی ۴۷ هزار توکن همین یک خط، بخش بزرگی از زمان
 * توکن‌سازی بود.
 */
const MULTI_BY_HEAD = new Map<string, string[]>();
for (const op of [
  '>>=', '<<=', '...', '||=', '&&=',
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '->', '::', '<<', '>>', ':=', '=>',
]) {
  const list = MULTI_BY_HEAD.get(op[0]);
  if (list) list.push(op);
  else MULTI_BY_HEAD.set(op[0], [op]);
}
// بلندها اول، تا «>>=» پیش از «>>» امتحان شود
for (const list of MULTI_BY_HEAD.values()) list.sort((a, b) => b.length - a.length);

/**
 * تقسیم منبع به توکن، با حفظ شمارهٔ خط.
 *
 * کامنت‌ها دور ریخته می‌شوند ولی خطِ شکسته‌شان حساب می‌شود، تا شمارهٔ
 * خطی که به کاربر نشان می‌دهیم با فایل خودش بخواند. یک اشتباه در همین
 * حساب یعنی یافته‌ای که به خط غلط اشاره می‌کند، و آن بدتر از نگفتن است.
 */
export function lex(src: string, dialect: Dialect): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const pine = dialect === 'pine';

  const push = (kind: TokKind, text: string, ln = line) => out.push({ kind, text, line: ln });

  while (i < n) {
    const c = src[i];

    // ------------------------------------------------------------ newline
    if (c === '\n') {
      line++;
      i++;
      // در Pine پایان خط یک مرز واقعی است؛ در MQL نویز است
      if (pine && out.length && out[out.length - 1].kind !== 'nl') push('nl', '\n', line - 1);
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    // ----------------------------------------------------------- comments
    if (c === '/' && src[i + 1] === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      // ‏//@version=6 در Pine و //+---+ در MQL داخل کامنت زندگی می‌کنند و
      // معنادارند. به‌عنوان توکن «pre» نگه‌شان می‌داریم تا قاعده‌ها
      // بتوانند ببینندشان بدون اینکه در جریان عادی توکن‌ها قاطی شوند.
      const text = src.slice(start, i);
      if (/^\/\/\s*@/.test(text)) push('pre', text);
      continue;
    }
    if (!pine && c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // ------------------------------------------------------ preprocessor
    if (!pine && c === '#') {
      const start = i;
      const ln = line;
      while (i < n && src[i] !== '\n') i++;
      push('pre', src.slice(start, i), ln);
      continue;
    }

    // ------------------------------------------------------------ strings
    if (c === '"' || c === "'") {
      const quote = c;
      const ln = line;
      const start = i;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') line++;
        i++;
      }
      i++;
      push('str', src.slice(start, Math.min(i, n)), ln);
      continue;
    }

    // ------------------------------------------------------------ numbers
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1] ?? ''))) {
      const start = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
      } else {
        while (i < n && /[0-9._]/.test(src[i])) i++;
        if (i < n && /[eE]/.test(src[i])) {
          i++;
          if (i < n && /[+-]/.test(src[i])) i++;
          while (i < n && DIGIT.test(src[i])) i++;
        }
      }
      while (i < n && /[fFuUlL]/.test(src[i])) i++;
      push('num', src.slice(start, i));
      continue;
    }

    // -------------------------------------------------------- identifiers
    if (ID_START.test(c)) {
      const start = i;
      while (i < n && ID_PART.test(src[i])) i++;
      push('id', src.slice(start, i));
      continue;
    }

    // ---------------------------------------------------------- operators
    const candidates = MULTI_BY_HEAD.get(c);
    if (candidates) {
      const multi = candidates.find((m) => src.startsWith(m, i));
      if (multi) {
        push('op', multi);
        i += multi.length;
        continue;
      }
    }
    push('op', c);
    i++;
  }

  return out;
}
