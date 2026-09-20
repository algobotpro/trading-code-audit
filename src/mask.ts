/**
 * کامنت‌ها و محتوای رشته‌ها را با فاصله پر می‌کند و طول و شمارهٔ خط را
 * دست‌نخورده نگه می‌دارد.
 *
 * چرا لازم است: بدون این، قاعده‌ای که دنبال `OrderSend(` می‌گردد داخل
 * یک کامنت هم پیدایش می‌کند و به کاربر یافتهٔ غلط نشان می‌دهیم. یک
 * ابزار تحلیل که هشدار الکی می‌دهد، بدتر از نبودنش است — طرف یک بار
 * امتحان می‌کند و دیگر برنمی‌گردد.
 */
export function maskCommentsAndStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // کامنت خطی: // ... تا آخر خط
    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }

    // کامنت بلوکی: /* ... */
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }

    // رشته: " ... " یا ' ... '  (با احترام به \" )
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }

    i++;
  }

  return out.join('');
}
