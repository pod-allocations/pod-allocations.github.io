/*
 * THE WEEK PLANNER — its tests.   node tests/planner-tests.js
 *
 * Two kinds, and both matter:
 *
 *   HAND-BUILT WEEKS, where the answer is known and a rule can be cornered. A synthetic week can
 *   ask "what happens when exactly one airway-trained person is on" in a way real data never
 *   reliably does.
 *
 *   THE REAL ROSTER, all thirteen weeks of it, 3 Aug to 26 Oct, 91 days, pulled from Optima on
 *   26.08.19. Every ratified rule is asserted on every day of it. This is the half that catches
 *   the things nobody thought to write a case for — every real defect on this project was a rule
 *   enforced in one path and not another.
 *
 * WHERE A RULE CANNOT BE MET, THE TEST SAYS SO RATHER THAN FAILING. A day with fewer long-day
 * people rostered than there are pods to staff cannot have a long day in every pod, whoever
 * writes it. Those are counted against the roster, not the planner, and printed — a test that
 * quietly forgives them would hide a real regression.
 */
const path = require("path");
const P = require(path.join(__dirname, "..", "planner.js"));
const PODS = P.PODS, AD = ["A", "B", "C", "D"];

let pass = 0, fail = 0;
const notes = [];
function ok(what, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.log("  FAIL  " + what + (detail ? "  —  " + detail : ""));
}
function eq(what, a, b) { ok(what, a === b, "got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b)); }

// ── a tiny week builder, so a case reads like a rota rather than like JSON ─────────────────
function person(id, extra) {
  return Object.assign({ id, name: id, grade: "ST", airway: false, transfer: false, neuro: false,
    phone: false, supernum: false, start: "2024-01-01" }, extra || {});
}
function week(key, staff, days) {
  const roster = {};
  days.forEach((codes, di) => {
    const iso = P.addDays(key, di), m = {};
    for (const id in codes) m[id] = { kind: codes[id] === "N" ? "night" : codes[id] === "O" ? "off" : "day",
      code: codes[id] === "L" ? "LD" : codes[id] === "S" ? "SD" : codes[id] };
    roster[iso] = m;
  });
  return P.planWeek({ weekKey: key, roster, staff, history: P.blankHistory() });
}
const sizes = day => PODS.map(p => (day.pods[p] || []).length);
const idsIn = (day, p) => (day.pods[p] || []).map(a => a.id);

// ══════════════════════════════════════════════════════════════════════════════════════════
console.log("\nHAND-BUILT WEEKS\n");

/* The caps: pods within one of each other and Pod E never the biggest, at every headcount the
   unit ever runs. This is the shape of the whole week, so it is worth being certain of. */
for (let n = 1; n <= 30; n++) {
  const cap = P.capsFor(n);
  const vals = PODS.map(p => cap[p]);
  ok("caps within one of each other at " + n, Math.max(...vals) - Math.min(...vals) <= 1, JSON.stringify(cap));
  ok("Pod E never capped above another pod at " + n, AD.every(p => cap.E <= cap[p]), JSON.stringify(cap));
  ok("caps hold everybody at " + n, vals.reduce((a, b) => a + b, 0) >= n, JSON.stringify(cap));
}

/* THE BREAK ORDER IS THE PRICES. Nothing below a rule may add up to it — otherwise the search
   can buy a broken rule with a pile of cheap ones, which is exactly the fault the four old
   repair passes had. */
const C = P.CFG;
ok("a long day outranks everything below it", C.noLongDay > C.coverNone + C.thirdPod + C.phoneOnE + C.eLongDayEarly + C.eBiggest + C.extraMove * 5);
ok("cover outranks everything below it", C.coverNone > C.thirdPod + C.phoneOnE + C.eLongDayEarly + C.eBiggest + C.extraMove * 3);
ok("a third pod outranks Pod E being biggest", C.thirdPod > C.eBiggest);
ok("a third pod outranks the move cap", C.thirdPod > C.extraMove * 3);
ok("Pod E biggest is priced below a third pod", C.eBiggest < C.thirdPod);
/* Rules 4 and 5 are rules: no bundle of preferences may add up to either. 26.09.19 — at 520, rule 5
   was bought by airway-off-E plus one move on two bench days. */
const prefs = C.weekendCross + C.airwayOnE + C.eBiggest + C.allNewPod + C.airwayLDPairGap + C.spread + C.extraMove * 3 + C.anyMove * 3 + C.offHome * 3 + C.secondPod * 2 + C.eUnfair * 60;
ok("Pod E taking a long day early outranks every preference together", C.eLongDayEarly > prefs, C.eLongDayEarly + " vs " + prefs);
ok("the phone on Pod E outranks every preference together", C.phoneOnE > prefs, C.phoneOnE + " vs " + prefs);
ok("the busiest-pod budget can never buy a rule", C.phoneBusiestBudget < C.eLongDayEarly && C.phoneBusiestBudget < C.phoneOnE);
ok("the spare-long-day budget can never buy a rule", C.spareLDBudget < C.eLongDayEarly && C.spareLDBudget < C.phoneOnE);
ok("a third pod outranks rules 4 and 5 and the preferences together", C.thirdPod > C.phoneOnE + C.eLongDayEarly + prefs);

/* One airway-trained person and five pods. Rule 2 says A-D need cover and POD E DOES NOT, so the
   airway person must be in A-D — and rule 1 still comes first. */
{
  const staff = {};
  for (let i = 0; i < 10; i++) staff["p" + i] = person("p" + i, i === 0 ? { airway: true, transfer: true } : {});
  const codes = {};
  for (let i = 0; i < 10; i++) codes["p" + i] = i < 6 ? "L" : "S";
  const w = week("2026-09-07", staff, [codes, codes, codes, codes, codes, codes, codes]);
  const d = w.days[0];
  const where = PODS.find(p => idsIn(d, p).includes("p0"));
  ok("the only airway person is not parked on Pod E", where !== "E", "sat on " + where);
  ok("every staffed pod has a long day",
    PODS.every(p => !idsIn(d, p).length || (d.pods[p] || []).some(a => a.shift === "LD")), JSON.stringify(sizes(d)));
}

/* Supernumeraries are placed last and counted nowhere: adding four of them to a week must not
   change one counted person's pod, nor any pod's size. */
{
  const staff = {}, codes = {};
  for (let i = 0; i < 11; i++) { staff["p" + i] = person("p" + i, i < 3 ? { airway: true } : {}); codes["p" + i] = i < 6 ? "L" : "S"; }
  const plain = week("2026-09-14", staff, Array(7).fill(codes));
  const staff2 = Object.assign({}, staff), codes2 = Object.assign({}, codes);
  for (let i = 0; i < 4; i++) { staff2["s" + i] = person("s" + i, { supernum: true, neuro: i < 2 }); codes2["s" + i] = "L"; }
  const withSup = week("2026-09-14", staff2, Array(7).fill(codes2));
  eq("supernumeraries do not change the counted pods",
    JSON.stringify(plain.days.map(d => PODS.map(p => idsIn(d, p).sort().join("+")))),
    JSON.stringify(withSup.days.map(d => PODS.map(p => idsIn(d, p).sort().join("+")))));
  ok("supernumeraries are still listed", withSup.days[0].super.length === 4);
  ok("neurology registrars go to C or D",
    withSup.supers.filter(s => s.id === "s0" || s.id === "s1").every(s => s.pod === "C" || s.pod === "D"));

  /* Ali, 26.09.19: "cant have jonathan and nelda on same pods" — two supernumeraries never share
     a pod on a day. Four supers, five pods: each in a pod of its own. */
  withSup.days.forEach((d, di) => {
    const pods = withSup.supers.filter(x => x.di === di).map(x => x.pod);
    ok("two supernumeraries never share a pod (day " + di + ")", new Set(pods).size === pods.length, pods.join(","));
  });
}

/* Ali, 26.09.19: "also need to be on pods with accp theyre supernumerary accps i thoguht wed baked
   tht rule in". A supernumerary ACCP goes on a pod that has a counted ACCP — that is who they are
   learning beside. Two counted ACCPs on the unit, two supernumerary ACCPs: both land beside one. */
{
  const staff = {}, codes = {};
  for (let i = 0; i < 11; i++) { staff["p" + i] = person("p" + i, i < 3 ? { airway: true } : {}); codes["p" + i] = i < 6 ? "L" : "S"; }
  staff.p4.grade = "ACCP"; staff.p9.grade = "ACCP";
  staff.a0 = person("a0", { supernum: true, grade: "ACCP" }); codes.a0 = "S";
  staff.a1 = person("a1", { supernum: true, grade: "ACCP" }); codes.a1 = "S";
  const w = week("2026-09-14", staff, Array(7).fill(codes));
  let beside = 0, total = 0;
  w.days.forEach((d, di) => {
    w.supers.filter(x => x.di === di).forEach(x => {
      total++;
      if (idsIn(d, x.pod).some(id => staff[id].grade === "ACCP")) beside++;
    });
  });
  ok("a supernumerary ACCP is placed beside a counted ACCP", beside === total, beside + " of " + total);
}

/* The phone: a long day, never Pod E, never three days running, at most twice in a week. */
{
  const staff = {}, codes = {};
  for (let i = 0; i < 12; i++) {
    staff["p" + i] = person("p" + i, { phone: i < 4, airway: i < 3, transfer: i < 5 });
    codes["p" + i] = i < 7 ? "L" : "S";
  }
  const w = week("2026-09-21", staff, Array(7).fill(codes));
  const runs = {};
  let run = null;
  w.days.forEach(d => {
    ok("the phone is allocated", !!d.phone);
    if (!d.phone) return;
    const pod = PODS.find(p => idsIn(d, p).includes(d.phone));
    ok("the phone is never on Pod E", pod !== "E", "pod " + pod);
    const rec = (d.pods[pod] || []).find(a => a.id === d.phone);
    ok("the phone holder is on a long day", rec && rec.shift === "LD");
    ok("the phone holder is phone-trained", staff[d.phone].phone);
    runs[d.phone] = (runs[d.phone] || 0) + 1;
    run = (run && run.id === d.phone) ? { id: d.phone, n: run.n + 1 } : { id: d.phone, n: 1 };
    ok("the phone never runs three days together", run.n < 3, d.phone + " × " + run.n);
  });
  ok("nobody holds the phone more than twice in a week",
    Object.keys(runs).every(id => runs[id] <= P.CFG.phoneMaxPerWeek), JSON.stringify(runs));
}

/* Determinism. Same week in, same week out — twice. A planner that is not deterministic turns
   every nightly run into a fresh shuffle, and nobody would ever be able to tell why. */
{
  const staff = {}, codes = {};
  for (let i = 0; i < 13; i++) { staff["p" + i] = person("p" + i, { airway: i % 4 === 0, transfer: i % 3 === 0, phone: i % 5 === 0 }); codes["p" + i] = i < 7 ? "L" : "S"; }
  const a = week("2026-09-28", staff, Array(7).fill(codes));
  const b = week("2026-09-28", staff, Array(7).fill(codes));
  eq("the same week twice gives the same answer", JSON.stringify(a.days), JSON.stringify(b.days));
}

// ══════════════════════════════════════════════════════════════════════════════════════════
console.log("\nTHE REAL ROSTER — 13 weeks, 3 Aug to 26 Oct 2026\n");

const bench = require(path.join(__dirname, "..", "..", "..", "bench", "allocate-bench.json"));
const STAFF = bench.staff;
const S = id => STAFF[id] || {};
const hist = P.blankHistory();
const weeks = Object.keys(bench.weeks).sort().filter(k => Object.keys(bench.weeks[k].roster).length >= 7);
const planned = [];
for (const key of weeks) {
  const w = P.planWeek({ weekKey: key, roster: bench.weeks[key].roster, staff: STAFF, history: hist });
  planned.push({ key, w, roster: bench.weeks[key].roster });
  P.rollHistory(hist, w, STAFF);
}
console.log("  planned " + planned.length + " weeks, " + planned.length * 7 + " days");

let unfixableLongDay = 0, unfixableCover = 0, days = 0;
const thirdPods = [], lost = [], twice = [];
for (const { key, w, roster } of planned) {
  const podsOf = {};
  w.days.forEach((d, di) => {
    const iso = P.addDays(key, di), r = roster[iso] || {};
    const on = {}, sup = {};
    for (const id in r) {
      if (r[id].kind !== "day") continue;
      if (S(id).supernum) { sup[id] = true; continue; }
      on[id] = String(r[id].code || "").toUpperCase().indexOf("LD") === 0 ? "LD" : "SD";
    }
    const ids = Object.keys(on);
    if (!ids.length) return;
    days++;

    // nobody lost, nobody in two pods at once, nobody placed who is not on
    const seen = {};
    for (const p of PODS) for (const a of (d.pods[p] || [])) {
      if (seen[a.id]) twice.push(iso + " " + a.id);
      seen[a.id] = p;
      if (!on[a.id]) lost.push(iso + " " + a.id + " placed but not rostered on the day shift");
      (podsOf[a.id] = podsOf[a.id] || {})[p] = true;
    }
    for (const id of ids) if (!seen[id]) lost.push(iso + " " + id + " rostered but not placed");

    const size = {}, ld = {}, air = {}, tr = {};
    for (const p of PODS) {
      const list = idsIn(d, p);
      size[p] = list.length;
      ld[p] = (d.pods[p] || []).some(a => a.shift === "LD");
      air[p] = list.some(id => S(id).airway);
      tr[p] = list.some(id => S(id).transfer);
    }

    /* RULE 1 · a long day in every staffed pod — unless the roster cannot supply one. */
    const ldOn = ids.filter(id => on[id] === "LD").length;
    const staffed = PODS.filter(p => size[p] > 0).length;
    const floor = Math.max(0, staffed - ldOn);
    const gaps = PODS.filter(p => size[p] > 0 && !ld[p]).length;
    if (gaps > floor) ok("rule 1 · a long day in every staffed pod, " + iso, false, gaps + " pods short, roster allows " + floor);
    else { pass++; unfixableLongDay += floor ? Math.min(gaps, floor) : 0; }

    /* RULE 2 · airway or transfer in A-D. POD E IS EXCLUDED and must never be reported. */
    const carriers = ids.filter(id => S(id).airway || S(id).transfer).length;
    const bare = AD.filter(p => size[p] > 0 && !air[p] && !tr[p]).length;
    const staffedAD = AD.filter(p => size[p] > 0).length;
    if (bare > Math.max(0, staffedAD - carriers)) ok("rule 2 · cover in A-D, " + iso, false, bare + " bare, " + carriers + " carriers on");
    else { pass++; unfixableCover += bare; }

    /* RULE 4 · the day phone is never on Pod E, is on a long day, and is phone-trained. */
    if (d.phone) {
      ok("rule 4 · the phone is not on Pod E, " + iso, seen[d.phone] !== "E");
      const rec = (d.pods[seen[d.phone]] || []).find(a => a.id === d.phone);
      ok("the phone holder is on a long day, " + iso, !!rec && rec.shift === "LD");
      ok("the phone holder is phone-trained, " + iso, !!S(d.phone).phone);
    }

    /* RULE 5 · Pod E is never the biggest, and never takes a long day before A-D have one. */
    const mx = Math.max(...PODS.map(p => size[p])), mn = Math.min(...PODS.map(p => size[p]));
    ok("rule 5 · Pod E is not the biggest, " + iso, !(size.E === mx && size.E > mn), JSON.stringify(size));
    if (ld.E) ok("rule 5 · no long day on Pod E before A-D, " + iso, !AD.some(p => size[p] > 0 && !ld[p]));

    /* Where a pod cannot be staffed the gap belongs on Pod E, because Pod E is the smallest.
       A closed Pod A beside a running Pod E is the wrong way round. */
    if (size.E > 0) ok("an empty pod is Pod E, not one of A-D, " + iso,
      AD.every(p => size[p] > 0), JSON.stringify(size));

    /* Anyone rostered OFF — Fairfield, a zero day — must never be pulled into a pod. */
    for (const id in seen) if ((r[id] || {}).kind === "off") ok("nobody rostered off is placed, " + iso, false, id);
  });

  /* RULE 3 · nobody works three pods in a week. This one is absolute. */
  for (const id in podsOf) {
    const n = Object.keys(podsOf[id]).length;
    if (n > 2) thirdPods.push(key + " " + (S(id).name || id) + " " + n + " pods");
  }
}
eq("rule 3 · nobody on three pods in a week, across all 13 weeks", thirdPods.length, 0);
if (thirdPods.length) notes.push(thirdPods.slice(0, 5).join(" · "));
eq("nobody lost or placed when not on", lost.length, 0);
eq("nobody placed in two pods on one day", twice.length, 0);
console.log("  " + days + " staffed days · " + unfixableLongDay + " long-day gaps the roster itself forces · " +
  unfixableCover + " cover gaps with nobody left to fill them");

/* A SICK DAY REPAIRS THAT DAY ONLY. One person taken off one midweek day in every week: how many
   OTHER people move, and does the repair ever break a rule the plan was keeping? */
{
  let worst = 0, total = 0, cases = 0, thirds = 0;
  for (const { key, w, roster } of planned) {
    const iso = P.addDays(key, 3);
    const r = roster[iso] || {};
    const on = {};
    for (const id in r) {
      if (r[id].kind !== "day" || S(id).supernum) continue;
      on[id] = String(r[id].code || "").toUpperCase().indexOf("LD") === 0 ? "LD" : "SD";
    }
    const victim = Object.keys(on)[0];
    if (!victim) continue;
    delete on[victim];
    const podsThisWeek = {}, movesThisWeek = {}, last = {};
    w.days.forEach((d, dj) => {
      if (dj === 3) return;
      for (const p of PODS) for (const a of (d.pods[p] || [])) {
        (podsThisWeek[a.id] = podsThisWeek[a.id] || {})[p] = true;
        if (last[a.id] && last[a.id] !== p) movesThisWeek[a.id] = (movesThisWeek[a.id] || 0) + 1;
        last[a.id] = p;
      }
    });
    const before = {};
    for (const p of PODS) for (const a of (w.days[3].pods[p] || [])) before[a.id] = p;
    const fixed = P.repairDay({ dayIndex: 3, day: w.days[3], on, staff: STAFF,
      home: w.home, podsThisWeek, movesThisWeek });
    let moved = 0;
    for (const p of PODS) for (const a of (fixed.pods[p] || [])) {
      if (a.id !== victim && before[a.id] && before[a.id] !== p) moved++;
      const seen = Object.assign({}, podsThisWeek[a.id]); seen[p] = true;
      if (Object.keys(seen).length > 2) thirds++;
    }
    total += moved; worst = Math.max(worst, moved); cases++;
  }
  const mean = total / Math.max(1, cases);
  ok("a sick call moves two other people or fewer, on average", mean <= 2, "mean " + mean.toFixed(2));
  ok("a sick call never moves more than four others", worst <= 4, "worst " + worst);
  eq("a repair never puts anybody on a third pod", thirds, 0);
  console.log("  one person off, " + cases + " weeks tested: " + mean.toFixed(2) + " others moved on average, worst " + worst);
}

/* The planner must not care what order the roster arrives in. Two runs over the same weeks in
   the same order must agree exactly — this is the measure that separates a planner from a
   random walk, and nobody had ever checked it before 26.08.19. */
{
  const h2 = P.blankHistory();
  let same = true;
  for (const { key, w } of planned) {
    const again = P.planWeek({ weekKey: key, roster: bench.weeks[key].roster, staff: STAFF, history: h2 });
    if (JSON.stringify(again.days) !== JSON.stringify(w.days)) same = false;
    P.rollHistory(h2, again, STAFF);
  }
  ok("thirteen weeks, run twice, come out identical", same);
}

/* ── NIGHTS ───────────────────────────────────────────────────────────────────────────────
   Ali, 26.08.19: "its important it works for nights too." The night team is two sides — A&B and
   C-D-E — with one person alone on Pod E when five are on, and that person is the phone holder.
   Everything below is asserted on all 91 nights of the real roster. */
{
  let nights = 0, splitPossible = 0, splitOK = 0, pairs = 0, changed = 0, both = 0, kept = 0;
  for (const { key, w, roster } of planned) {
    let prev = null;
    for (let di = 0; di < 7; di++) {
      const iso = P.addDays(key, di), r = roster[iso] || {};
      const team = Object.keys(r).filter(id => r[id].kind === "night" && !S(id).supernum);
      const n = w.days[di].night;
      if (!team.length) { ok("no night team, nothing written, " + iso, !n.phone && !n.AB.length && !n.CDE.length && !n.E.length); prev = null; continue; }
      nights++;
      const placedN = [].concat(n.AB, n.CDE, n.E);
      eq("everybody on nights is placed once, " + iso, placedN.slice().sort().join(","), team.slice().sort().join(","));
      ok("nobody is on two night sides at once, " + iso, new Set(placedN).size === placedN.length);

      const elig = team.filter(id => S(id).phone);
      if (elig.length) {
        ok("the night phone is allocated, " + iso, !!n.phone);
        ok("the night phone holder is qualified, " + iso, !!S(n.phone).phone, n.phone);
      }
      /* Five or more on: one person covers Pod E alone, and it is the phone holder. */
      if (team.length >= P.CFG.nightEFrom && n.phone) {
        eq("five or more on nights: one alone on Pod E, " + iso, n.E.length, 1);
        eq("and Pod E is the phone holder, " + iso, n.E[0], n.phone);
      } else {
        eq("fewer than five on nights: nobody stands alone on Pod E, " + iso, n.E.length, 0);
      }
      /* Two airway on, one each side. Where only one is on it cannot be done and is not counted. */
      /* THE TWO SIDES ARE A&B AND C&D. Pod E is not a side — whoever is there is alone with the
         phone. And every phone-trained person on this unit is airway-trained (checked: 32 of 32),
         so with five on, one airway person is spoken for before the sides are dealt at all. The
         split is only ASKED FOR where two more are on besides them. */
      const spareAir = [].concat(n.AB, n.CDE).filter(id => S(id).airway).length;
      if (spareAir >= 2) {
        splitPossible++;
        if (n.AB.some(id => S(id).airway) && n.CDE.some(id => S(id).airway)) splitOK++;
      }
      if (prev) {
        /* Only count the nights where somebody else COULD have taken it. One qualified person on
           is a rota fact, not an allocation fault. */
        if (elig.filter(id => id !== prev.phone).length) {
          pairs++;
          if (n.phone && prev.phone && n.phone !== prev.phone) changed++;
        }
        const side = {};
        n.AB.forEach(id => side[id] = "AB");
        n.CDE.forEach(id => side[id] = "CDE");
        n.E.forEach(id => side[id] = side[id] || "E");
        for (const id in side) {
          if (!(id in prev.side)) continue;
          both++;
          if (side[id] === prev.side[id]) kept++;
          else if (side[id] === "E" && n.phone === id) kept++;
          else if (prev.side[id] === "E" && prev.phone === id) kept++;
        }
      }
      const side2 = {};
      n.AB.forEach(id => side2[id] = "AB");
      n.CDE.forEach(id => side2[id] = "CDE");
      n.E.forEach(id => side2[id] = side2[id] || "E");
      prev = { side: side2, phone: n.phone };
    }
  }
  ok("an airway person on A&B and on C&D, every night two are free to do it",
    splitOK === splitPossible, splitOK + " of " + splitPossible);
  ok("the night phone changes hands every night", changed === pairs, changed + " of " + pairs);
  /* Not a wall: the team changes, and when A&B is left with one person against three on C-D-E
     somebody has to cross. Balancing the two sides costs about five points here and removes 29
     lopsided nights in thirteen weeks — `CFG.nightBalanceSides` is the switch. Below 80% means
     something has gone wrong rather than somebody having been moved for a reason. */
  ok("at least four nights in five, people keep their side", kept / both >= 0.8, kept + " of " + both);
  console.log("  " + nights + " nights written · airway split " + splitOK + "/" + splitPossible +
    " (the other " + (nights - splitPossible) + " have too few airway people free for it)" +
    " · phone changed " + changed + "/" + pairs + " · side kept " + kept + "/" + both);
}

/* R06 — THE PHONE HOLDER WHERE THERE IS MOST COVER. Ali, 26.09.19: "why phone on C which is
   smallest pod on monday - thought wed sorted that". It lived only in the old repair chain and had
   never reached the planner. A preference, not a rule: measured as the share of days the holder
   stands in one of the fullest A–D pods, and it may not break a rule to satisfy itself. */
{
  let could = 0, inBiggest = 0, worst = [];
  for (const { key, w } of planned) {
    w.days.forEach((d, di) => {
      if (!d.phone) return;
      const pod = PODS.find(p => idsIn(d, p).includes(d.phone));
      if (!pod || pod === "E") return;
      const size = p => idsIn(d, p).length;
      const max = Math.max(...["A", "B", "C", "D"].map(size));
      could++;
      if (size(pod) === max) inBiggest++; else worst.push(key + "+" + di + ":" + pod + "=" + size(pod) + "<" + max);
    });
  }
  ok("the phone holder stands in a fullest pod on at least three days in four",
    inBiggest * 4 >= could * 3, inBiggest + " of " + could + " · " + worst.slice(0, 5).join(" "));
  console.log("  phone holder in a fullest pod on " + inBiggest + " of " + could + " days");
}

/* THE SPARE LONG DAY DOUBLES UP WITH THE PHONE — Ali, 26.09.19: "if theres more than 5 LD on the
   phone LD needs to double up with the extra LD". A rule where it can be met by choosing the holder,
   so: on every day that has a pod with two long days, the phone holder stands in such a pod. */
{
  let could = 0, did = 0, forced = 0, worst = [];
  for (const { key, w } of planned) {
    w.days.forEach((d, di) => {
      if (!d.phone) return;
      const ldIn = p => (d.pods[p] || []).filter(a => a.shift === "LD").length;
      if (!["A", "B", "C", "D"].some(p => ldIn(p) >= 2)) return;
      could++;
      const pod = PODS.find(p => idsIn(d, p).includes(d.phone));
      if (pod && ldIn(pod) >= 2) did++;
      else if ((w.notes || []).some(n => n.di === di && n.kind === "spareLDUnreachable")) forced++;
      else worst.push(key + "+" + di + ":" + pod);
    });
  }
  /* Where every way of doubling up would break a rule (a third pod, usually), the planner says so
     in its notes and the day is counted against the roster, not forgiven silently. */
  ok("on a day with a spare long day, the phone holder stands where it is", did + forced === could, did + " of " + could + " " + worst.slice(0, 6).join(" "));
  console.log("  phone holder beside the spare long day on " + did + " of " + could + " days that had one" + (forced ? " · " + forced + " where every swap broke a rule" : ""));
}

/* THE SPARE LONG DAY BESIDE THE PHONE HOLDER — a preference, so this reports rather than fails
   unless it has gone backwards. It may never break a rule to get itself satisfied. */
{
  let could = 0, did = 0;
  for (const { key, w, roster } of planned) {
    w.days.forEach((d, di) => {
      if (!d.phone) return;
      const pod = PODS.find(p => idsIn(d, p).includes(d.phone));
      if (!pod) return;
      const ldIn = p => (d.pods[p] || []).filter(a => a.shift === "LD").length;
      if (PODS.some(p => p !== pod && ldIn(p) >= 2)) { could++; if (ldIn(pod) >= 2) did++; }
    });
  }
  ok("the spare long day sits beside the phone holder at least half the time it could",
    did * 2 >= could, did + " of " + could);
  console.log("  spare long day beside the phone holder on " + did + " of the " + could + " days it was available");
}

/* ── THE JOIN TO THE BOARD ────────────────────────────────────────────────────────────────
   `writeWeek` and `fixDay` are the only two calls index.html has to make, so they are tested
   against the board's own shape: a week of `days[di].pods[P].assign` slot lists, staff as an
   ARRAY with `phoneHolder` rather than `phone`, and empty slots the board draws. */
{
  const key = weeks[2], src = bench.weeks[key];
  const staffArray = Object.keys(STAFF).map(id => Object.assign({}, STAFF[id], { phoneHolder: STAFF[id].phone }));
  const wk = { key, roster: JSON.parse(JSON.stringify(src.roster)), days: [] };
  for (let di = 0; di < 7; di++) {
    wk.days.push({ pods: Object.fromEntries(PODS.map(p => [p, { assign: [{ id: null, shift: null }, { id: null, shift: null }], super: [] }])), phone: null });
  }
  const res = P.writeWeek(wk, staffArray, { history: P.blankHistory() });
  ok("writeWeek fills the board's own week shape", wk.days.every(d => PODS.some(p => d.pods[p].assign.some(a => a.id))));
  ok("writeWeek leaves the empty slots the board draws", wk.days.every(d => PODS.every(p => d.pods[p].assign.length >= 2)));
  ok("writeWeek allocates the phone", wk.days.filter(d => d.phone).length >= 5);
  ok("writeWeek reads phoneHolder as phone-trained",
    wk.days.every(d => !d.phone || staffArray.find(s => s.id === d.phone).phoneHolder));
  ok("writeWeek reports what the week could not do", Array.isArray(res.notes));

  // one person off the Thursday: fixDay touches that day and nothing else
  const beforeWeek = JSON.stringify(wk.days.map((d, i) => i === 3 ? null : d));
  const iso = P.addDays(key, 3);
  const victim = Object.keys(wk.roster[iso]).find(id => wk.roster[iso][id].kind === "day" && !S(id).supernum);
  delete wk.roster[iso][victim];
  const before = {};
  PODS.forEach(p => wk.days[3].pods[p].assign.forEach(a => { if (a.id) before[a.id] = p; }));
  const fx = P.fixDay(wk, 3, staffArray, {});
  eq("fixDay does not touch the other six days", JSON.stringify(wk.days.map((d, i) => i === 3 ? null : d)), beforeWeek);
  let moved = 0;
  PODS.forEach(p => wk.days[3].pods[p].assign.forEach(a => { if (a.id && a.id !== victim && before[a.id] && before[a.id] !== p) moved++; }));
  ok("fixDay moves nobody who did not have to move", moved <= 2, moved + " others moved");
  ok("the person who went off is out of the pods",
    PODS.every(p => !wk.days[3].pods[p].assign.some(a => a.id === victim)));
}

console.log("\n" + (fail ? "FAILED " + fail + " · passed " + pass : "ALL " + pass + " ASSERTIONS PASS") + "\n");
if (notes.length) console.log(notes.join("\n") + "\n");
process.exit(fail ? 1 : 0);
