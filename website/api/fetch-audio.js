// Vercel serverless function (preview project only — GitHub Pages ignores
// it). Fetches a public audio file for the Studio's "Import from URL" when
// the hosting site doesn't send CORS headers.
// Guard rails: same-site callers only, http(s) only, no private/loopback
// addresses (checked after DNS and on every redirect), audio content
// types only, 30 MB cap, 20 s timeout, and streaming services refused.
const dns = require("dns").promises;
const net = require("net");

const MAX_BYTES = 30 * 1024 * 1024;
const BLOCKED = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|spotify\.com|scdn\.co|soundcloud\.com|sndcdn\.com|music\.apple\.com|tidal\.com|deezer\.com|netflix\.com|music\.amazon\.)/i;
const OK_TYPES = /^(audio\/|video\/(ogg|webm|mp4)|application\/(ogg|octet-stream))/i;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
    (v.startsWith("::ffff:") && privateIp(v.slice(7)));
}

async function checkUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are allowed.");
  if (BLOCKED.test(u.hostname)) throw new Error("Streaming services can't be fetched. Use tab capture for audio you have rights to.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("That address isn't reachable from here.");
}

function sameSite(req) {
  const site = req.headers["sec-fetch-site"];
  if (site === "same-origin") return true;
  const origin = req.headers.origin || "";
  return /^https:\/\/([a-z0-9-]+\.)*(mydawsons\.com|vercel\.app)$/i.test(origin) && /mydawsons/i.test(origin);
}

module.exports = async (req, res) => {
  const fail = (code, error) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error }));
  };
  if (req.method !== "GET") return fail(405, "GET only");
  if (!sameSite(req)) return fail(403, "This helper only serves the MyDawsons Studio.");
  let target;
  try {
    target = new URL(String(new URL(req.url, "http://x").searchParams.get("url") || ""));
  } catch {
    return fail(400, "Missing or invalid url.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    let r;
    for (let hop = 0; hop < 4; hop++) {
      await checkUrl(target);
      r = await fetch(target.href, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "MyDawsonsStudio/2 (+https://mydawsons.com/studio/)" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        target = new URL(r.headers.get("location"), target);
        continue;
      }
      break;
    }
    if (!r || !r.ok) return fail(502, `The site answered ${r ? r.status : "nothing"}.`);
    const type = r.headers.get("content-type") || "application/octet-stream";
    if (!OK_TYPES.test(type)) return fail(415, "That link isn't an audio file (it looks like a web page). Link straight to the .mp3/.wav/.ogg file.");
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return fail(413, "That file is over 30 MB.");
    const chunks = [];
    let total = 0;
    for await (const chunk of r.body) {
      total += chunk.length;
      if (total > MAX_BYTES) return fail(413, "That file is over 30 MB.");
      chunks.push(chunk);
    }
    res.statusCode = 200;
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "private, max-age=600");
    res.end(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  } catch (e) {
    return fail(e.name === "AbortError" ? 504 : 400, e.name === "AbortError" ? "The site took too long." : e.message || "Fetch failed.");
  } finally {
    clearTimeout(timer);
  }
};
