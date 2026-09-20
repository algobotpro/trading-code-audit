import type { Dialect } from '../types';
import { lex, type Tok } from './lex';

/**
 * ساختار برنامه، از روی توکن‌ها.
 *
 * این لایه چیزی است که regex هیچ‌وقت نمی‌توانست بدهد: اینکه یک فراخوانی
 * داخل کدام تابع و کدام حلقه است، مقدار برگشتی‌اش مصرف شده یا نه، و
 * آرگومانی که به آن داده شده از کجا آمده.
 *
 * پارسر کامل نیست و قرار هم نیست باشد. AST درخت‌عبارت نمی‌سازد، چون
 * هیچ‌کدام از قاعده‌ها به آن نیاز ندارند. چیزی که لازم دارند این است:
 * مرز بلوک‌ها، مرز دستورها، محل فراخوانی‌ها با آرگومان‌هایشان، و
 * زنجیرهٔ انتساب‌ها. همین چهارتا.
 */

export type BlockKind = 'root' | 'function' | 'loop' | 'branch' | 'block';

export type Block = {
  kind: BlockKind;
  /** برای تابع: نامش. برای بقیه undefined. */
  name?: string;
  /** بازهٔ توکن بدنه، بدون خود آکولادها: [from, to) */
  from: number;
  to: number;
  line: number;
  parent: Block | null;
  children: Block[];
};

export type Stmt = {
  from: number;
  to: number;
  line: number;
  block: Block;
};

export type Call = {
  name: string;
  /** نام‌های کامل مثل trade.Buy یا OrderInfo.Volume */
  qualified: string;
  /** اندیس توکن نام */
  at: number;
  /** اندیس «(» و «)» */
  open: number;
  close: number;
  args: { from: number; to: number }[];
  line: number;
  block: Block;
  stmt: Stmt | null;
  /**
   * آیا مقدار برگشتی جایی مصرف شده.
   *
   * تعریف عملیاتی: فراخوانی **مصرف‌نشده** است اگر خودش تمام دستور باشد —
   * یعنی دستور با همین نام شروع شود و بلافاصله بعد از «)» تمام شود.
   * هر چیز دیگری (انتساب، داخل if، مقایسه، آرگومانِ یک فراخوانی دیگر)
   * یعنی یک‌جایی نگاهش کرده‌اند.
   */
  resultUsed: boolean;
};

export type Assign = {
  /** نام متغیری که مقدار می‌گیرد */
  target: string;
  /**
   * همان با پیشوندش: `request.volume` نه فقط `volume`.
   *
   * ‏MQL5 سفارش را در یک struct پر می‌کند و بعد `OrderSend(request,result)`
   * صدا می‌زند. بدون این، ردِ حجم از `request` به جایی که مقدارش
   * ساخته شده قطع می‌شد و هر اکسپرت MQL5ای هشدار الکی می‌گرفت.
   */
  qualifiedTarget: string;
  /** بازهٔ توکن سمت راست */
  from: number;
  to: number;
  line: number;
  block: Block;
};

export type Program = {
  dialect: Dialect;
  toks: Tok[];
  root: Block;
  blocks: Block[];
  stmts: Stmt[];
  calls: Call[];
  assigns: Assign[];
  /**
   * فهرست‌های آماده، برای اینکه provenance مجبور نباشد هر بار کل
   * فایل را بگردد. بدون اینها ردگیری روی یک فایل بزرگ درجه‌دو می‌شد.
   */
  assignsByName: Map<string, Assign[]>;
  functionsByName: Map<string, Block>;
};

const CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'catch']);
const LOOP = new Set(['for', 'while', 'do']);
/** کلماتی که شبیه فراخوانی‌اند ولی نیستند */
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'do', 'else',
]);
/**
 * شناسه‌هایی که پیش از یک فراخوانی می‌آیند ولی «نوع» نیستند.
 *
 * `return Foo(x);` و `else Bar();` هر دو شکل ظاهریِ یک اعلان دارند —
 * شناسه، بعد نام، بعد پرانتز — و بدون این فهرست، هر دو از قلم می‌افتادند.
 */
const DECL_EXEMPT = new Set(['return', 'else', 'new', 'delete', 'case', 'default', 'do']);

const isOp = (t: Tok | undefined, s: string) => !!t && t.kind === 'op' && t.text === s;

/**
 * جفتِ هر پرانتز و آکولاد را از قبل پیدا می‌کنیم.
 *
 * یک‌بار حساب‌کردن به‌جای اینکه هر قاعده خودش جلو برود: با این کار
 * هزینهٔ کل تحلیل خطی می‌ماند، که چیزی است که به کاربر وعده داده‌ایم
 * («یک پروژهٔ چهارهزار خطی در چند میلی‌ثانیه»).
 */
function matchPairs(toks: Tok[]): Map<number, number> {
  const pair = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== 'op') continue;
    if (t.text === '(' || t.text === '{' || t.text === '[') stack.push(i);
    else if (t.text === ')' || t.text === '}' || t.text === ']') {
      const open = stack.pop();
      if (open === undefined) continue;
      const want = { ')': '(', '}': '{', ']': '[' }[t.text];
      if (toks[open].text !== want) continue;
      pair.set(open, i);
      pair.set(i, open);
    }
  }
  return pair;
}

export function analyse(source: string, dialect: Dialect): Program {
  const toks = lex(source, dialect);
  const pair = matchPairs(toks);

  const root: Block = {
    kind: 'root',
    from: 0,
    to: toks.length,
    line: 1,
    parent: null,
    children: [],
  };
  const blocks: Block[] = [root];
  const stmts: Stmt[] = [];
  const calls: Call[] = [];
  const assigns: Assign[] = [];

  /**
   * یک بلوک را می‌خواند و بلوک‌های تودرتویش را می‌سازد.
   *
   * بازگشتی است ولی عمقش با عمق تودرتویی کد محدود می‌شود، نه با طولش —
   * پس روی فایل بزرگ هم ته پشته نمی‌رسد.
   */
  function scan(block: Block) {
    let i = block.from;
    let stmtStart = i;
    /**
     * کلمهٔ کنترلیِ سرِ بلوکی که همین الان بسته شد.
     *
     * لازم است چون بعد از «)» یک دستور تازه شروع می‌کنیم تا `OrderClose`
     * در `if(sel) OrderClose(...);` دستور خودش باشد و بشود فهمید مقدار
     * برگشتی‌اش دور ریخته شده. ولی همین کار سرِ بلوک را هم از دست
     * می‌داد و `for(...){ }` به‌جای حلقه، «بلوک ساده» می‌شد.
     */
    let headKw: string | null = null;

    const closeStmt = (end: number) => {
      if (end > stmtStart) {
        stmts.push({ from: stmtStart, to: end, line: toks[stmtStart].line, block });
      }
      stmtStart = end + 1;
    };

    while (i < block.to) {
      const t = toks[i];

      // پرانتز و براکت را یکجا رد می‌کنیم: «;»های داخل سرِ for نباید
      // دستور را بشکنند، و کامای داخل آرگومان‌ها هم همین‌طور.
      if (t.kind === 'op' && (t.text === '(' || t.text === '[')) {
        const end = pair.get(i);
        if (end === undefined || end >= block.to) {
          i++;
          continue;
        }
        const head = toks.slice(stmtStart, i);
        const kw = head.find((h) => h.kind === 'id' && CONTROL.has(h.text));
        i = end + 1;
        // سرِ یک ساختار کنترلی تمام شد → اینجا مرز دستور است
        if (kw && t.text === '(' && !isOp(toks[i], '{')) {
          // closeStmt(x) یعنی «دستور تا x تمام شد، بعدی از x+1» — پس
          // اینجا باید خودِ «)» را بدهیم، نه توکن بعدش. با end+1 اولین
          // توکنِ بدنهٔ بدون‌آکولاد از دستور بعدی می‌افتاد بیرون و
          // `if(ok) OrderClose(...)` طوری خوانده می‌شد که انگار مقدار
          // برگشتیِ OrderClose مصرف شده.
          closeStmt(end);
          headKw = kw.text;
        } else if (kw && t.text === '(') {
          headKw = kw.text;
        }
        continue;
      }

      if (t.kind === 'op' && t.text === ';') {
        closeStmt(i);
        headKw = null;
        i++;
        continue;
      }

      if (t.kind === 'op' && t.text === '{') {
        const end = pair.get(i);
        if (end === undefined || end > block.to) {
          i++;
          continue;
        }
        const head = toks.slice(stmtStart, i);
        const kw = headKw ?? head.find((h) => h.kind === 'id' && CONTROL.has(h.text))?.text ?? null;
        let kind: BlockKind = 'block';
        let name: string | undefined;

        if (kw && LOOP.has(kw)) kind = 'loop';
        else if (kw) kind = 'branch';
        else {
          // بدون کلمهٔ کنترلی، و سرش به «)» ختم می‌شود → تعریف تابع.
          // نام، شناسه‌ای است که درست قبل از «(» متناظر می‌آید.
          const lastParen = head.length && head[head.length - 1].text === ')' ? head.length - 1 : -1;
          if (lastParen > 0) {
            let depth = 0;
            let k = lastParen;
            for (; k >= 0; k--) {
              if (head[k].text === ')') depth++;
              else if (head[k].text === '(') {
                depth--;
                if (depth === 0) break;
              }
            }
            const nameTok = k > 0 ? head[k - 1] : undefined;
            if (nameTok && nameTok.kind === 'id') {
              kind = 'function';
              name = nameTok.text;
            }
          }
        }

        const child: Block = {
          kind,
          name,
          from: i + 1,
          to: end,
          line: t.line,
          parent: block,
          children: [],
        };
        block.children.push(child);
        blocks.push(child);
        scan(child);

        stmtStart = end + 1;
        headKw = null;
        i = end + 1;
        continue;
      }

      if (t.kind === 'op' && t.text === '}') {
        i++;
        continue;
      }

      if (dialect === 'pine' && t.kind === 'nl') {
        closeStmt(i);
        headKw = null;
        i++;
        continue;
      }

      i++;
    }
    closeStmt(block.to);
  }

  scan(root);

  // ---------------------------------------------------------------- calls
  /**
   * نگاشت توکن → بلوک و توکن → دستور، یک‌بار و از پیش.
   *
   * نسخهٔ اول برای هر فراخوانی کل فهرست بلوک‌ها و دستورها را می‌گشت.
   * درست بود ولی درجه‌دو: روی یک فایل ۶۰۰۰ خطی ۹۳ میلی‌ثانیه طول
   * می‌کشید. چون تحلیل با هر کلید فشرده‌شده دوباره اجرا می‌شود، همین
   * عدد روی یک paste بزرگ حس می‌شود. حالا دو آرایه‌ای که در همان یک
   * گذر پر می‌شوند، جست‌وجو را ثابت می‌کنند.
   *
   * ترتیب پرکردن اهمیت دارد: بلوک‌های تودرتو بعد از والدشان نوشته
   * می‌شوند، پس نوشتهٔ آخر همان عمیق‌ترین است.
   */
  const blockIx = new Int32Array(toks.length).fill(0);
  const stmtIx = new Int32Array(toks.length).fill(-1);
  // ⚠️ اندیس را از قبل برمی‌داریم. نسخهٔ اول داخل همین حلقه
  // `blocks.indexOf(b)` صدا می‌زد — یعنی روی ۲۴۰۰ بلوک، ۵٫۸ میلیون
  // مقایسه، که تنهایی نیمی از زمان کل تحلیل بود.
  const idOf = new Map<Block, number>();
  blocks.forEach((b, i) => idOf.set(b, i));
  const byDepth = [...blocks].sort((a, b) => b.to - b.from - (a.to - a.from));
  for (const b of byDepth) {
    const id = idOf.get(b) ?? 0;
    for (let i = b.from; i < b.to; i++) blockIx[i] = id;
  }
  const bySize = [...stmts]
    .map((s, i) => [s, i] as const)
    .sort((a, b) => b[0].to - b[0].from - (a[0].to - a[0].from));
  for (const [s, id] of bySize) {
    for (let i = s.from; i < s.to; i++) stmtIx[i] = id;
  }
  const blockAt = (i: number): Block => blocks[blockIx[i] ?? 0] ?? root;
  const stmtAt = (i: number): Stmt | null => (stmtIx[i] >= 0 ? stmts[stmtIx[i]] : null);

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== 'id' || NOT_A_CALL.has(t.text)) continue;
    if (!isOp(toks[i + 1], '(')) continue;
    const close = pair.get(i + 1);
    if (close === undefined) continue;

    // `void OnTick() {` و `double LotFor(double r);` فراخوانی نیستند.
    // بدون این، هر تابعی یک‌بار به‌عنوان «فراخوانیِ مقدارِ دورریخته»
    // شمرده می‌شد و قاعدهٔ return-ignored روی تعریف خودش هشدار می‌داد.
    if (isOp(toks[close + 1], '{')) continue;
    const prev = toks[i - 1];
    const stmtHere = stmtAt(i);
    if (
      prev &&
      prev.kind === 'id' &&
      !NOT_A_CALL.has(prev.text) &&
      !DECL_EXEMPT.has(prev.text) &&
      stmtHere &&
      stmtHere.from === i - 1
    ) {
      continue;
    }

    // نام کامل: person.method یا Class::method
    let qualified = t.text;
    let k = i - 1;
    while (k >= 1 && toks[k].kind === 'op' && (toks[k].text === '.' || toks[k].text === '::')) {
      if (toks[k - 1]?.kind !== 'id') break;
      qualified = toks[k - 1].text + toks[k].text + qualified;
      k -= 2;
    }

    // آرگومان‌ها: کاما در عمق صفر
    const args: { from: number; to: number }[] = [];
    let depth = 0;
    let argStart = i + 2;
    for (let j = i + 2; j < close; j++) {
      const s = toks[j];
      if (s.kind === 'op') {
        if (s.text === '(' || s.text === '[' || s.text === '{') depth++;
        else if (s.text === ')' || s.text === ']' || s.text === '}') depth--;
        else if (s.text === ',' && depth === 0) {
          args.push({ from: argStart, to: j });
          argStart = j + 1;
        }
      }
    }
    if (close > i + 2) args.push({ from: argStart, to: close });

    const stmt = stmtAt(i);
    // «تمام دستور همین فراخوانی است» → مقدار برگشتی دور ریخته شده
    const startsStmt = !!stmt && (stmt.from === i || stmt.from === k + 1);
    const endsStmt = !!stmt && close >= stmt.to - 1;
    calls.push({
      name: t.text,
      qualified,
      at: i,
      open: i + 1,
      close,
      args,
      line: t.line,
      block: blockAt(i),
      stmt,
      resultUsed: !(startsStmt && endsStmt),
    });
  }

  // ----------------------------------------------------------- assignments
  for (const s of stmts) {
    let depth = 0;
    for (let j = s.from; j < s.to; j++) {
      const t = toks[j];
      if (t.kind !== 'op') continue;
      if (t.text === '(' || t.text === '[') depth++;
      else if (t.text === ')' || t.text === ']') depth--;
      else if (depth === 0 && (t.text === '=' || t.text === ':=' || t.text === '+=' || t.text === '-=' || t.text === '*=' || t.text === '/=')) {
        // هدف: آخرین شناسه پیش از «=» (نوع و کلمات کلیدی را رد می‌کند)
        let k = j - 1;
        while (k > s.from && toks[k].kind === 'op' && toks[k].text === ']') {
          const open = pair.get(k);
          k = open === undefined ? k - 1 : open - 1;
        }
        const target = toks[k];
        if (target && target.kind === 'id') {
          let qualifiedTarget = target.text;
          let q = k - 1;
          while (q >= 1 && toks[q].kind === 'op' && (toks[q].text === '.' || toks[q].text === '::')) {
            if (toks[q - 1]?.kind !== 'id') break;
            qualifiedTarget = toks[q - 1].text + toks[q].text + qualifiedTarget;
            q -= 2;
          }
          assigns.push({
            target: target.text,
            qualifiedTarget,
            from: j + 1,
            to: s.to,
            line: target.line,
            block: s.block,
          });
        }
        break;
      }
    }
  }

  const assignsByName = new Map<string, Assign[]>();
  for (const a of assigns) {
    for (const key of a.target === a.qualifiedTarget
      ? [a.target]
      : [a.target, a.qualifiedTarget.split(/[.:]+/)[0]]) {
      const list = assignsByName.get(key);
      if (list) list.push(a);
      else assignsByName.set(key, [a]);
    }
  }
  const functionsByName = new Map<string, Block>();
  for (const b of blocks) if (b.kind === 'function' && b.name && !functionsByName.has(b.name)) {
    functionsByName.set(b.name, b);
  }

  return { dialect, toks, root, blocks, stmts, calls, assigns, assignsByName, functionsByName };
}

/** نزدیک‌ترین تابعِ در بر گیرنده */
export function enclosingFunction(b: Block): Block | null {
  let cur: Block | null = b;
  while (cur) {
    if (cur.kind === 'function') return cur;
    cur = cur.parent;
  }
  return null;
}

/** آیا این بلوک داخل یک حلقه است (خودش یا هر جدّش) */
export function insideLoop(b: Block): boolean {
  let cur: Block | null = b;
  while (cur) {
    if (cur.kind === 'loop') return true;
    if (cur.kind === 'function') return false;
    cur = cur.parent;
  }
  return false;
}

/** متن خام یک بازهٔ توکن — برای تطبیق الگوهای ساده روی همان بازه */
export function textOf(p: Program, from: number, to: number): string {
  return p.toks.slice(from, to).map((t) => t.text).join(' ');
}


/**
 * از کجا آمده: ردِ یک عبارت تا هر جایی که مقدارش ساخته شده.
 *
 * این تفاوت اصلی با نسخهٔ regex است. سؤال قبلی «آیا کلمهٔ
 * SYMBOL_VOLUME_STEP جایی در این فایل هست؟» بود — که روی یک فایل کوتاه
 * جواب درستی می‌داد و روی یک پروژهٔ چهارهزار خطی تقریباً همیشه «بله»
 * بود، حتی وقتی حجمی که به همین OrderSend داده شده هیچ‌وقت نرمال نشده
 * بود. سؤال تازه این است: «آیا مقداری که به **این** آرگومان رسیده، از
 * مسیری آمده که گام حجم را خوانده باشد؟»
 *
 * دنباله‌روی سه چیز را پوشش می‌دهد:
 *   ۱. انتساب به همان نام  (`lot = ...`)
 *   ۲. انتساب به عضوی از همان شیء (`request.volume = ...`)
 *   ۳. بدنهٔ تابع‌های خودِ کاربر که در مسیر صدا زده شده‌اند
 *
 * عمداً محافظه‌کار است: **همهٔ** انتساب‌ها به آن نام را می‌گیرد، نه فقط
 * آن‌هایی که قبل از این نقطه‌اند. یعنی ممکن است چیزی را ببخشد که نباید،
 * ولی چیزی را که درست است متهم نمی‌کند. روی ابزاری که قرار است اعتبار
 * ما را نشان دهد، این معامله درستی است.
 */
export function provenance(
  p: Program,
  span: { from: number; to: number },
  maxDepth = 3,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  /** سقف کار، تا یک فایل بدشکل مرورگر را قفل نکند */
  let budget = 4000;

  const walk = (s: { from: number; to: number }, depth: number) => {
    if (depth > maxDepth || budget <= 0) return;
    budget -= s.to - s.from;
    out.push(textOf(p, s.from, s.to));

    for (let i = s.from; i < s.to && budget > 0; i++) {
      const t = p.toks[i];
      if (t.kind !== 'id') continue;
      if (seen.has(t.text)) continue;
      seen.add(t.text);

      for (const a of p.assignsByName.get(t.text) ?? []) walk({ from: a.from, to: a.to }, depth + 1);
      const body = p.functionsByName.get(t.text);
      if (body) walk({ from: body.from, to: body.to }, depth + 1);
    }
  };

  walk(span, 0);
  return out.join(' ; ');
}
