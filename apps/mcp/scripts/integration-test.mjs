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

const SERVER_URL = process.env.SMOKE_BASE ?? "http://localhost:8080";
const BASE = `${SERVER_URL}/api/v1`;

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
  const isFormData = body instanceof FormData;
  const headers = {};
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

// Same identity scripts/smoke.mjs sets up, so either script can run first against
// a shared dev server and this one still finds an owner account to log into.
const status = await api("GET", "/setup/status");
if (status.body.needsSetup) {
  await api("POST", "/setup", {
    name: "Wizard",
    username: "gm_wizard",
    password: "correct-horse-battery",
    worldName: "BloodEarth",
  });
} else {
  await api("POST", "/auth/login", { username: "gm_wizard", password: "correct-horse-battery" });
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
      DNDWORLDAPP_URL: SERVER_URL,
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
for (const expected of [
  "get_tree",
  "find_nodes",
  "get_node",
  "create_node",
  "update_node",
  "move_node",
  "create_post",
  "get_subtree",
  "list_templates",
  "set_node_template",
  "set_field",
  "delete_field",
  "apply_template",
  "get_map",
  "place_marker",
  "update_marker",
  "delete_marker",
]) {
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

console.log("\n== templates & fields ==");
const templateRes = await api("POST", `/worlds/${world.id}/templates`, {
  name: "MCP Test Template",
  fieldSchema: [{ key: "role", type: "text", label: "Role", visibility: "members" }],
});
const templateId = templateRes.body.template.id;

const setTemplate = await callTool("set_node_template", { node_id: newId, template_id: templateId });
check("set_node_template assigns a template", !setTemplate.isError && setTemplate.text.includes(templateId), setTemplate.text);

const setNewField = await callTool("set_field", { node_id: newId, key: "danger_level", value: 7 });
check("set_field creates a new ad hoc field by key", !setNewField.isError && setNewField.text.includes("7"), setNewField.text);

const setExistingField = await callTool("set_field", { node_id: newId, key: "danger_level", value: 9 });
check("set_field updates rather than duplicates an existing key", !setExistingField.isError && setExistingField.text.includes("9"), setExistingField.text);

const fieldsAfterSet = await api("GET", `/nodes/${newId}/fields`);
check(
  "setting the same key twice left exactly one field, not two",
  fieldsAfterSet.body.fields.filter((f) => f.key === "danger_level").length === 1,
  fieldsAfterSet.body.fields,
);

const nodeWithFields = await callTool("get_node", { node_id: newId });
check(
  "get_node's Fields section shows both the template-seeded field and the ad hoc one",
  nodeWithFields.text.includes("## Fields") && nodeWithFields.text.includes("danger_level: 9"),
  nodeWithFields.text,
);

const deleteFieldRes = await callTool("delete_field", { node_id: newId, key: "danger_level" });
check("delete_field removes a field by key", !deleteFieldRes.isError && deleteFieldRes.text.includes("Deleted"), deleteFieldRes.text);
const nodeAfterFieldDelete = await callTool("get_node", { node_id: newId });
check(
  "the deleted field no longer appears in get_node's Fields section",
  !nodeAfterFieldDelete.text.includes("danger_level"),
  nodeAfterFieldDelete.text,
);
const deleteMissingField = await callTool("delete_field", { node_id: newId, key: "no_such_key" });
check("delete_field on an unknown key reports it rather than erroring", !deleteMissingField.isError && deleteMissingField.text.includes("No field"), deleteMissingField.text);

console.log("\n== get_subtree ==");
const childOfNew = await callTool("create_node", { title: "MCP Test Child", parent_id: newId });
const childId = childOfNew.text.match(/\[([a-z0-9]{8})\]/)?.[1];
const grandchild = await callTool("create_node", { title: "MCP Test Grandchild", parent_id: childId });
check("built a two-level subtree under the MCP test page", !grandchild.isError, grandchild.text);

const subtree = await callTool("get_subtree", { node_id: newId });
check(
  "get_subtree shows the child and grandchild nested under the target page",
  subtree.text.includes("MCP Test Child") && subtree.text.includes("MCP Test Grandchild"),
  subtree.text,
);
check(
  "the target page itself is not indented, but its descendants are",
  subtree.text.split("\n")[0].startsWith("- MCP Test Page"),
  subtree.text,
);

const emptySubtree = await callTool("get_subtree", { node_id: grandchild.text.match(/\[([a-z0-9]{8})\]/)?.[1] });
check("get_subtree on a leaf page says so rather than an empty outline", emptySubtree.text.includes("no pages inside"), emptySubtree.text);

console.log("\n== maps ==");
const mapNode = await api("POST", `/worlds/${world.id}/nodes`, { title: "MCP Test Map", kind: "map" });
const mapNodeId = mapNode.body.node.id;

// A minimal valid 1x1 transparent PNG — small enough to embed inline, real enough for sharp to read.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pngForm = new FormData();
pngForm.append("file", new Blob([Buffer.from(TINY_PNG_B64, "base64")], { type: "image/png" }), "tiny.png");
const asset = await api("POST", `/worlds/${world.id}/assets`, pngForm);
await api("PUT", `/nodes/${mapNodeId}/map`, { assetId: asset.body.asset.id });

const placed = await callTool("place_marker", { node_id: mapNodeId, shape: "pin", x: 12, y: 34, label: "Watchtower" });
check("place_marker adds a marker to the map", !placed.isError && placed.text.includes("Placed"), placed.text);
const markerId = placed.text.match(/\[([a-z0-9]{8,12})\]/)?.[1];
check("place_marker's response carries a usable marker id", typeof markerId === "string", placed.text);

const mapRead = await callTool("get_map", { node_id: mapNodeId });
check("get_map shows the map's dimensions and the marker just placed", mapRead.text.includes("1x1px") && mapRead.text.includes("Watchtower"), mapRead.text);

const markerUpdated = await callTool("update_marker", { marker_id: markerId, label: "Old Watchtower (ruined)" });
check("update_marker changes the marker", !markerUpdated.isError, markerUpdated.text);
const mapAfterUpdate = await callTool("get_map", { node_id: mapNodeId });
check("get_map reflects the updated label", mapAfterUpdate.text.includes("Old Watchtower (ruined)"), mapAfterUpdate.text);

const markerDeleted = await callTool("delete_marker", { marker_id: markerId });
check("delete_marker removes it", !markerDeleted.isError && markerDeleted.text.includes("Deleted"), markerDeleted.text);

// P4.3 — region polygons through MCP: place with `points`, update them, and get_map reports the vertex count.
const regionPlaced = await callTool("place_marker", {
  node_id: mapNodeId,
  shape: "polygon",
  x: 0.5,
  y: 0.5,
  label: "The Salt Flats",
  points: "0,0 0,1 1,1 1,0",
});
check("place_marker accepts a polygon with points", !regionPlaced.isError && regionPlaced.text.includes("Placed"), regionPlaced.text);
const regionId = regionPlaced.text.match(/\[([a-z0-9]{8,12})\]/)?.[1];
check("place_marker's response carries the region's id", typeof regionId === "string", regionPlaced.text);

const regionMap = await callTool("get_map", { node_id: mapNodeId });
check("get_map reports the region's vertex count", regionMap.text.includes("[4 vertices]"), regionMap.text);

const regionResized = await callTool("update_marker", { marker_id: regionId, points: "0,0 0,1 1,1" });
check("update_marker can redraw a region's points", !regionResized.isError, regionResized.text);
const regionMap2 = await callTool("get_map", { node_id: mapNodeId });
check("get_map reflects the redrawn vertex count", regionMap2.text.includes("[3 vertices]"), regionMap2.text);

const regionRejected = await callTool("place_marker", { node_id: mapNodeId, shape: "polygon", x: 0, y: 0, points: "0,0 1,1" });
check("a polygon with too few vertices is rejected with a clear error", regionRejected.isError && regionRejected.text.includes("400"), regionRejected.text);

const regionDeleted = await callTool("delete_marker", { marker_id: regionId });
check("a region can be deleted", !regionDeleted.isError, regionDeleted.text);
const mapAfterDelete = await callTool("get_map", { node_id: mapNodeId });
check("get_map shows no markers once the last one is deleted", mapAfterDelete.text.includes("No markers yet"), mapAfterDelete.text);

// update_marker used to spread its snake_case args straight into the (camelCase)
// UpdateMarkerInput with no translation, which happened to work for every field
// except target_node_id (the one multi-word name) — a target_node_id sent via
// update_marker silently did nothing, dropped by the server's Zod schema as an
// unrecognized key. Regression: link a page to a marker that was placed with no
// target, then confirm get_map actually shows the link, not just a 200 response.
const untargeted = await callTool("place_marker", { node_id: mapNodeId, shape: "pin", x: 1, y: 1, label: "Undiscovered" });
const untargetedId = untargeted.text.match(/\[([a-z0-9]{8,12})\]/)?.[1];
const linkedViaUpdate = await callTool("update_marker", { marker_id: untargetedId, target_node_id: world.rootNodeId });
check("update_marker accepts target_node_id without error", !linkedViaUpdate.isError, linkedViaUpdate.text);
const mapAfterLink = await callTool("get_map", { node_id: mapNodeId });
check(
  "and the link actually took effect server-side, not just a silently-dropped field",
  mapAfterLink.text.includes(`-> [${world.rootNodeId}]`),
  mapAfterLink.text,
);
await callTool("delete_marker", { marker_id: untargetedId });

// P4.5 — party/army tokens: a self-referential parent link for a splitting party.
const partyPlaced = await callTool("place_marker", { node_id: mapNodeId, shape: "token", x: 5, y: 5, label: "The Party", members: "Kael, Brint" });
const partyId = partyPlaced.text.match(/\[([a-z0-9]{8,12})\]/)?.[1];
check("place_marker accepts a token shape with a members list", !partyPlaced.isError, partyPlaced.text);

const squadPlaced = await callTool("place_marker", {
  node_id: mapNodeId, shape: "token", x: 6, y: 6, label: "Scout Squad", parent_marker_id: partyId,
});
const squadId = squadPlaced.text.match(/\[([a-z0-9]{8,12})\]/)?.[1];
check("place_marker accepts parent_marker_id at creation", !squadPlaced.isError, squadPlaced.text);

const mapWithGroup = await callTool("get_map", { node_id: mapNodeId });
check("get_map shows the squad's group membership", mapWithGroup.text.includes(`"Scout Squad" at (6, 6) (group: [${partyId}])`), mapWithGroup.text);

const cycleRejected = await callTool("update_marker", { marker_id: partyId, parent_marker_id: squadId });
check("update_marker rejects grouping a token under its own descendant", cycleRejected.isError, cycleRejected.text);

const ungrouped = await callTool("update_marker", { marker_id: squadId, parent_marker_id: null });
check("update_marker can ungroup a token via parent_marker_id: null", !ungrouped.isError, ungrouped.text);
const mapUngrouped = await callTool("get_map", { node_id: mapNodeId });
check("get_map no longer shows a group for the ungrouped token", !mapUngrouped.text.includes(`"Scout Squad" at (6, 6) (group:`), mapUngrouped.text);

await callTool("delete_marker", { marker_id: squadId });
await callTool("delete_marker", { marker_id: partyId });

console.log("\n== guard rails ==");
const notYet = await callTool("add_event");
check("unbuilt tools say so rather than failing oddly", notYet.text.includes("not implemented yet"), notYet.text);

const bad = await callTool("get_node", { node_id: "zzzzzzzz" });
check("a missing page is reported as an error, not a crash", bad.isError, bad.text);

// A read-only token must not be able to write, even through MCP.
const roSecret = (
  await api("POST", "/tokens", { name: "mcp readonly test", worldId: world.id, scopes: ["world:read"] })
).body.secret;
const ro = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER_ENTRY], {
  env: { ...process.env, DNDWORLDAPP_URL: SERVER_URL, DNDWORLDAPP_TOKEN: roSecret, DNDWORLDAPP_WORLD: world.id },
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
