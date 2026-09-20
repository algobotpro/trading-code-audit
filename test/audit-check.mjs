/**
 * تست رگرسیون تحلیل‌گر ایستا.
 *
 *     node --experimental-strip-types --no-warnings scripts/audit-check.mjs
 *
 * چرا وجود دارد: تحلیل‌گر حالا یک پارسر واقعی دارد — توکنایزر، درخت
 * بلوک، ردگیری انتساب‌ها. این یعنی یک تغییر کوچک در مرزِ دستورها
 * می‌تواند بی‌صدا نصف قاعده‌ها را خاموش کند، و کسی تا وقتی یک مشتری
 * نگوید «اکسپرت من ایراد داشت و ابزارتان چیزی نگفت» متوجه نشود.
 *
 * هر مورد پایین یا یک باگ واقعی است که باید دیده شود، یا کد سالمی که
 * نباید هشدار بگیرد. مورد دوم مهم‌تر است: یک هشدار غلط روی کدِ درستِ
 * یک برنامه‌نویس باتجربه، بیشتر از ده هشدار درست به اعتبار ما لطمه
 * می‌زند.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
register('./_ts-resolve.mjs', pathToFileURL(`${here}/`));

const { audit } = await import('../src/index.ts');

/** must: این قاعده‌ها باید بیایند — never: این‌ها نباید */
const CASES = [
  {
    name: 'a lot normalised through a helper in another function',
    must: [],
    never: ['lot-not-normalised'],
    src: `
double NormaliseLot(double want){
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   return MathFloor(want/step)*step;
}
void OnTick(){
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED)) return;
   double lot = NormaliseLot(0.37);
   int t = OrderSend(_Symbol, OP_BUY, lot, Ask, 3, 0, 0);
   if(t < 0) Print(GetLastError());
}`,
  },
  {
    name: 'the step is read somewhere else entirely, this lot is raw',
    must: ['lot-not-normalised'],
    never: [],
    src: `
void Report(){ double s = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP); Print(s); }
void OnTick(){
   double lot = AccountBalance()*0.02/1000.0;
   OrderSend(_Symbol, OP_BUY, lot, Ask, 3, 0, 0);
}`,
  },
  {
    name: 'a result dropped on the tail of an if, with no braces',
    must: ['return-ignored'],
    never: [],
    src: `
void CloseAll(){
   for(int i=OrdersTotal()-1;i>=0;i--)
      if(OrderSelect(i, SELECT_BY_POS) && OrderMagicNumber()==777)
         OrderClose(OrderTicket(), OrderLots(), Bid, 3);
}`,
  },
  {
    name: 'a loop that closes anything it finds, magic read in a different function',
    must: ['magic-filter'],
    never: [],
    src: `
int MagicOf(){ return OrderMagicNumber(); }
void CloseAll(){
   for(int i=OrdersTotal()-1;i>=0;i--){
      if(OrderSelect(i, SELECT_BY_POS)) OrderClose(OrderTicket(), OrderLots(), Bid, 3);
   }
}`,
  },
  {
    name: 'Sleep lives in OnDeinit, where it is harmless',
    must: [],
    never: ['sleep-in-ontick'],
    src: `void OnDeinit(const int reason){ Sleep(1000); }\nvoid OnTick(){ double x = Bid; }`,
  },
  {
    name: 'Sleep really is in OnTick',
    must: ['sleep-in-ontick'],
    never: [],
    src: `void OnTick(){ Sleep(250); double x = Bid; }`,
  },
  {
    name: 'stops are set from a distance that reads the broker minimum',
    must: [],
    never: ['stops-level'],
    src: `
double StopDistance(){
   double min = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   return MathMax(min, 200*_Point);
}
void OnTick(){
   double sl = Ask - StopDistance();
   int t = OrderSend(_Symbol, OP_BUY, 0.1, Ask, 3, sl, 0);
   if(t<0) Print(GetLastError());
}`,
  },
  {
    name: 'stops set from a hardcoded distance',
    must: ['stops-level'],
    never: [],
    src: `
void OnTick(){
   double sl = Ask - 150*_Point;
   int t = OrderSend(_Symbol, OP_BUY, 0.1, Ask, 3, sl, 0);
   if(t<0) Print(GetLastError());
}`,
  },
  {
    name: 'a well-written EA: class, pointers, templates, macros — must stay silent',
    must: [],
    never: ['lot-not-normalised', 'trade-allowed', 'return-ignored', 'magic-filter', 'zero-guard'],
    src: `
#define MAX_TRIES 3
input double InpRisk = 1.0;
input int    InpMagic = 20240101;
class CRiskManager {
private:
   double m_step;
public:
   double Lot(double risk){
      m_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      if(m_step <= 0.0) return 0.0;
      return MathFloor(risk/m_step)*m_step;
   }
};
CRiskManager *g_risk = NULL;
CTrade trade;
template<typename T> T Clamp(T v, T lo, T hi){ return v<lo?lo:(v>hi?hi:v); }
int OnInit(){ g_risk = new CRiskManager(); trade.SetExpertMagicNumber(InpMagic); return INIT_SUCCEEDED; }
void OnTick(){
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED)) return;
   double lot = g_risk.Lot(AccountInfoDouble(ACCOUNT_BALANCE)*InpRisk/100.0/1000.0);
   if(lot <= 0) return;
   if(!trade.Buy(lot, _Symbol, 0, 0, 0, "entry")) Print("failed ", trade.ResultRetcode());
}`,
  },
  {
    name: 'braces and semicolons inside a string must not move the block boundaries',
    must: ['lot-not-normalised'],
    never: [],
    src: `
void OnTick(){
   string msg = "if(x){ y; } // not code";
   Print(msg);
   OrderSend(_Symbol, OP_BUY, 0.1, Ask, 3, 0, 0);
}`,
  },
  {
    name: 'Pine that reads a closed higher-timeframe bar correctly',
    must: [],
    never: ['pine-lookahead-missing', 'pine-no-offset', 'pine-version'],
    src: `//@version=6
indicator("ok", overlay=true)
htf = request.security(syminfo.tickerid, "D", close[1], lookahead=barmerge.lookahead_off)
plot(htf)`,
  },
  {
    name: 'Pine that repaints',
    must: ['pine-lookahead-missing', 'pine-no-offset'],
    never: [],
    src: `indicator("bad")\nh = request.security(syminfo.tickerid, "60", close)\nplot(h)`,
  },
  { name: 'source cut off mid-edit must not throw', must: [], never: [], src: `void OnTick(){ if(a){ OrderSend(_Symbol,` },
  { name: 'empty input must not throw', must: [], never: [], src: `` },
  { name: 'comments only must not throw', must: [], never: [], src: `// nothing\n/* at all */` },
];

let failed = 0;
for (const c of CASES) {
  let r;
  try {
    r = audit(c.src);
  } catch (e) {
    console.log(`  FAIL  ${c.name}\n          threw: ${e.message}`);
    failed++;
    continue;
  }
  const got = new Set(r.findings.map((f) => f.ruleId));
  const missing = c.must.filter((id) => !got.has(id));
  const wrong = c.never.filter((id) => got.has(id));
  if (missing.length === 0 && wrong.length === 0) {
    console.log(`  \x1b[32mPASS\x1b[0m  ${c.name}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${c.name}`);
    if (missing.length) console.log(`          did not flag: ${missing.join(', ')}`);
    if (wrong.length) console.log(`          flagged wrongly: ${wrong.join(', ')}`);
    console.log(`          got: ${[...got].join(', ') || '(nothing)'}`);
  }
}

// سرعت هم بخشی از قرارداد است: تحلیل با هر کلید فشرده‌شده دوباره اجرا
// می‌شود، پس یک کندیِ خزنده مستقیماً به کندیِ تایپ تبدیل می‌شود.
let big = '#property strict\n';
for (let i = 0; i < 400; i++) {
  big += `\ndouble Calc${i}(double a,double b){ double r=0.0; for(int k=0;k<10;k++){ if(a>b){ r+=MathSqrt(a)/(b+k);} } return r; }`;
}
for (let i = 0; i < 3; i++) audit(big);
const t0 = performance.now();
audit(big);
const ms = performance.now() - t0;
const lines = big.split('\n').length;
const LIMIT = 120;
if (ms > LIMIT) {
  failed++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${lines} lines took ${ms.toFixed(0)} ms (limit ${LIMIT})`);
} else {
  console.log(`  \x1b[32mPASS\x1b[0m  ${lines} lines in ${ms.toFixed(0)} ms`);
}

console.log(`\n  ${CASES.length + 1 - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
