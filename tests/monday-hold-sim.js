/* monday-hold-sim.js — WHY DOES MONDAY FORGET SUNDAY, AND WHAT FIXES IT?
 *
 * Ali, 26.09.18: "lack of continuity for peopl on a pod over the weekend but differnet one on
 * monday - its difficult as treated by week at present."
 *
 * Measured on the live board: people stay in the same pod 73.8% of consecutive days within a week,
 * and 35.7% Sunday into Monday. Half as good.
 *
 * THE FIRST DIAGNOSIS WAS WRONG. The obvious candidate was the Saturday-pod hold in autoFillDay
 * (worth -3000, ratified 29 Jul) stopping at Sunday. But autoFillDay is the FALLBACK path — since
 * 26.08.20 the live writer is Planner.writeWeek in planner.js, which plans a whole week as one
 * optimisation and never sees the week before it.
 *
 * THE REAL CAUSE is one line. rollHistory ends every week with
 *
 *     hist.home = week.home || hist.home;
 *
 * ...and homePods() — which decides everybody's home pod for the week, and whose offHome cost is
 * what keeps a person in one place — starts `var home = {}` and never reads hist.home. Last week's
 * home pods are written down every week and read by nothing. Monday has no memory of Sunday by
 * construction, not by a missing rule.
 *
 * THE CHANGE UNDER TEST seeds `home` from hist.home. Three lines, using machinery that already
 * exists and is already stored, and it fixes every week boundary rather than only the weekend.
 *
 * The run writes the real 13-week Optima roster twice — as shipped, and patched — through
 * Planner.writeWeek directly, in order, sharing one history object, so each Monday can see the
 * Sunday before it. Calling the planner directly is deliberate: fillWeekWithPlanner refuses any
 * week outside the publishing window, which is right on the board and useless in a simulation.
 *
 *   node tests/monday-hold-sim.js          (needs jsdom on NODE_PATH)
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT  = path.join(__dirname, "..");
const APP   = path.join(ROOT, "index.html");
const BENCH = path.join(ROOT, "..", "..", "docs", "bench", "allocate-bench.json");

const ANCHOR = `  function homePods(on, staff, hist, cfg) {
    var home = {}, ORDER = [5, 6, 4, 0, 1, 2, 3];`;
const PATCHED = `  function homePods(on, staff, hist, cfg) {
    var home = {}, ORDER = [5, 6, 4, 0, 1, 2, 3];
    /* LAST WEEK'S HOME POD, AS A PREFERENCE AND NOT A CLAIM. rollHistory has always written
       hist.home and nothing has ever read it, so Monday had no memory of Sunday. Seeding home
       directly was tried first and broke ratified rule 5 — a carried person claimed a slot before
       the long-day and airway sort ran — so it is scored instead, below the long-day (40) and
       airway (20) terms, where it can tip a choice but never take a pod its long day. */
    var carried = (hist && hist.home) || {};`;

const ANCHOR2 = `          if (S(id).grade === "ACCP") { if (!accp[p]) sc += 10; else sc -= 12 * accp[p]; }`;
const CARRY = Number(process.env.CARRY || 14);
const PATCHED2 = ANCHOR2 + "\n          if (carried[id] === p) sc += " + CARRY + ";";

function loadApp(patch) {
  let html = fs.readFileSync(APP, "utf8");
  for (const f of ["core.css", "core.js", "strength.js", "planner.js", "podcost.js"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    let body = fs.readFileSync(p, "utf8");
    if (f === "planner.js" && patch) {
      if (body.indexOf(ANCHOR) < 0) { console.error("PATCH ANCHOR NOT FOUND in planner.js"); process.exit(2); }
      body = body.split(ANCHOR).join(PATCHED);
      if (body.indexOf(ANCHOR2) < 0) { console.error("PATCH ANCHOR2 NOT FOUND"); process.exit(2); }
      body = body.split(ANCHOR2).join(PATCHED2);
    }
    if (f.endsWith(".css")) html = html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, () => "<style>" + body + "</style>");
    else {
      const safe = body.replace(/<\/script/gi, "<\\/script");
      html = html.replace(new RegExp('<script src="' + f.replace(".", "\\.") + '[^"]*"><\\/script>'), () => "<script>" + safe + "</script>");
    }
  }
  html = html.replace(/<script src="k\.js[^"]*"><\/script>/,
    '<script>window.__POD_KEYS={r:"https://example.invalid/r",s:"https://example.invalid/s"};</script>');
  const hook = `window.__api = function(){ return {
    data, PODS, blankDay, mondayOf, todayISO, addDays, staffById, checkDay,
    Planner: (typeof Planner !== "undefined" ? Planner : null),
    setWeek: k => { currentWeekKey = k; },
    setRule: (k,v) => { data.rules = data.rules || {}; data.rules[k] = v; }
  }; };`;
  html = html.replace("startUp();", hook + "\ntry{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w){
      w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {}; w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
    } });
  return new Promise(r => setTimeout(() => r(dom.window.__api()), 1400));
}

function buildAll(api, bench) {
  const srcKeys = Object.keys(bench.weeks).sort()
    .filter(k => Object.keys(bench.weeks[k].roster || {}).length >= 7);
  api.data.staff.length = 0;
  for (const id in bench.staff) api.data.staff.push(Object.assign({ active: true, aliases: [] }, bench.staff[id]));
  const START = api.addDays(api.mondayOf(api.todayISO()), 7);
  const keys = [];
  api.data.weeks = {};
  srcKeys.forEach((src, i) => {
    const key = api.addDays(START, i * 7);
    const roster = {};
    for (let di = 0; di < 7; di++)
      roster[api.addDays(key, di)] = JSON.parse(JSON.stringify(bench.weeks[src].roster[api.addDays(src, di)] || {}));
    const wk = { key: key, roster: roster, days: [] };
    for (let di = 0; di < 7; di++) wk.days.push(api.blankDay());
    api.data.weeks[key] = wk;
    keys.push(key);
  });
  /* ONE history across the whole run — that is the thing being tested. */
  const hist = api.Planner.blankHistory();
  keys.forEach(key => {
    api.setWeek(key);
    api.Planner.writeWeek(api.data.weeks[key], api.data.staff, { history: hist, weekKey: key });
  });
  if (process.env.SIMDEBUG) {
    let placed = 0;
    keys.forEach(key => { const wk = api.data.weeks[key];
      for (let di = 0; di < 7; di++) for (const p of api.PODS)
        placed += (wk.days[di].pods[p].assign || []).filter(a => a.id).length; });
    console.log("  [debug] " + keys.length + " weeks, " + placed + " placements");
  }
  return keys;
}

function measure(api, keys) {
  const podOf = (day, id) => {
    for (const p of api.PODS) if ((day.pods[p].assign || []).some(a => a.id === id)) return p;
    return null;
  };
  let smP = 0, smS = 0, iwP = 0, iwS = 0, red = 0, amber = 0, clean = 0, days = 0;
  /* THE ONLY RED IN THIS FIXTURE THAT IS ABOUT POD PLACEMENT. The bench staff records carry no
     phoneHolder and no nights flag, so the phone and night checks fail on ~80 of 91 days in BOTH
     runs and the red count is saturated — it cannot be used to claim safety either way. "Pod E has
     no long-day person" is the one red the planner can actually cause by moving people, so that is
     the number to watch. */
  let podELD = 0;
  const weekPods = {};
  keys.forEach((key, wi) => {
    const wk = api.data.weeks[key];
    for (let di = 0; di < 7; di++) {
      const day = wk.days[di]; if (!day) continue;
      days++;
      const iss = api.checkDay(day, api.addDays(key, di), di, wk).filter(i => !i.empty && !i.info);
      if (iss.some(i => i.hard)) red++; else if (iss.length) amber++; else clean++;
      if (iss.some(i => /Pod E has no long-day/.test(String(i.msg)))) podELD++;
      if (process.env.SIMISSUES) iss.forEach(i => {
        const k = (i.hard ? "RED  " : "AMBER") + " " + String(i.msg).replace(/[A-Z][a-z]+ [A-Z][a-z]+/g, "<name>").slice(0, 70);
        measure.tally = measure.tally || {}; measure.tally[k] = (measure.tally[k] || 0) + 1; });
      for (const p of api.PODS) for (const a of (day.pods[p].assign || [])) if (a.id)
        (weekPods[wi + "|" + a.id] = weekPods[wi + "|" + a.id] || new Set()).add(p);

      let nWk = wk, ndi = di + 1;
      if (di === 6) { nWk = api.data.weeks[keys[wi + 1]]; ndi = 0; if (!nWk) continue; }
      const nDay = nWk.days[ndi]; if (!nDay) continue;
      for (const p of api.PODS) for (const a of (day.pods[p].assign || [])) {
        if (!a.id) continue;
        const p2 = podOf(nDay, a.id); if (!p2) continue;
        if (di === 6) { smP++; if (p === p2) smS++; } else { iwP++; if (p === p2) iwS++; }
      }
    }
  });
  if (process.env.SIMISSUES && measure.tally) {
    console.log("  [issues] distinct checkDay complaints:");
    Object.keys(measure.tally).sort((a,b)=>measure.tally[b]-measure.tally[a]).slice(0,8)
      .forEach(k => console.log("     " + String(measure.tally[k]).padStart(4) + "  " + k));
    measure.tally = null;
  }
  const ppw = Object.values(weekPods).map(s => s.size);
  const pc = (a,b) => b ? Math.round(a / b * 1000) / 10 : 0;
  return { sunMon: pc(smS, smP), smP, inWeek: pc(iwS, iwP), iwP, podELD,
           red, amber, clean, days, cleanPct: pc(clean, days),
           avgPods: Math.round((ppw.reduce((a,b)=>a+b,0) / (ppw.length || 1)) * 1000) / 1000,
           threePlus: ppw.filter(n => n >= 3).length };
}

(async () => {
  const bench = JSON.parse(fs.readFileSync(BENCH, "utf8"));
  console.log("=== Monday continuity — simulation on the real 13-week roster ===\n");
  console.log("baseline (shipped planner.js)…");
  const a1 = await loadApp(false);
  if (!a1.Planner) { console.error("planner.js did not reach the page"); process.exit(2); }
  const before = measure(a1, buildAll(a1, bench));
  console.log("patched (home pods carried across weeks)…");
  const a2 = await loadApp(true);
  const after = measure(a2, buildAll(a2, bench));

  const row = (label, b, a, better) => {
    const d = Math.round((a - b) * 1000) / 1000;
    const verdict = d === 0 ? "   ·" : ((better === "up" ? d > 0 : d < 0) ? "   ✓" : "   ✗");
    console.log("  " + label.padEnd(32) + String(b).padStart(9) + String(a).padStart(10)
                + (d > 0 ? "+" + d : String(d)).padStart(10) + verdict);
  };
  console.log("\n" + "  ".padEnd(34) + "before".padStart(7) + "after".padStart(10) + "change".padStart(10));
  console.log("  " + "-".repeat(63));
  row("Sunday→Monday same pod %", before.sunMon, after.sunMon, "up");
  row("Within-week same pod %",   before.inWeek, after.inWeek, "up");
  row("Clean days %",             before.cleanPct, after.cleanPct, "up");
  row("Pod E with no long day",    before.podELD, after.podELD, "down");
  row("Red days (SATURATED)",      before.red, after.red, "down");
  row("Amber days",               before.amber, after.amber, "down");
  row("Avg pods per person/week", before.avgPods, after.avgPods, "down");
  row("People in 3+ pods a week", before.threePlus, after.threePlus, "down");
  console.log("\n  sample: " + before.smP + " Sunday→Monday pairs, " + before.iwP
              + " within-week pairs, " + before.days + " days\n");

  const gain = after.sunMon - before.sunMon;
  console.log("VERDICT");
  if (before.smP < 20) console.log("  ? too few Sunday→Monday pairs to call — " + before.smP);
  else if (gain <= 0) console.log("  ✗ no continuity gain — do not ship");
  else if (after.podELD > before.podELD) console.log("  ✗ continuity improves but Pod E loses long days — do not ship");
  else if (before.cleanPct - after.cleanPct > 2) console.log("  ~ clean days fall more than 2 points — Ali decides");
  else console.log("  ✓ continuity improves and no pod loses a long day");
  console.log("  NOTE: the red/clean columns are saturated by the fixture (no phone or nights");
  console.log("        flags on bench staff) and are identical in both runs — read Pod E instead.");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
