/* locum-dialog-probe.js — DOES THE NAME BOX ACTUALLY FIND SOMEBODY ALREADY ON THE UNIT?
 *
 * render-tests.js asserts this from the SOURCE, and source assertions are not enough on their
 * own: on 11 Sept a `[hidden]` attribute was set correctly and read correctly and the element
 * stayed on screen anyway, because a flex rule outranked it. So anything that has to BEHAVE gets
 * driven for real as well.
 *
 * What it drives. Cover booked at short notice is very often one of our own doing an extra shift,
 * and Allocate does not know yet — so the picker cannot offer them and the only door left is the
 * free-text "Add a one-off person" box. That box used to mint a blank stranger, which is how the
 * unit came to have two Cathryn Lathams, and how the Optima check then came to offer to remove
 * the cover that had just been arranged (Ali, 26.09.11: "itll be a locum cover that hasnt reached
 * allocate... if exist allow to select").
 *
 * So: type a few letters, expect the real person offered; pick them; press Add; then check that
 * NO new record was made, that the person on the shift is the real one with their grade intact,
 * and that the Optima check leaves them alone — while still raising a shift Allocate has dropped.
 *
 *   node tests/locum-dialog-probe.js        (needs jsdom on NODE_PATH)
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "index.html");

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : ""));
         console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}
function report(){
  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  if (failures.length){ console.log("Failures:"); failures.forEach(f => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
}

/* Same inlining the other probes use: jsdom has no working origin, so a <script src> fetches
   nothing and the file under test quietly runs its degraded path. Escape the closing tag — an
   HTML parser ends a <script> at the first one it sees, even inside a comment. */
function inline(html, file){
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return html;
  const body = fs.readFileSync(p, "utf8");
  if (file.endsWith(".css"))
    return html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, () => "<style>" + body + "</style>");
  const safe = body.replace(/<\/script/gi, "<\\/script");
  return html.replace(new RegExp('<script src="' + file.replace(".", "\\.") + '[^"]*"><\\/script>'),
                      () => "<script>" + safe + "</script>");
}

const SEED = `(function(){
  const T = todayISO(), K = mondayOf(T);
  data.staffPw = "seeded-hash"; store.sset("staffUnlocked", "1");
  currentWeekKey = K;
  const wk = getWeek(K);
  const mk = (id, name, grade, extra) => { data.staff.push(Object.assign({ id: id, name: name,
    grade: grade, active: true, adhoc: false, aliases: [] }, extra || {})); return id; };
  mk("r1", "Cathryn Latham", "ACCP", { airway: true, nights: true, transfer: true });
  mk("r2", "Shadman Zaman", "ST", { transfer: true, nights: true });
  mk("r3", "Catherine Bowen", "CT", { nights: true });
  wk.roster = wk.roster || {};
  wk.roster[T] = { r1:{code:"LD",kind:"day",src:"a"}, r2:{code:"LD",kind:"day",src:"a"},
                   r3:{code:"SD",kind:"day",src:"a"} };
  const di = Math.round((new Date(T) - new Date(K)) / 86400000);
  wk.days[di] = blankDay();
  window.__DI = di;
})();`;

(async () => {
  let html = fs.readFileSync(APP, "utf8");
  ["core.css", "core.js", "strength.js", "planner.js", "podcost.js"].forEach(f => { html = inline(html, f); });
  html = html.replace(/<script src="k\.js[^"]*"><\/script>/,
    '<script>window.__POD_KEYS = { r: "https://example.invalid/read", s: "https://example.invalid/save" };</script>');
  html = html.replace("startUp();", "try{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");

  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w){
      w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {};
      w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
    } });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 900));

  console.log("=== Locum dialog probe ===");
  /* `data` and the page's functions are script-scoped, not window properties, so everything
     here goes through w.eval — the same way render-tests.js reaches them. */
  const ev = expr => w.eval(expr);
  ok("the page booted", ev("typeof data === 'object' && Array.isArray(data.staff)"));
  if (!ev("typeof data === 'object'")) return report();
  ev(SEED);
  ev("try{ renderAll(); }catch(e){}");

  const di = w.__DI;
  const real = ev('data.staff.find(function(s){return s.id==="r1"})');
  ok("the fixture has a real ACCP to match against", !!(real && real.grade === "ACCP"));
  if (!real) return report();

  console.log("\n-- the matcher --");
  ok("finds them from the first few letters",
     ev("adhocMatches")("Cath").some(x => x.id === "r1"));
  ok("...and offers the other near-name too, so you can tell them apart",
     ev("adhocMatches")("Cath").some(x => x.id === "r3"));
  ok("...finds them from the surname on its own",
     ev("adhocMatches")("Latham").some(x => x.id === "r1"));
  ok("...two letters is the floor, so one letter offers nobody",
     ev("adhocMatches")("C").length === 0);
  ok("...and a genuine stranger matches nobody",
     ev("adhocMatches")("Qzyx Vremble").length === 0);
  ok("a match is described by its grade and skills",
     /ACCP/.test(ev("adhocDesc")(real)) && /airway/.test(ev("adhocDesc")(real)));

  console.log("\n-- driving the dialog --");
  const before = ev("data.staff.length");
  ev("adhocDialog")(di, "", "night");
  const box = w.document.querySelector("#modal input[type=text]");
  ok("the dialog opened with a name box", !!box);
  if (!box) return report();

  box.value = "Cath"; box.oninput();
  const rows = [...w.document.querySelectorAll("#modal .adres .adrow")];
  ok("typing offers rows to pick from", rows.length > 0, rows.length + " row(s)");
  ok("...one of which is the real person",
     rows.some(r => (r.textContent || "").includes("Cathryn Latham")));
  ok("...and the last row is always the way to add somebody genuinely new",
     rows.length > 0 && rows[rows.length - 1].classList.contains("adnew"));

  rows.find(r => (r.textContent || "").includes("Cathryn Latham")).click();
  const pick = w.document.querySelector("#modal .adpick");
  ok("picking them shows who you picked", !!pick);
  ok("...with the grade on it, so a wrong pick is visible",
     !!pick && /ACCP/.test(pick.textContent || ""));

  const addBtn = [...w.document.querySelectorAll("#modal button")].find(b => b.textContent.trim() === "Add");
  ok("there is an Add button", !!addBtn);
  if (!addBtn) return report();
  ev("try{ EDIT_MODE = true; }catch(e){}");
  addBtn.click();

  console.log("\n-- what it did --");
  ok("NO second record was invented", ev("data.staff.length") === before,
     before + " -> " + ev("data.staff.length"));
  const day = ev("data.weeks[currentWeekKey].days[" + di + "]");
  ok("the real person is the one on the night team",
     !!(day.night && (day.night.CDE || []).includes("r1")));
  ok("...so the allocator still sees their ACCP grade and their airway skill",
     ev('staffById("r1")').grade === "ACCP" && ev('staffById("r1")').airway === true);
  ok("...and nobody was left looking like a brand-new starter",
     ev('staffById("r1")').triaged === true);
  ok("the day records that they were put in on purpose",
     !!(day.handAdded && day.handAdded.r1));

  console.log("\n-- and the loop is broken --");
  const ghosts = ev("srDetectGhosts()");
  ok("the Optima check does not turn round and offer to remove them",
     !ghosts.some(g => g.sid === "r1"), ghosts.map(g => g.name).join(", ") || "no ghosts");

  /* The check must still do the job it exists for. Put somebody in the day who was NOT added
     by hand and take their shift off Allocate — that is a real dropped shift and must be raised. */
  ev("delete data.weeks[currentWeekKey].roster[addDays(currentWeekKey," + di + ")].r3");
  day.shadow = day.shadow || []; day.shadow.push("r3");
  const g2 = ev("srDetectGhosts()");
  ok("...but a shift Allocate really has dropped is still raised",
     g2.some(g => g.sid === "r3"), g2.map(g => g.name).join(", ") || "none");

  report();
})().catch(e => { console.error(e); process.exit(1); });
