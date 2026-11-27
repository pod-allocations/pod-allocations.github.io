/* The phone holder hard rule (Ali, 25 Nov 2026): on every day with a day phone holder, the holder
   stands in a pod as big as the biggest of A-D, and if the holder is on a long day and any pod has
   a second long day, the holder's pod has one too. Thousands of random weeks, with checks that the
   fix never buys itself by breaking a bigger rule (long day per pod, A-D cover, E never biggest).
   RUNS=3000 node tests/phone-hard-rule-tests.js */
const path = require("path");
const P = require(path.join(__dirname, "..", "planner.js"));
const PODS = P.PODS, AD = ["A", "B", "C", "D"];
const RUNS = +process.env.RUNS || 3000;
let seed = +process.env.SEED || 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let pass = 0, fail = 0; const fails = [];
const stat = { eUnder: 0, days: 0, holderDays: 0, notFullest: 0, noSpare: 0, noLD: 0, noCover: 0, eBig: 0, pods: 0, people: 0, unmetReported: 0 };
const grades = ["FY2", "IMT", "ST", "ICM", "SCF", "ACCP", "JCF"];
for (let r = 0; r < RUNS; r++) {
  const staff = {}, n = 18 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const g = grades[Math.floor(rnd() * grades.length)], aw = ["ICM", "SCF", "ST"].includes(g) && rnd() < 0.8;
    staff["p" + i] = { id: "p" + i, name: "p" + i, grade: g, airway: aw, transfer: aw || rnd() < 0.3,
      neuro: !aw && g === "ST" && rnd() < 0.3, phone: aw && rnd() < 0.7, supernum: false, start: "2024-01-01" };
  }
  const key = P.addDays("2026-01-05", 7 * (r % 40)), roster = {};
  for (let di = 0; di < 7; di++) {
    const we = di >= 5, want = we ? 10 + Math.floor(rnd() * 2) : 11 + Math.floor(rnd() * 6), m = {};
    const ids = Object.keys(staff).sort(() => rnd() - 0.5).slice(0, want);
    ids.forEach((id, k) => { m[id] = { kind: "day", code: (k < 5 + Math.floor(rnd() * 3) || (we && k % 2 === 0)) ? "LD" : "SD" }; });
    roster[P.addDays(key, di)] = m;
  }
  const out = P.planWeek({ weekKey: key, roster, staff, history: P.blankHistory(), cfg: { restarts: +process.env.RESTARTS || 2 } });
  const seen = {};
  out.days.forEach((d, di) => {
    stat.days++;
    const sz = p => (d.pods[p] || []).length, ld = p => (d.pods[p] || []).filter(a => a.shift === "LD").length;
    for (const p of PODS) for (const a of d.pods[p] || []) (seen[a.id] = seen[a.id] || new Set()).add(p);
    for (const p of PODS) if (sz(p) && !ld(p)) stat.noLD++;
    for (const p of AD) if (sz(p) && !(d.pods[p] || []).some(a => staff[a.id].airway || staff[a.id].transfer)) stat.noCover++;
    if (sz("E") > Math.max(...AD.map(sz))) stat.eBig++;
    const tot = PODS.reduce((t, p) => t + sz(p), 0);
    if (tot >= 11 && sz("E") < 2) { stat.eUnder++; fail++; if (fails.length < 8) fails.push(key + " day " + di + " Pod E " + sz("E") + " with " + tot + " on"); }
    if (!d.phone) return;
    stat.holderDays++;
    const h = PODS.find(p => (d.pods[p] || []).some(a => a.id === d.phone));
    if (!h || h === "E") return;
    const fullest = sz(h) >= Math.max(...AD.map(sz));
    const holderLD = (d.pods[h] || []).some(a => a.id === d.phone && a.shift === "LD");
    const spare = holderLD && PODS.some(p => ld(p) >= 2) ? ld(h) >= 2 : true;
    if (!fullest) stat.notFullest++;
    if (!spare) stat.noSpare++;
    if (fullest && spare) pass++; else { fail++; if (fails.length < 5) fails.push(key + " day " + di + " holder in " + h + " sizes " + PODS.map(sz).join("/") + " LDs " + PODS.map(ld).join("/")); }
  });
  for (const id in seen) { stat.people++; stat.pods += seen[id].size; }
}
console.log("phone-hard-rule: " + RUNS + " random weeks, " + stat.holderDays + " holder days");
console.log("  holder not in the fullest pod: " + stat.notFullest + " · holder without the spare long day: " + stat.noSpare);
console.log("  Pod E under two with 11+ on: " + stat.eUnder);
console.log("  pods with no long day: " + stat.noLD + " · A-D pods with no cover: " + stat.noCover + " · E biggest: " + stat.eBig);
console.log("  pods per person per week: " + (stat.pods / stat.people).toFixed(3));
fails.forEach(f => console.log("  FAIL " + f));
console.log(fail ? "FAILED " + fail + " · passed " + pass : "ALL " + pass + " HOLDER DAYS PASS");
process.exit(fail ? 1 : 0);
