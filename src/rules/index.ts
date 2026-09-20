import type { Rule } from '../types';
import { mqlBroker } from './mql-broker';
import { mqlCore } from './mql-core';
import { pineRules } from './pine';

/**
 * همهٔ قاعده‌ها، در یک آرایه.
 *
 * چرا پوشه و نه یک فایل: نقشه ۱۰۱ قاعده دارد (`docs/RULES-ROADMAP.md`).
 * در یک فایل، پیداکردن قاعده‌ای که باید عوض شود خودش کار می‌شود، و diff
 * هر تغییر کوچک صدها خط می‌شود.
 *
 * ترتیب اهمیتی ندارد — `audit()` خودش یافته‌ها را بر اساس شدت و شمارهٔ
 * خط مرتب می‌کند.
 */
export const rules: Rule[] = [...mqlCore, ...mqlBroker, ...pineRules];
