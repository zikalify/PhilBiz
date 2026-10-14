"use strict";

const CONFIG = {
  refreshMs: 8 * 60 * 1000,
  maxAgeDays: 21,
  perFeed: 30,
  newMs: 3 * 60 * 60 * 1000,
  cacheKey: "philbiz.cache.v1",
  cacheMs: 30 * 60 * 1000,
};

const SOURCES = [
  { id: "gma", name: "GMA News", section: "Money", home: "https://www.gmanetwork.com/news/money/", feed: "https://data.gmanetwork.com/gno/rss/money/feed.xml", via: "jinafeedburner", host: "gmanetwork.com", path: "/story/" },
  { id: "rappler", name: "Rappler", section: "Business", home: "https://www.rappler.com/business/", feed: "https://www.rappler.com/business/feed/", via: "jina" },
  { id: "manilatimes", name: "The Manila Times", section: "Business", home: "https://www.manilatimes.net/business", feed: "https://www.manilatimes.net/business/feed/", via: "jina" },
  { id: "interaksyon", name: "Interaksyon Business", section: "Business", home: "https://interaksyon.philstar.com/business/", feed: "https://interaksyon.philstar.com/business/feed/", via: "jina" },
  { id: "bilyonaryo", name: "Bilyonaryo", section: "Business", home: "https://bilyonaryo.com/", feed: "https://www.bilyonaryo.com/feed/", via: "jina" },
  { id: "fintechnews", name: "FinTech News Philippines", section: "Fintech", home: "https://fintechnews.ph/", feed: "https://fintechnews.ph/feed", via: "jina" },
];

const PAID_HOSTS = ["bworldonline.com", "business.inquirer.net", "inquirer.net", "philstar.com", "mb.com.ph"];

const RSS2JSON = "https://api.rss2json.com/v1/api.json?count=" + CONFIG.perFeed + "&rss_url=";
const JINA = "https://r.jina.ai/";
const XML_PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];

const els = {
  lead: document.getElementById("lead"),
  wire: document.getElementById("wire"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
  stats: document.getElementById("stats"),
  clock: document.getElementById("clock"),
  dateline: document.getElementById("dateline"),
  filter: document.getElementById("filter"),
  refresh: document.getElementById("refresh"),
};

let state = { items: [], updated: 0, loading: false };

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch (_) { return ""; }
}

function isPaid(url) {
  const h = hostOf(url);
  return PAID_HOSTS.includes(h);
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-|–]\s*(GMA News Online|Rappler|The Manila Times|Interaksyon|Bilyonaryo|FinTech News Philippines).*$/i, "")
    .trim();
}

function normKey(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

function parseDate(value) {
  if (!value) return 0;
  const d = new Date(value);
  return isNaN(d) ? 0 : d.getTime();
}

function dateFromUrl(url) {
  const m = String(url || "").match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? 0 : d.getTime();
}

function stripTags(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  return d.textContent || "";
}

async function fetchRss2json(feed) {
  const res = await fetch(RSS2JSON + encodeURIComponent(feed), { cache: "no-store" });
  if (!res.ok) throw new Error("rss2json " + res.status);
  const data = await res.json();
  if (data.status !== "ok" || !Array.isArray(data.items)) throw new Error("rss2json bad");
  return data.items.map((it) => ({ title: cleanTitle(it.title), link: it.link || it.guid, date: parseDate(it.pubDate) }));
}

const DATE_RE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)|([A-Z][a-z]{2},\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4})/;

async function fetchJina(feed) {
  const res = await fetch(JINA + feed, { headers: { "X-Return-Format": "markdown" }, cache: "no-store" });
  if (!res.ok) throw new Error("jina " + res.status);
  const text = await res.text();
  const re = /^#{2,6}\s+\[(.+?)\]\((\S+?)\)\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) heads.push({ title: cleanTitle(m[1]), link: m[2], start: re.lastIndex });
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? text.indexOf("\n", heads[i + 1].start) : text.length;
    const dm = text.slice(h.start, end).match(DATE_RE);
    return { title: h.title, link: h.link, date: dm ? parseDate(dm[0]) : 0 };
  });
}

async function fetchJinaHtml(feed, host, path) {
  const res = await fetch(JINA + feed, { headers: { "X-Return-Format": "html" }, cache: "no-store" });
  if (!res.ok) throw new Error("jina " + res.status);
  const html = await res.text();
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!/^https?:/i.test(href)) continue;
    const h = hostOf(href);
    if (!(h === host || h.endsWith("." + host))) continue;
    if (path && !href.includes(path)) continue;
    if (seen.has(href)) continue;
    const title = cleanTitle(stripTags(m[2]));
    if (title.length < 15) continue;
    seen.add(href);
    out.push({ title, link: href, date: 0 });
  }
  return out;
}

async function fetchJinaFeedBurner(feed, host, path) {
  const res = await fetch(JINA + feed, { headers: { "X-Return-Format": "html" }, cache: "no-store" });
  if (!res.ok) throw new Error("jina " + res.status);
  const html = await res.text();
  const blocks = html.split(/class="regularitem"/i).slice(1);
  const out = [];
  const seen = new Set();
  for (const b of blocks) {
    const a = b.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = a[1];
    if (!href.includes(host) || (path && !href.includes(path))) continue;
    if (seen.has(href)) continue;
    const title = cleanTitle(stripTags(a[2]));
    if (title.length < 15) continue;
    const d = b.match(/Posted:\s*(?:<\/span>)?\s*([^<]+)/i);
    seen.add(href);
    out.push({ title, link: href, date: d ? parseDate(d[1].trim()) : 0 });
  }
  return out;
}

async function fetchXmlProxy(feed) {
  let lastErr;
  for (const proxy of XML_PROXIES) {
    try {
      const res = await fetch(proxy(feed), { cache: "no-store" });
      if (!res.ok) throw new Error("proxy " + res.status);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.querySelector("parsererror")) throw new Error("xml parse");
      const nodes = doc.querySelectorAll("item, entry");
      if (!nodes.length) throw new Error("no items");
      const out = [];
      nodes.forEach((n) => {
        const get = (sel) => (n.querySelector(sel) ? n.querySelector(sel).textContent.trim() : "");
        let link = get("link");
        if (!link) {
          for (const l of n.getElementsByTagName("link")) {
            if (l.getAttribute && l.getAttribute("href")) { link = l.getAttribute("href"); break; }
          }
        }
        if (!link) link = get("guid");
        out.push({ title: cleanTitle(get("title")), link, date: parseDate(get("pubDate") || get("date") || get("published") || get("updated")) });
      });
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("xml failed");
}

function chainsFor(src) {
  const md = () => fetchJina(src.feed);
  const html = () => fetchJinaHtml(src.feed, src.host, src.path);
  const fb = () => fetchJinaFeedBurner(src.feed, src.host, src.path);
  const r2j = () => fetchRss2json(src.feed);
  const xml = () => fetchXmlProxy(src.feed);
  if (src.via === "jinafeedburner") return [fb, r2j, xml];
  if (src.via === "jinahtml") return [html, r2j, md, xml];
  if (src.via === "jina") return [md, r2j, xml];
  return [r2j, md, xml];
}

async function fetchFeed(src) {
  let lastErr;
  for (const fn of chainsFor(src)) {
    try {
      const items = (await fn()).filter((i) => i.title && i.link);
      if (items.length) return items;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("empty");
}

function collect(raw) {
  const cutoff = Date.now() - CONFIG.maxAgeDays * 864e5;
  const seen = new Set();
  const out = [];
  raw.forEach(({ src, items }) => {
    items.forEach((it) => {
      if (!it.link || isPaid(it.link)) return;
      const date = it.date || dateFromUrl(it.link);
      if (date && date < cutoff) return;
      const key = normKey(it.title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ title: it.title, link: it.link, date, source: src.name, sourceId: src.id });
    });
  });
  out.sort((a, b) => (b.date || 0) - (a.date || 0));
  return out;
}

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function itemHtml(it) {
  const fresh = it.date && Date.now() - it.date < CONFIG.newMs ? ' <span class="new-badge">NEW</span>' : "";
  const meta = [it.source, relTime(it.date)].filter(Boolean).join(" · ");
  return (
    '<li data-search="' + escapeHtml((it.title + " " + it.source).toLowerCase()) + '">' +
    '<a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.title) + "</a>" +
    fresh +
    '<span class="time">' + escapeHtml(meta) + "</span>" +
    "</li>"
  );
}

function render() {
  const items = state.items;
  els.wire.innerHTML = "";
  els.lead.innerHTML = "";

  if (!items.length) { els.empty.hidden = false; return; }
  els.empty.hidden = true;

  const leadItems = items.slice(0, Math.min(9, items.length));
  els.lead.innerHTML =
    '<h2>Top of the wire <span class="count">' + leadItems.length + "</span></h2>" +
    '<ul class="headlines">' + leadItems.map(itemHtml).join("") + "</ul>";

  const order = SOURCES.map((s) => s.id);
  const groups = new Map();
  items.forEach((it) => {
    if (leadItems.includes(it)) return;
    if (!groups.has(it.sourceId)) groups.set(it.sourceId, { name: it.source, items: [] });
    groups.get(it.sourceId).items.push(it);
  });

  const frag = document.createDocumentFragment();
  [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .forEach(([, g]) => {
      const sec = document.createElement("section");
      sec.className = "section";
      sec.innerHTML =
        "<h2>" + escapeHtml(g.name) + ' <span class="count">' + g.items.length + "</span></h2>" +
        '<ul class="headlines">' + g.items.map(itemHtml).join("") + "</ul>";
      frag.appendChild(sec);
    });
  els.wire.appendChild(frag);

  els.stats.textContent = items.length + " headlines from " + groups.size + " free-to-read wires.";
  applyFilter();
}

function setStatus(text) { els.status.textContent = text; }

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CONFIG.cacheKey) || "null");
    return data && data.items && data.items.length ? data : null;
  } catch (_) { return null; }
}
function writeCache() {
  try { localStorage.setItem(CONFIG.cacheKey, JSON.stringify({ updated: state.updated, items: state.items })); }
  catch (_) {}
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  els.refresh.disabled = true;

  const cached = readCache();
  if (!state.items.length && cached) { state.items = cached.items; state.updated = cached.updated; render(); }

  setStatus("Updating wire…");
  const results = await Promise.allSettled(SOURCES.map(async (src) => ({ src, items: await fetchFeed(src) })));
  const raw = [];
  let ok = 0;
  results.forEach((r) => { if (r.status === "fulfilled" && r.value.items.length) { raw.push(r.value); ok++; } });

  if (ok) {
    state.items = collect(raw);
    state.updated = Date.now();
    writeCache();
    render();
    setStatus("Live · " + ok + "/" + SOURCES.length + " wires · updated " + new Date(state.updated).toLocaleTimeString());
  } else if (state.items.length) {
    setStatus("Offline — last saved wire · " + new Date(state.updated || Date.now()).toLocaleTimeString());
  } else if (cached) {
    state.items = cached.items; state.updated = cached.updated; render();
    setStatus("Offline — cached wire");
  } else if (window.PHILBIZ_SNAPSHOT && window.PHILBIZ_SNAPSHOT.items.length) {
    state.items = window.PHILBIZ_SNAPSHOT.items;
    state.updated = window.PHILBIZ_SNAPSHOT.updated;
    render();
    setStatus("Offline — saved snapshot");
  } else {
    setStatus("No connection");
    render();
  }
  state.loading = false;
  els.refresh.disabled = false;
}

function applyFilter() {
  const q = els.filter.value.trim().toLowerCase();
  document.querySelectorAll("ul.headlines li").forEach((li) => {
    li.style.display = !q || (li.dataset.search || "").includes(q) ? "" : "none";
  });
}

function tickClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  els.dateline.textContent = now.toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

els.refresh.addEventListener("click", () => refresh());
els.filter.addEventListener("input", applyFilter);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - state.updated > CONFIG.refreshMs) refresh();
});

tickClock();
setInterval(tickClock, 30 * 1000);
setInterval(refresh, CONFIG.refreshMs);

(function init() {
  const cached = readCache();
  if (cached && Date.now() - cached.updated < CONFIG.cacheMs) {
    state.items = cached.items;
    state.updated = cached.updated;
    render();
    setStatus("Cached · updated " + new Date(cached.updated).toLocaleTimeString());
  } else if (window.PHILBIZ_SNAPSHOT && window.PHILBIZ_SNAPSHOT.items.length) {
    state.items = window.PHILBIZ_SNAPSHOT.items;
    state.updated = window.PHILBIZ_SNAPSHOT.updated;
    render();
    setStatus("Snapshot loaded · refreshing…");
  }
  refresh();
})();
