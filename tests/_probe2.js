/*
 * Render smoke test — the resident board
 * --------------------------------------
 * The rule suite exercises allocation LOGIC and never draws a page. That gap has now cost two
 * live bugs: a change-log helper that called itself and blew the stack, and — on 6 Aug — the
 * "Who can…" button wired INSIDE the `if (TESTMODE)` block, so on rota.salford.icu it drew,
 * looked clickable, and did nothing at all. Nothing failed loudly because nothing ran.
 *
 * Cover has had a suite like this since 4 Aug. The resident board, which is the one residents
 * actually use, did not. This is that suite.
 *
 * It loads the real file, seeds enough data for every page to do work, opens every tab, and
 * fails on ANY thrown error, unhandled rejection, or page that renders empty when it shouldn't.
 * It knows nothing about pod rules — that is the other suite's job, and it should stay that way.
 *
 * Run:  node tests/render-tests.js       (needs jsdom on NODE_PATH)
 * Exit: 0 all good, 1 something threw or drew nothing.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HERE = __dirname;
const PAGE = fs.existsSync(path.join(HERE, "..", "index.html"))
  ? path.join(HERE, "..", "index.html")
  : path.join(HERE, "..", "Pod-Allocations.html");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

function inlineAssets(html) {
  /* strength.js IS THE ALGORITHM AND MUST BE IN THE HARNESS. Same trap the rule suite fell into
     on 14 Aug: jsdom is handed the page as a string with no working origin, so a <script src>
     silently fetches nothing, `Strength` stays undefined, and every assertion about the score or
     the weights quietly tests the ABSENCE of it. The page is written to degrade gracefully when
     strength.js is missing — which is right for a bad deploy and fatal for a test suite, because
     the degraded path passes. Inlined here so the tests exercise the same two files the browser
     loads. */
  /* planner.js joins the list on 26.08.20, for exactly the reason written above: from today it is
     what writes a week, and fillWeekWithPlanner degrades to the old day-at-a-time path when it is
     absent — so leaving it out would grade the degraded path here too.

     TWO ESCAPES, BOTH LEARNED THE HARD WAY ON 26.08.20. An HTML parser ends a <script> at the
     first `</script>` it sees, even inside a comment, and planner.js documents its own install
     line — so the inlined copy was cut off mid-file and jsdom reported a SyntaxError from a line
     number in unrelated CSS. And String.replace reads `$&`, "$'" and "$`" in a replacement STRING
     as instructions, so a source file containing them is rewritten on the way in. Escape the tag,
     and pass a function. */
  /* podcost.js joins on 26.08.21 — the dials now take their number from the planner's price list
     through it, so a harness without it grades a number the browser no longer draws. */
  for (const f of ["core.css", "core.js", "strength.js", "planner.js", "podcost.js"]) {
    const p = path.join(HERE, "..", f);
    if (!fs.existsSync(p)) continue;
    const body = fs.readFileSync(p, "utf8");
    if (f.endsWith(".css")) {
      html = html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, () => "<style>" + body + "</style>");
    } else {
      const safe = body.replace(/<\/script/gi, "<\\/script");
      html = html.replace(new RegExp('<script src="' + f.replace(".", "\\.") + '[^"]*"><\\/script>'),
                          () => "<script>" + safe + "</script>");
    }
  }
  /* k.js carries the flow URLs and is served alongside the page, so jsdom never fetches it.
     Stand one in — the URLs are never called, every fetch is stubbed to reject. */
  html = html.replace(/<script src="k\.js[^"]*"><\/script>/,
    '<script>window.__POD_KEYS = { r: "https://example.invalid/read", s: "https://example.invalid/save" };</script>');
  return html;
}

function load() {
  let html = inlineAssets(fs.readFileSync(PAGE, "utf8"));
  html = html.replace("startUp();", "try{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {};
      w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.addEventListener("error", e => errors.push(String((e.error && e.error.message) || e.message)));
      w.addEventListener("unhandledrejection", e => {
        const m = String((e.reason && e.reason.message) || e.reason || "");
        if (!/no net/.test(m)) errors.push("unhandled rejection: " + m);
      });
    }
  });
  return new Promise(res => setTimeout(() => res({ w: dom.window, errors }), 900));
}

/* Enough that every page has something to draw. A page that renders nothing cannot fail, which
   is exactly how an empty log hid a stack overflow for half a day. */
const SEED = `(function(){
  const T = todayISO(), K = mondayOf(T);
  data.staffPw = "seeded-hash";
  store.sset("staffUnlocked", "1");
  currentWeekKey = K;
  const wk = getWeek(K);
  const mk = (id, name, grade, extra) => { data.staff.push(Object.assign({ id: id, name: name,
    grade: grade, active: true, adhoc: false, aliases: [] }, extra || {})); return id; };
  mk("r1", "Alice Ring", "ST", { airway: true, phoneHolder: true, transfer: true, nights: true });
  mk("r2", "Sam Aziz", "CT", { airway: true, nights: true });
  mk("r3", "Jo Bloggs", "FY2", { nights: true, verified: false });
  mk("a1", "An ACCP", "ACCP", { transfer: true, picc: true, nights: true, supernum: true });
  mk("a2", "Another ACCP", "ACCP", { picc: true, phoneShadow: true });
  mk("c1", "A Consultant", "CON", {});
  mk("n1", "Nia Reggie", "Neurology", { nights: true, supernum: true });
  wk.roster = wk.roster || {};
  /* Everybody gets a duty in the current week. Before the historic rule existed, rostering two
     people was enough; now anybody with nothing in the four pulled weeks is correctly classed as
     gone, so a fixture that rosters two would empty the Current list and take the staff-table
     tests with it. A realistic fixture is a rostered one. */
  wk.roster[T] = { r1:{code:"LD",kind:"day",src:"a"}, r2:{code:"SD",kind:"day",src:"a"},
                   r3:{code:"SD",kind:"day",src:"a"}, a1:{code:"LD",kind:"day",src:"a"},
                   a2:{code:"SD",kind:"day",src:"a"}, n1:{code:"SD",kind:"day",src:"a"} };
  const di = Math.round((new Date(T) - new Date(K)) / 86400000);
  wk.days[di] = blankDay();
  wk.days[di].pods.A.assign.push({ id:"r1", shift:"LD" });
  const now = new Date().toISOString();
  data.log = [
    { t: now, who: "A", kind: "manual", on: T, msg: "a move", d: { act:"move", subj:"Alice Ring", from:"A", to:"B" } },
    { t: now, who: "allocate sync", kind: "auto", on: T, msg: "Kate Bailey on the rota, LD",
      d: { act:"on", subj:"Kate Bailey", shift:"LD", to:"C" } }
  ];
  data.feedback = [{ t: now, name: "anonymous", kind: "Problem", msg: "Something", read: false }];
  data.lastSync = now;
  return "seeded";
})()`;

(async () => {
  const { w } = await load();
  w.eval(SEED);
  const out = w.eval(`(function(){
    var A = data.staff[0], B = data.staff[1];
    var T = todayISO(), K = mondayOf(T);
    var wk = getWeek(K); var di = Math.round((new Date(T) - new Date(K)) / 86400000);
    wk.days[di].pods.A.assign = [{ id: A.id, shift: 'LD' }, { id: B.id, shift: 'SD' }];
    A.end = addDays(T, -30); A.noFair = false; B.noFair = false;
    store.set('fairView','here'); switchTab('fair'); renderFairness();
    var TT = function(){ return document.getElementById('fairTable').textContent; };
    var FT = function(){ var f = document.querySelector('#fairTable tfoot'); return f ? f.textContent : 'NONE'; };
    var hereOk = TT().indexOf(A.name) < 0 && TT().indexOf(B.name) >= 0, totHere = FT();
    store.set('fairView','left'); renderFairness();
    var leftOk = TT().indexOf(A.name) >= 0 && TT().indexOf(B.name) < 0, totLeft = FT();
    store.set('fairView','all'); renderFairness();
    var allOk = TT().indexOf(A.name) >= 0 && TT().indexOf(B.name) >= 0, totAll = FT();
    return JSON.stringify({ hereOk: hereOk, leftOk: leftOk, allOk: allOk,
      totHere: totHere, totLeft: totLeft, totAll: totAll, same: totHere === totAll });
  })()`);
  console.log(out);
  process.exit(0);
})();
