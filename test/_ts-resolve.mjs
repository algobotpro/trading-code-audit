/**
 * حل‌کنندهٔ مسیر برای اجرای مستقیم TypeScript با node.
 *
 * ‏Next با Turbopack پسوند را خودش پیدا می‌کند؛ node نه. بدون این،
 * `import './rules'` از داخل audit-check کار نمی‌کند و تنها راه دیگر،
 * نوشتن پسوند `.ts` داخل خودِ سورس بود — که یعنی تغییر کد برنامه برای
 * راحتی تست. این فایل همان کار را بیرون از سورس انجام می‌دهد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) {
    base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  }
  if (base && !/\.(ts|tsx|mjs|js|json)$/.test(base)) {
    for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (fs.existsSync(c)) return next(pathToFileURL(c).href, ctx);
    }
  }
  return next(spec, ctx);
}
