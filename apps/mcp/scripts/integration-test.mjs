// End-to-end test of the MCP server, driven over stdio exactly as Claude Desktop
// or Claude Code would drive it. Needs a running app server:
//   npm run dev:server   (in another terminal)
//   npm run test:mcp
// Safe to run repeatedly — it signs in if setup is already done.
// Drives the MCP server over stdio, exactly as Claude Desktop / Claude Code would.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the server entry from this file, not the cwd, so the script works
// whether it is run from the repo root or from apps/mcp.
const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");

const BASE = "http://localhost:8080/api/v1";

let failures = 0;
const check = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  }
};

// ---- 1. sign in and mint a token -------------------------------------------
const jar = new Map();
async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

const status = await api("GET", "/setup/status");
if (status.body.needsSetup) {
  await api("POST", "/setup", {
    name: "Wizard",
    email: "dm@example.com",
    password: "correct-horse-battery",
    worldName: "BloodEarth",
  });
} else {
  await api("POST", "/auth/login", { email: "dm@example.com", password: "correct-horse-battery" });
}

const worlds = (await api("GET", "/worlds")).body.worlds;
const world = worlds[0];
const made = await api("POST", "/tokens", {
  name: "mcp integration test",
  worldId: world.id,
  scopes: ["world:write"],
});
const secret = made.body.secret;
check("minted a world-pinned write token", typeof secret === "string", made.body);

// ---- 2. spawn the MCP server and speak JSON-RPC -----------------------------
const child = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", SERVER_ENTRY],
  {
    env: {
      ...process.env,
      DNDWORLDAPP_URL: "http://localhost:8080",
      DNDWORLDAPP_TOKEN: secret,
      DNDWORLDAPP_WORLD: world.id,
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let stderr = "";
child.stderr.on("data", (d) => (stderr += d.toString()));

let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* not a JSON-RPC line */
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const callTool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return {
    text: (r.result?.content ?? []).map((c) => c.text).join("\n"),
    isError: r.result?.isError === true,
    raw: r,
  };
};

console.log("\n== handshake ==");
const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "integration-test", version: "0" },
});
check("initialize succeeded", init.result?.serverInfo?.name === "dndworldapp", init.result?.serverInfo);
check("server sends usage instructions", (init.result?.instructions ?? "").includes("[[Double Brackets]]"));
notify("notifications/initialized");

console.log("\n== tools ==");
const list = await rpc("tools/list", {});
const tools = list.result.tools.map((t) => t.name);
console.log("  registered:", tools.join(", "));
for (const expected of ["get_tree", "find_nodes", "get_node", "create_node", "update_node", "move_node", "create_post"]) {
  check(`${expected} is registered`, tools.includes(expected));
}
const treeTool = list.result.tools.find((t) => t.name === "get_tree");
check("tools carry a JSON schema", typeof treeTool.inputSchema === "object", treeTool?.inputSchema);

console.log("\n== reading ==");
const tree = await callTool("get_tree");
check("get_tree returns an outline", tree.text.includes("- ") && !tree.isError, tree.text.slice(0, 120));

const found = await callTool("find_nodes", { query: "Ciridan" });
check("find_nodes searches", !found.isError, found.text.slice(0, 120));

console.log("\n== writing ==");
const created = await callTool("create_node", {
  title: "MCP Test Page",
  body_md: "Written by the MCP server. Links to [[Ciridan]] and to [[A Page That Does Not Exist]].",
});
check("create_node works", !created.isError && created.text.includes("Created"), created.text);
const newId = created.text.match(/\[([a-z0-9]{8})\]/)?.[1];
check("returned a usable page id", typeof newId === "string", created.text);

const fetched = await callTool("get_node", { node_id: newId });
check("get_node round-trips the body", fetched.text.includes("Written by the MCP server"), fetched.text.slice(0, 200));

const dmPost = await callTool("create_post", {
  node_id: newId,
  title: "DM Notes",
  body_md: "The players must never read this.",
  visibility: "dm",
});
check("create_post can write DM-only notes", !dmPost.isError && dmPost.text.includes("dm"), dmPost.text);

const wanted = await callTool("list_unresolved_links");
check("unresolved links surface the wanted page", wanted.text.includes("A Page That Does Not Exist"), wanted.text.slice(0, 200));

console.log("\n== guard rails ==");
const notYet = await callTool("place_marker");
check("unbuilt tools say so rather than failing oddly", notYet.text.includes("not implemented yet"), notYet.text);

const bad = await callTool("get_node", { node_id: "zzzzzzzz" });
check("a missing page is reported as an error, not a crash", bad.isError, bad.text);

// A read-only token must not be able to write, even through MCP.
const roSecret = (
  await api("POST", "/tokens", { name: "mcp readonly test", worldId: world.id, scopes: ["world:read"] })
).body.secret;
const ro = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER_ENTRY], {
  env: { ...process.env, DNDWORLDAPP_URL: "http://localhost:8080", DNDWORLDAPP_TOKEN: roSecret, DNDWORLDAPP_WORLD: world.id },
  stdio: ["pipe", "pipe", "pipe"],
});
let roBuf = "";
const roPending = new Map();
ro.stdout.on("data", (c) => {
  roBuf += c.toString();
  let i;
  while ((i = roBuf.indexOf("\n")) >= 0) {
    const line = roBuf.slice(0, i).trim();
    roBuf = roBuf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      if (m.id !== undefined && roPending.has(m.id)) { roPending.get(m.id)(m); roPending.delete(m.id); }
    } catch {}
  }
});
let roId = 1;
const roRpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = roId++;
    const t = setTimeout(() => reject(new Error("ro timeout")), 15000);
    roPending.set(id, (m) => { clearTimeout(t); resolve(m); });
    ro.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
await roRpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ro", version: "0" } });
ro.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const roWrite = await roRpc("tools/call", { name: "create_node", arguments: { title: "Should Not Exist" } });
const roText = (roWrite.result?.content ?? []).map((c) => c.text).join("");
check("a read-only token cannot write through MCP", roWrite.result?.isError === true && roText.includes("403"), roText);
ro.kill();

child.kill();
console.log(`\n${failures === 0 ? "ALL MCP CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (stderr.trim()) console.log("\nserver stderr:", stderr.trim().slice(0, 400));
process.exit(failures === 0 ? 0 : 1);
