// End-to-end API smoke test. Point it at a server with an EMPTY data directory:
//   rm -rf data && npm run dev:server   (in another terminal)
//   npm run smoke
// It walks the whole P0 surface, and asserts the DM/player boundary in every place
// it could leak: tree, direct fetch by id, posts, and search.
const BASE = "http://localhost:8080/api/v1";

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
  }
}

function makeSession() {
  const jar = new Map();
  return async function call(method, path, body) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const text = await res.text();
    let json;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
}

const dm = makeSession();
const player = makeSession();

console.log("\n== setup ==");
const status = await dm("GET", "/setup/status");
check("server reports it needs setup", status.body.needsSetup === true, status.body);

const setup = await dm("POST", "/setup", {
  name: "Wizard",
  email: "dm@example.com",
  password: "correct-horse-battery",
  worldName: "BloodEarth",
});
check("setup created the owner", setup.status === 200 && setup.body.user.email === "dm@example.com", setup.body);

const worlds = await dm("GET", "/worlds");
const world = worlds.body.worlds[0];
check("world exists with a root node", world?.rootNodeId != null, worlds.body);
const worldId = world.id;
const rootId = world.rootNodeId;

console.log("\n== the tree: anything nests inside anything ==");
const ciridan = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "Ciridan", parentId: rootId })).body.node;
const saloon = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "The Saloon", parentId: ciridan.id })).body.node;
const daigo = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "Captain Daigo", parentId: saloon.id })).body.node;
check("a character nests under a location under a location", daigo.parentId === saloon.id, daigo);

const map = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "Ciridan (MAP)", parentId: ciridan.id, kind: "map" })).body.node;
check("a map is a sibling page, not a separate module", map.parentId === ciridan.id, map);

console.log("\n== wiki links and backlinks ==");
await dm("PATCH", `/nodes/${rootId}`, {
  bodyMd: "The campaign runs in [[Ciridan]], mostly around [[The Saloon|the bar]].\n\nStill to write: [[Orgella]].",
});
const ciridanDetail = (await dm("GET", `/nodes/${ciridan.id}`)).body.node;
check("backlink from the page that mentions it", ciridanDetail.backlinks.some((b) => b.nodeId === rootId), ciridanDetail.backlinks);

const saloonDetail = (await dm("GET", `/nodes/${saloon.id}`)).body.node;
check("labelled link resolves and keeps its label", saloonDetail.backlinks.some((b) => b.label === "the bar"), saloonDetail.backlinks);

let unresolved = (await dm("GET", `/worlds/${worldId}/unresolved-links`)).body.links;
check("a link to a page that does not exist is tracked", unresolved.some((l) => l.targetText === "Orgella"), unresolved);

const orgella = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "Orgella", parentId: rootId })).body.node;
unresolved = (await dm("GET", `/worlds/${worldId}/unresolved-links`)).body.links;
check("creating the page resolves the pending link", !unresolved.some((l) => l.targetText === "Orgella"), unresolved);
const orgellaDetail = (await dm("GET", `/nodes/${orgella.id}`)).body.node;
check("the pending link becomes a real backlink", orgellaDetail.backlinks.some((b) => b.nodeId === rootId), orgellaDetail.backlinks);

console.log("\n== renaming keeps the URL and the links ==");
const renamed = await dm("PATCH", `/nodes/${daigo.id}`, { title: "Captain Daigo of the DOMR" });
check("id is unchanged by a rename", renamed.body.node.id === daigo.id, renamed.body.node.id);

console.log("\n== search ==");
await dm("PATCH", `/nodes/${daigo.id}`, { bodyMd: "A brick-wall firefighter-soldier who refuses to let divers die." });
const hits = (await dm("GET", `/worlds/${worldId}/search?q=firefighter`)).body.hits;
check("full-text search finds body text", hits.some((h) => h.nodeId === daigo.id), hits);
const prefixHits = (await dm("GET", `/worlds/${worldId}/search?q=dai`)).body.hits;
check("prefix search finds a title", prefixHits.some((h) => h.nodeId === daigo.id), prefixHits);

console.log("\n== drag and drop: move without renumbering siblings ==");
const move = await dm("POST", `/nodes/${daigo.id}/move`, { parentId: ciridan.id, beforeId: saloon.id });
check("moved to a new parent", move.status === 200, move.body);
const treeAfterMove = (await dm("GET", `/worlds/${worldId}/tree`)).body.nodes;
const movedNode = treeAfterMove.find((n) => n.id === daigo.id);
const saloonNode = treeAfterMove.find((n) => n.id === saloon.id);
check("sorts before its new sibling", movedNode.sortKey < saloonNode.sortKey, { moved: movedNode.sortKey, saloon: saloonNode.sortKey });

const cycle = await dm("POST", `/nodes/${ciridan.id}/move`, { parentId: daigo.id });
check("a page cannot be moved inside its own descendant", cycle.status === 400, cycle.body);

console.log("\n== DM notes vs players ==");
const secret = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "The Crimson Veil (true plan)", parentId: rootId, visibility: "dm" })).body.node;
const dmPost = await dm("POST", `/nodes/${ciridan.id}/posts`, {
  title: "DM Notes",
  bodyMd: "The mayor is a Veil cell leader.",
  visibility: "dm",
});
check("DM post created", dmPost.status === 201, dmPost.body);
const playerPost = await dm("POST", `/nodes/${ciridan.id}/posts`, {
  title: "What the party knows",
  bodyMd: "A frontier town on the eastern road.",
  visibility: "members",
});
check("member-visible post created", playerPost.status === 201, playerPost.body);

await dm("POST", "/users", { name: "Player One", email: "player@example.com", password: "another-long-password" });
const added = await dm("POST", `/worlds/${worldId}/members`, { email: "player@example.com", role: "player" });
check("player added to the world", added.status === 200 && added.body.member.role === "player", added.body);

const login = await player("POST", "/auth/login", { email: "player@example.com", password: "another-long-password" });
check("player can sign in", login.status === 200, login.body);

const playerTree = (await player("GET", `/worlds/${worldId}/tree`)).body.nodes;
check("player does not see the DM-only page in the tree", !playerTree.some((n) => n.id === secret.id), playerTree.map((n) => n.title));
check("player does see ordinary pages", playerTree.some((n) => n.id === ciridan.id), playerTree.length);

const directHit = await player("GET", `/nodes/${secret.id}`);
check("player gets 404 (not 403) fetching the DM page by id", directHit.status === 404, directHit.body);

const playerPosts = (await player("GET", `/nodes/${ciridan.id}/posts`)).body.posts;
check("player sees the member post", playerPosts.some((p) => p.title === "What the party knows"), playerPosts);
check("player does NOT see the DM Notes post", !playerPosts.some((p) => p.title === "DM Notes"), playerPosts);
check("DM post body never reaches the player", !JSON.stringify(playerPosts).includes("Veil cell leader"), playerPosts);

const dmPosts = (await dm("GET", `/nodes/${ciridan.id}/posts`)).body.posts;
check("DM sees both posts", dmPosts.length === 2, dmPosts.length);

const playerEdit = await player("PATCH", `/nodes/${ciridan.id}`, { title: "Player Was Here" });
check("player cannot edit a DM-authored page", playerEdit.status === 403, playerEdit.body);

const playerSearch = (await player("GET", `/worlds/${worldId}/search?q=Crimson`)).body.hits;
check("DM-only content does not leak through search", playerSearch.length === 0, playerSearch);

console.log("\n== API tokens ==");

function bearer(secret) {
  return async function call(method, path, body) {
    const headers = { authorization: `Bearer ${secret}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
}

const scratch = (await dm("POST", `/worlds/${worldId}/nodes`, { title: "Token Test Page", parentId: rootId })).body.node;

const readTokenRes = await dm("POST", "/tokens", {
  name: "read only",
  worldId,
  scopes: ["world:read"],
});
check("token created", readTokenRes.status === 201 && typeof readTokenRes.body.secret === "string", readTokenRes.body);
check("secret is only returned at creation", !JSON.stringify(readTokenRes.body.token).includes(readTokenRes.body.secret ?? "x"), readTokenRes.body.token);
const readApi = bearer(readTokenRes.body.secret);

const tokenTree = await readApi("GET", `/worlds/${worldId}/tree`);
check("read token can read", tokenTree.status === 200 && Array.isArray(tokenTree.body.nodes), tokenTree.status);

const tokenWrite = await readApi("PATCH", `/nodes/${scratch.id}`, { title: "Should Not Happen" });
check("read token cannot write", tokenWrite.status === 403, tokenWrite.body);

const writeTokenRes = await dm("POST", "/tokens", {
  name: "read write",
  worldId,
  scopes: ["world:write"],
});
const writeApi = bearer(writeTokenRes.body.secret);
const wrote = await writeApi("PATCH", `/nodes/${scratch.id}`, { title: "Written By Token" });
check("write token can write", wrote.status === 200, wrote.body);
const writeRead = await writeApi("GET", `/nodes/${scratch.id}`);
check("world:write implies world:read", writeRead.status === 200, writeRead.status);

const tokenMembers = await writeApi("POST", `/worlds/${worldId}/members`, {
  email: "player@example.com",
  role: "dm",
});
check("token without admin scope cannot change membership", tokenMembers.status === 403, tokenMembers.body);

const tokenListsTokens = await writeApi("GET", "/tokens");
check("a token cannot manage tokens", tokenListsTokens.status === 403, tokenListsTokens.body);

const secondWorld = (await dm("POST", "/worlds", { name: "Some Other World" })).body.world;
const crossWorld = await writeApi("GET", `/worlds/${secondWorld.id}/tree`);
check("world-pinned token cannot reach another world", crossWorld.status === 404, crossWorld.body);

const listed = await dm("GET", "/tokens");
check("tokens are listed for their owner", listed.body.tokens.length === 2, listed.body.tokens.length);
check("stored token shows only a prefix", listed.body.tokens.every((t) => t.prefix.startsWith("dwa_") && t.prefix.length < 20), listed.body.tokens);

const revoked = await dm("DELETE", `/tokens/${writeTokenRes.body.token.id}`);
check("token revoked", revoked.status === 200, revoked.body);
const afterRevoke = await writeApi("GET", `/worlds/${worldId}/tree`);
check("revoked token stops working", afterRevoke.status === 401, afterRevoke.status);

const garbage = await bearer("dwa_not-a-real-token")("GET", `/worlds/${worldId}/tree`);
check("unknown token is rejected", garbage.status === 401, garbage.status);

console.log("\n== archive ==");
const archived = await dm("DELETE", `/nodes/${orgella.id}`);
check("archive succeeds", archived.status === 200, archived.body);
const treeAfterArchive = (await dm("GET", `/worlds/${worldId}/tree`)).body.nodes;
check("archived page leaves the tree", !treeAfterArchive.some((n) => n.id === orgella.id), treeAfterArchive.length);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
