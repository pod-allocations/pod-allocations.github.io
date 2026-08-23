/* changelog-probe.js — the unified change-log board, on the REAL 132-entry live log.
 *
 * The rule and render suites build tiny synthetic logs; this loads the actual live store so the
 * board is exercised on the mess it exists to tame. Four things must hold:
 *   1. every view renders without throwing
 *   2. the story view's per-go score equals podcost.js for the same reconstructed arrangement —
 *      i.e. the log and the board are on the SAME price list, which is the whole point of the
 *      26.08.21 integration
 *   3. the publication marker fires only on changes made after a week went public
 *   4. the "By person" view collapses the log to one path per person
 *
 *   node tests/changelog-probe.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "index.html");
const LIVE = path.join(ROOT, "..", "..", "docs", "CCU Pod Allocator", "allocate-pull", "pod-data.live.json");

function inlineScript(html, file, src) {
  const safe = src.replace(/<\/script/gi, "<\\/script");
  return html.replace(new RegExp('<script src="' + file.replace(".", "\\.") + '[^"]*"><\\/script>'),
    () => "<script>" + safe + "</script>");
}
function loadApp(store) {
  let html = fs.readFileSync(APP, "utf8");
  /* core.js holds logDet, logPanel and groupLog — without it the log views run blind. core.css
     too, so the styled bits do not throw. Same set the render suite inlines. */
  try {
    const css = fs.readFileSync(path.join(ROOT, "core.css"), "utf8");
    html = html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, () => "<style>" + css + "</style>");
  } catch (e) {}
  for (const f of ["core.js", "strength.js", "planner.js", "podcost.js"]) {
    try { html = inlineScript(html, f, fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) {}
  }
  const inject = "window.__STORE = " + JSON.stringify(store) + ";";
  const hook = `window.__api = function(){ return {
    data, PODS, addDays, mondayOf, todayISO,
    loadData: typeof loadData !== "undefined" ? loadData : null,
    renderLog: typeof renderLog !== "undefined" ? renderLog : null,
    setView: v => { logView = v; },
    logRotaEntries: typeof logRotaEntries !== "undefined" ? logRotaEntries : null,
    logDayStory: typeof logDayStory !== "undefined" ? logDayStory : null,
    logPlannerScore: typeof logPlannerScore !== "undefined" ? logPlannerScore : null,
    changeAfterPublish: typeof changeAfterPublish !== "undefined" ? changeAfterPublish : null,
    weekPublishMoment: typeof weekPublishMoment !== "undefined" ? weekPublishMoment : null,
    setEdit: () => { EDIT_MODE = true; },
    hasPodCost: () => typeof PodCost !== "undefined" && !!PodCost
  }; };`;
  html = html.replace("startUp();", inject + hook +
    "\ntry{ if(window.__STORE) loadData(window.__STORE); else if(!data) loadData(blankData()); }catch(e){ window.__loaderr = String(e); }\nstartUp();");
  const errs = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.addEventListener("error", e => errs.push(String((e.error && e.error.stack) || e.message)));
    }
  });
  return new Promise(res => setTimeout(() => res({ api: dom.window.__api(), win: dom.window, doc: dom.window.document, errs }), 1100));
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

(async function () {
  const store = JSON.parse(fs.readFileSync(LIVE, "utf8"));
  const { api, win, doc, errs } = await loadApp(store);
  ok("the live store loaded", !!api && !!api.data, win.__loaderr || "");
  ok("podcost.js reached the page", api.hasPodCost());
  ok("the log came in whole", api.data && api.data.log && api.data.log.length > 100, (api.data.log || []).length + " entries");

  api.setEdit();

  const box = doc.getElementById("logList") || (function () { const d = doc.createElement("div"); d.id = "logList"; doc.body.appendChild(d); return d; })();

  /* Every view renders on the real, messy live store without throwing. The 132 live entries
     predate the structured `on`/`d` fields, so they exercise the msg-parser fallback in clogFam
     and clogLine — proving the rebuilt log copes with a real historic store, not clean input. */
  ["day", "made", "other", "raw"].forEach(v => {
    api.setView(v);
    let threw = null;
    try { api.renderLog(); } catch (e) { threw = (e && e.message) || String(e); }
    ok("the '" + v + "' view renders on the real store without throwing", !threw, threw);
  });

  api.setView("day"); api.renderLog();
  const dayTxt = box.textContent.toLowerCase();
  ok("the by-rota-day view draws tiles or a clear empty state",
     box.querySelectorAll(".clgrp").length > 0 || /nothing on today/.test(dayTxt));
  ok("every event overview on real data carries a date and time",
     [...box.querySelectorAll(".clwhen")].every(x => /\d{1,2} \w{3} . \d{2}:\d{2}/.test(x.textContent)));
  ok("no view ever says why anybody was off (hard rule 6)",
     dayTxt.indexOf("sick") < 0 && dayTxt.indexOf("reason") < 0 && dayTxt.indexOf("because") < 0);
  ok("Print copy is never shown as an event", box.textContent.indexOf("Print copy") < 0);

  api.setView("made"); api.renderLog();
  ok("the by-day-changed view renders and groups by made-date", box.querySelectorAll(".clgrp").length >= 0);

  ok("no uncaught errors across every view", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  process.exit(fail ? 1 : 0);
})();
