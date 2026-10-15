#!/usr/bin/env node
/**
 * Fetch all Ticketly Stitch screens (HTML + screenshots + metadata).
 *
 * Requires one of:
 *   STITCH_API_KEY          (X-Goog-Api-Key)
 *   STITCH_ACCESS_TOKEN + GOOGLE_CLOUD_PROJECT  (OAuth Bearer)
 *
 * Usage:
 *   STITCH_API_KEY=... node scripts/fetch-stitch-screens.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ID = "16462286503999379148";
const SCREEN_IDS = [
  "05788bcfcf5148c39e994780d11220f7",
  "7cb0eb8cfb044a46a1b5c0e410005b86",
  "98346e1454ce4af1ae4136ba4dc0106f",
  "c8bbe420d4834503b2d675966300c923",
  "b2c9b2936a114ec5a709be75da6f88bc",
  "65b7750422c145adac7031d67a5390e2",
  "30d8c3292714482bb65a2aa5a24afe02",
  "2b2b13e7935647a7b0b68f521c2dba2e",
  "98e7c8b20f0d48b3b2989903878be72c",
  "75beb49d5e774f7fbeca675600f17d68",
  "f1e85b531db8481296da369ae57e3248",
  "edc6ba5ffc8c47fcbb94f40115cc8879",
  "ddcd6591320a4276987c570373455490",
  "48bfc5bbcedc4f2db5664e43727724ba",
  "853093c953c44cb0988de0faf3c17a0f",
  "3d2d173a96174b189802877add64f124",
  "2621594be47a43849b52686b30510500",
];

const MCP_URL = process.env.STITCH_HOST || "https://stitch.googleapis.com/mcp";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "design", "stitch");

function authHeaders() {
  const apiKey = process.env.STITCH_API_KEY?.trim();
  if (apiKey) return { "X-Goog-Api-Key": apiKey };
  const token = process.env.STITCH_ACCESS_TOKEN?.trim();
  if (token) return { Authorization: `Bearer ${token}` };
  throw new Error(
    "Missing Stitch auth. Set STITCH_API_KEY or STITCH_ACCESS_TOKEN (+ GOOGLE_CLOUD_PROJECT)."
  );
}

async function mcpCall(toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const text = await res.text();
  let payload = text;
  if (text.includes("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (line) payload = line.slice(5).trim();
  }
  const json = JSON.parse(payload);
  if (json.error) throw new Error(JSON.stringify(json.error));
  if (json.result?.isError) {
    const msg = json.result.content?.map((c) => c.text).join("\n") || "MCP error";
    throw new Error(msg);
  }
  const content = json.result?.content ?? [];
  const textParts = content.filter((c) => c.type === "text").map((c) => c.text);
  const joined = textParts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    return { raw: joined, content };
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed ${res.status} ${url.slice(0, 80)}`);
  await pipeline(res.body, createWriteStream(dest));
}

function pickDownloadUrl(file) {
  if (!file) return null;
  return file.downloadUrl || file.uri || file.url || null;
}

async function main() {
  await mkdir(path.join(OUT, "screens"), { recursive: true });
  await mkdir(path.join(OUT, "html"), { recursive: true });
  await mkdir(path.join(OUT, "meta"), { recursive: true });
  await mkdir(path.join(OUT, "assets"), { recursive: true });

  console.log("Fetching project", PROJECT_ID);
  let project;
  try {
    project = await mcpCall("get_project", { name: `projects/${PROJECT_ID}` });
    await writeFile(path.join(OUT, "meta", "project.json"), JSON.stringify(project, null, 2));
  } catch (e) {
    console.warn("get_project failed:", e.message);
  }

  const index = [];
  for (const screenId of SCREEN_IDS) {
    const name = `projects/${PROJECT_ID}/screens/${screenId}`;
    console.log("get_screen", screenId);
    const screen = await mcpCall("get_screen", { name });
    await writeFile(
      path.join(OUT, "meta", `${screenId}.json`),
      JSON.stringify(screen, null, 2)
    );

    const htmlUrl = pickDownloadUrl(screen.htmlCode);
    const shotUrl = pickDownloadUrl(screen.screenshot);
    let htmlPath = null;
    let shotPath = null;

    if (htmlUrl) {
      htmlPath = path.join(OUT, "html", `${screenId}.html`);
      await download(htmlUrl, htmlPath);
    }
    if (shotUrl) {
      const ext = shotUrl.includes(".png") ? "png" : "webp";
      shotPath = path.join(OUT, "screens", `${screenId}.${ext}`);
      await download(shotUrl, shotPath);
    }

    index.push({
      screenId,
      title: screen.title || null,
      deviceType: screen.deviceType || null,
      width: screen.width || null,
      height: screen.height || null,
      htmlPath: htmlPath ? path.relative(ROOT, htmlPath) : null,
      screenshotPath: shotPath ? path.relative(ROOT, shotPath) : null,
      htmlUrl: htmlUrl ? "(downloaded)" : null,
      screenshotUrl: shotUrl ? "(downloaded)" : null,
    });
  }

  await writeFile(path.join(OUT, "meta", "index.json"), JSON.stringify(index, null, 2));
  console.log("Done. Wrote", index.length, "screens to design/stitch/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
