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

  /* ── دستهٔ ۱: محدودیت بروکر، پیمایش، زمان، هندل ────────────────── */
  {
    name: 'the step is handled but min/max is not',
    must: ['lot-min-max-unclamped'], never: ['lot-not-normalised'],
    src: `
double Lot(double want){
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   return MathFloor(want/step)*step;
}
void OnTick(){ double l = Lot(0.37); OrderSend(_Symbol,OP_BUY,l,Ask,3,0,0); }`,
  },
  {
    name: 'step, min and max all handled — must stay silent',
    must: [], never: ['lot-min-max-unclamped', 'lot-not-normalised'],
    src: `
double Lot(double want){
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lo   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double hi   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   return MathMin(hi, MathMax(lo, MathFloor(want/step)*step));
}
void OnTick(){ double l = Lot(0.37); OrderSend(_Symbol,OP_BUY,l,Ask,3,0,0); }`,
  },
  {
    name: 'closing without ever reading the freeze level',
    must: ['freeze-level'], never: [],
    src: `void Close(){ OrderClose(OrderTicket(), OrderLots(), Bid, 3); }`,
  },
  {
    name: 'stops level alone does not silence the freeze-level rule',
    must: ['freeze-level'], never: [],
    src: `
void Close(){
   int lvl = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   OrderClose(OrderTicket(), OrderLots(), Bid, 3);
}`,
  },
  {
    name: 'freeze level is read — silent',
    must: [], never: ['freeze-level'],
    src: `
void Close(){
   int fz = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   if(MathAbs(Bid-OrderStopLoss()) > fz*_Point) OrderClose(OrderTicket(), OrderLots(), Bid, 3);
}`,
  },
  {
    name: 'margin is never checked before sending',
    must: ['margin-not-checked'], never: [],
    src: `void OnTick(){ OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0); }`,
  },
  {
    name: 'margin is checked with OrderCalcMargin — silent',
    must: [], never: ['margin-not-checked'],
    src: `
void OnTick(){
   double need; OrderCalcMargin(ORDER_TYPE_BUY,_Symbol,0.1,Ask,need);
   if(need < AccountInfoDouble(ACCOUNT_MARGIN_FREE)) OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0);
}`,
  },
  {
    name: 'market order sent with zero slippage',
    must: ['slippage-zero'], never: [],
    src: `void OnTick(){ OrderSend(_Symbol,OP_BUY,0.1,Ask,0,0,0); }`,
  },
  {
    name: 'MQL5 send never compares the filled volume',
    must: ['partial-fill-unhandled'], never: [],
    src: `
void OnTick(){
   MqlTradeRequest req; MqlTradeResult res;
   OrderSend(req, res);
   if(res.retcode != TRADE_RETCODE_DONE) Print("fail");
}`,
  },
  {
    name: 'filled volume is compared — silent',
    must: [], never: ['partial-fill-unhandled'],
    src: `
void OnTick(){
   MqlTradeRequest req; MqlTradeResult res;
   OrderSend(req, res);
   if(res.volume < req.volume) Print("partial fill: ", res.volume);
}`,
  },
  {
    name: 'retcode is inspected but requotes are not separated',
    must: ['requote-unhandled'], never: [],
    src: `
void OnTick(){
   MqlTradeRequest req; MqlTradeResult res;
   if(!OrderSend(req,res)) Print(res.retcode);
   if(res.volume < req.volume) Print("partial");
}`,
  },
  {
    name: 'requote is handled — silent',
    must: [], never: ['requote-unhandled'],
    src: `
void OnTick(){
   MqlTradeRequest req; MqlTradeResult res;
   if(!OrderSend(req,res)){
      if(res.retcode == TRADE_RETCODE_REQUOTE) Print("retry");
      else Print(res.retcode);
   }
   if(res.volume < req.volume) Print("partial");
}`,
  },
  {
    name: 'every order goes out with no stop loss and none is set later',
    must: ['no-sl-at-all'], never: [],
    src: `void OnTick(){ OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0); }`,
  },
  {
    name: 'a stop loss is passed — silent',
    must: [], never: ['no-sl-at-all'],
    src: `void OnTick(){ double sl = Ask - 300*_Point; OrderSend(_Symbol,OP_BUY,0.1,Ask,3,sl,0); }`,
  },
  {
    name: 'closing inside a loop that counts upward',
    must: ['loop-forward-while-closing'], never: [],
    src: `
void CloseAll(){
   for(int i = 0; i < OrdersTotal(); i++){
      if(OrderSelect(i, SELECT_BY_POS) && OrderMagicNumber()==777)
         OrderClose(OrderTicket(), OrderLots(), Bid, 3);
   }
}`,
  },
  {
    name: 'the same loop counting down — silent',
    must: [], never: ['loop-forward-while-closing'],
    src: `
void CloseAll(){
   for(int i = OrdersTotal()-1; i >= 0; i--){
      if(OrderSelect(i, SELECT_BY_POS) && OrderMagicNumber()==777)
         OrderClose(OrderTicket(), OrderLots(), Bid, 3);
   }
}`,
  },
  {
    name: 'history is read without HistorySelect',
    must: ['history-select-missing'], never: [],
    src: `
void Report(){
   for(int i=0; i<HistoryDealsTotal(); i++){ ulong t = HistoryDealGetTicket(i); Print(t); }
}`,
  },
  {
    name: 'HistorySelect is called first — silent',
    must: [], never: ['history-select-missing'],
    src: `
void Report(){
   if(!HistorySelect(0, TimeCurrent())) return;
   for(int i=0; i<HistoryDealsTotal(); i++){ ulong t = HistoryDealGetTicket(i); Print(t); }
}`,
  },
  {
    name: 'HistoryDealSelect clears the list mid-loop',
    must: ['history-select-clobbered'], never: [],
    src: `
void Report(){
   HistorySelect(0, TimeCurrent());
   for(int i=0; i<HistoryDealsTotal(); i++){
      if(HistoryDealSelect(i)) Print(HistoryDealGetDouble(i, DEAL_PROFIT));
   }
}`,
  },
  {
    name: 'trading gated on the local clock',
    must: ['local-time-for-trading'], never: [],
    src: `
void OnTick(){
   MqlDateTime dt; TimeToStruct(TimeLocal(), dt);
   if(dt.hour == 9) OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0);
}`,
  },
  {
    name: 'trading gated on server time — silent',
    must: [], never: ['local-time-for-trading'],
    src: `
void OnTick(){
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   if(dt.hour == 9) OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0);
}`,
  },
  {
    name: 'CopyBuffer result thrown away',
    must: ['copybuffer-return-ignored'], never: [],
    src: `
void OnTick(){
   double buf[]; ArraySetAsSeries(buf, true);
   CopyBuffer(h, 0, 0, 3, buf);
   if(buf[0] > buf[1]) Print("up");
}`,
  },
  {
    name: 'CopyBuffer guarded on the count — silent',
    must: [], never: ['copybuffer-return-ignored'],
    src: `
void OnTick(){
   double buf[]; ArraySetAsSeries(buf, true);
   if(CopyBuffer(h, 0, 0, 3, buf) != 3) return;
   if(buf[0] > buf[1]) Print("up");
}`,
  },
  {
    name: 'copied array is never set as a series',
    must: ['arraysetasseries-missing'], never: [],
    src: `
void OnTick(){
   double buf[];
   if(CopyBuffer(h, 0, 0, 3, buf) != 3) return;
   if(buf[0] > buf[1]) Print("up");
}`,
  },
  {
    name: 'the series flag is set on a fixed-size array',
    must: ['arraysetasseries-on-static'], never: [],
    src: `
void OnTick(){
   double buf[10];
   ArraySetAsSeries(buf, true);
   if(CopyBuffer(h, 0, 0, 3, buf) != 3) return;
}`,
  },
  {
    name: 'RefreshRates left behind in an MQL5 port',
    must: ['refreshrates-in-mql5'], never: [],
    src: `
void OnTick(){
   MqlTradeRequest req; MqlTradeResult res;
   Sleep(100);
   RefreshRates();
   OrderSend(req, res);
}`,
  },
  {
    name: 'RefreshRates in genuine MQL4 — silent',
    must: [], never: ['refreshrates-in-mql5'],
    src: `
void OnTick(){
   Sleep(100);
   RefreshRates();
   OrderSend(Symbol(), OP_BUY, 0.1, Ask, 3, 0, 0);
}`,
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

  // ⚠️ یک تستِ «باید ساکت بماند» روی کدی که زبانش تشخیص داده نشده، هیچ
  // چیزی را ثابت نمی‌کند: هیچ قاعده‌ای اجرا نشده، پس سکوت بی‌معنی است و
  // تست الکی سبز می‌شود. این دقیقاً یک‌بار اتفاق افتاد و قاعدهٔ خرابی را
  // پشت یک PASS پنهان کرد.
  if (r.dialect === 'unknown' && (c.must.length || c.never.length)) {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${c.name}`);
    console.log('          dialect came back "unknown" — no rule ran, so this proves nothing');
    continue;
  }
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
