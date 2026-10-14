#!/usr/bin/env node
// Regenerates data/snapshot.js so the site still shows recent headlines
// when opened offline or directly from disk (file://).
// Run:  node refresh.mjs        (tip: schedule with cron every 30 min)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCES = [
  { id: "gma", name: "GMA News", feed: "https://data.gmanetwork.com/gno/rss/money/feed.xml", via: "jinafeedburner", host: "gmanetwork.com", path: "/story/" },
  { id: "rappler", name: "Rappler", feed: "https://www.rappler.com/business/feed/", via: "jina" },
  { id: "manilatimes", name: "The Manila Times", feed: "https://www.manilatimes.net/business/feed/", via: "jina" },
  { id: "interaksyon", name: "Interaksyon Business", feed: "https://interaksyon.philstar.com/business/feed/", via: "jina" },
  { id: "bilyonaryo", name: "Bilyonaryo", feed: "https://www.bilyonaryo.com/feed/", via: "jina" },
  { id: "fintechnews", name: "FinTech News Philippines", feed: "https://fintechnews.ph/feed", via: "jina" },
];

const PAID_HOSTS = ["bworldonline.com", "business.inquirer.net", "inquirer.net", "philstar.com", "mb.com.ph"];
const PER_FEED = 30;
const MAX_AGE_DAYS = 21;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const isPaid = (u) => PAID_HOSTS.includes(hostOf(u));
const clean = (t) => { const s = String(t || "").replace(/\s+/g, " ").replace(/\s*[-|–]\s*(GMA News Online|Rappler|The Manila Times|Interaksyon|Bilyonaryo|FinTech News Philippines).*$/i, "").trim(); return s.length > 150 ? s.slice(0, 149).trimEnd() + "…" : s; };
const key = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
const when = (v) => { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); };
const decode = (s) => String(s).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();
const stripTags = (h) => decode(String(h).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
const dateFromUrl = (u) => { const m = String(u || "").match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//); return m ? when(`${m[1]}-${m[2]}-${m[3]}`) : 0; };

async function get(url, headers) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(res.status);
  return res.text();
}

async function viaRss2json(feed) {
  const data = JSON.parse(await get(`https://api.rss2json.com/v1/api.json?count=${PER_FEED}&rss_url=${encodeURIComponent(feed)}`));
  if (data.status !== "ok" || !Array.isArray(data.items)) throw new Error("rss2json status");
  return data.items.map((i) => ({ title: clean(i.title), link: i.link || i.guid, date: when(i.pubDate) }));
}

const DATE_RE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)|([A-Z][a-z]{2},\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4})/;

async function viaJina(feed) {
  const text = await get(`https://r.jina.ai/${feed}`, { "X-Return-Format": "markdown" });
  const re = /^#{2,6}\s+\[(.+?)\]\((\S+?)\)\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) heads.push({ title: clean(m[1]), link: m[2], start: re.lastIndex });
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? text.indexOf("\n", heads[i + 1].start) : text.length;
    const dm = text.slice(h.start, end).match(DATE_RE);
    return { title: h.title, link: h.link, date: dm ? when(dm[0]) : 0 };
  });
}

async function viaJinaHtml(feed, host, path) {
  const html = await get(`https://r.jina.ai/${feed}`, { "X-Return-Format": "html" });
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
    const title = clean(stripTags(m[2]));
    if (title.length < 15) continue;
    seen.add(href);
    out.push({ title, link: href, date: 0 });
  }
  return out;
}

async function viaJinaFeedBurner(feed, host, path) {
  const html = await get(`https://r.jina.ai/${feed}`, { "X-Return-Format": "html" });
  const blocks = html.split(/class="regularitem"/i).slice(1);
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    const a = b.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = a[1];
    if (!href.includes(host) || (path && !href.includes(path))) continue;
    if (seen.has(href)) continue;
    const title = clean(stripTags(a[2]));
    if (title.length < 15) continue;
    const d = b.match(/Posted:\s*(?:<\/span>)?\s*([^<]+)/i);
    seen.add(href);
    out.push({ title, link: href, date: d ? when(d[1].trim()) : 0 });
  }
  return out;
}

async function viaXml(feed) {
  const text = await get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(feed)}`);
  const blocks = [...text.matchAll(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g)].map((m) => m[0]);
  if (!blocks.length) throw new Error("no items");
  return blocks.map((b) => {
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || (b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || (b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1];
    const date = (b.match(/<(?:pubDate|dc:date|published|updated|date)[^>]*>([\s\S]*?)<\//i) || [])[1];
    return { title: clean(decode(title || "")), link: decode(link || ""), date: when(decode(date || "")) };
  });
}

async function fetchSource(src) {
  const order = src.via === "jinafeedburner"
    ? [() => viaJinaFeedBurner(src.feed, src.host, src.path), () => viaRss2json(src.feed), () => viaXml(src.feed)]
    : src.via === "jinahtml"
    ? [() => viaJinaHtml(src.feed, src.host, src.path), () => viaRss2json(src.feed), () => viaJina(src.feed), () => viaXml(src.feed)]
    : src.via === "jina"
      ? [() => viaJina(src.feed), () => viaRss2json(src.feed), () => viaXml(src.feed)]
      : [() => viaRss2json(src.feed), () => viaJina(src.feed), () => viaXml(src.feed)];
  for (const fn of order) {
    try {
      const items = (await fn()).filter((i) => i.title && i.link);
      if (items.length) return items;
    } catch (_) {}
  }
  return [];
}

const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const seen = new Set();
const items = [];
let live = 0;

const results = await Promise.allSettled(SOURCES.map(async (s) => ({ s, items: await fetchSource(s) })));
for (const r of results) {
  if (r.status !== "fulfilled" || !r.value.items.length) continue;
  live++;
  for (const it of r.value.items) {
    if (isPaid(it.link)) continue;
    const date = it.date || dateFromUrl(it.link);
    if (date && date < cutoff) continue;
    const k = key(it.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push({ title: it.title, link: it.link, date, source: r.value.s.name, sourceId: r.value.s.id });
    if (items.length >= 140) break;
  }
}

items.sort((a, b) => (b.date || 0) - (a.date || 0));

const snapshot = { updated: Date.now(), live, items };
const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, "data", "snapshot.js");
await writeFile(out, "window.PHILBIZ_SNAPSHOT = " + JSON.stringify(snapshot) + ";\n");
console.log(`wrote ${out} — ${items.length} headlines from ${live}/${SOURCES.length} wires`);
