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
  return async function call(method, path, body, extraHeaders) {
    const headers = { ...extraHeaders };
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
  username: "gm_wizard",
  password: "correct-horse-battery",
  worldName: "BloodEarth",
});
check("setup created the owner", setup.status === 200 && setup.body.user.username === "gm_wizard", setup.body);

const setupTwice = await dm("POST", "/setup", {
  name: "Someone Else",
  username: "intruder",
  password: "another-long-password",
  worldName: "Nope",
});
check("setup cannot be run a second time", setupTwice.status === 409, setupTwice.body);

const takenUsername = await player("POST", "/setup", {
  name: "Someone",
  username: "gm_wizard",
  password: "another-long-password",
  worldName: "Nope",
});
check("setup rejects an already-set-up server before it even checks the username", takenUsername.status === 409, takenUsername.body);

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

console.log("\n== accounts: no email anywhere, a DM creates them directly ==");

const missingPassword = await dm("POST", `/worlds/${worldId}/members`, {
  username: "ghost",
  role: "player",
});
check(
  "adding a username with no matching account requires name+password to create one",
  missingPassword.status === 400,
  missingPassword.body,
);

const added = await dm("POST", `/worlds/${worldId}/members`, {
  username: "player1",
  role: "player",
  name: "Player One",
  password: "another-long-password",
});
check(
  "one call both creates the account and adds membership",
  added.status === 201 && added.body.member.role === "player" && added.body.member.username === "player1",
  added.body,
);

const login = await player("POST", "/auth/login", { username: "player1", password: "another-long-password" });
check("player can sign in with the username the DM set", login.status === 200, login.body);

const secondWorldForExisting = (await dm("POST", "/worlds", { name: "A Second World" })).body.world;
const reAdded = await dm("POST", `/worlds/${secondWorldForExisting.id}/members`, {
  username: "player1",
  role: "guest",
});
check(
  "adding an EXISTING username to another world needs no password — it just attaches",
  reAdded.status === 201 && reAdded.body.member.role === "guest",
  reAdded.body,
);

const changePwWrongCurrent = await player("POST", "/auth/change-password", {
  currentPassword: "wrong-password-entirely",
  newPassword: "a-brand-new-long-password",
});
check("self password change rejects the wrong current password", changePwWrongCurrent.status === 400, changePwWrongCurrent.body);

const changePw = await player("POST", "/auth/change-password", {
  currentPassword: "another-long-password",
  newPassword: "a-brand-new-long-password",
});
check("player can change their own password", changePw.status === 200, changePw.body);

const loginOldPw = await player("POST", "/auth/login", { username: "player1", password: "another-long-password" });
check("the old password stops working", loginOldPw.status === 401, loginOldPw.status);

const reLogin = await player("POST", "/auth/login", { username: "player1", password: "a-brand-new-long-password" });
check("the new password works", reLogin.status === 200, reLogin.body);

const dmReset = await dm("POST", `/worlds/${worldId}/members/${added.body.member.id}/reset-password`, {
  newPassword: "dm-reset-this-password-9",
});
check("a DM can reset a member's password without knowing the old one", dmReset.status === 200, dmReset.body);
const loginAfterDmReset = await player("POST", "/auth/login", { username: "player1", password: "dm-reset-this-password-9" });
check("the DM-set password works", loginAfterDmReset.status === 200, loginAfterDmReset.body);

const playerCannotReset = await player("POST", `/worlds/${worldId}/members/${added.body.member.id}/reset-password`, {
  newPassword: "should-not-be-allowed-1",
});
check("a player cannot reset anyone's password, including their own, this way", playerCannotReset.status === 403, playerCannotReset.body);

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
  username: "player1",
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

console.log("\n== inline :::secret blocks ==");

const SECRET_TOKEN = "Zorlathax9Rebellion";
const PUBLIC_TOKEN = "TownOfBrightwater7";

const secretPage = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "Brightwater",
    parentId: rootId,
    bodyMd: [
      `A quiet frontier town, ${PUBLIC_TOKEN} to travelers.`,
      "",
      ":::secret",
      `The mayor is secretly funding the ${SECRET_TOKEN}.`,
      ":::",
      "",
      "Trade caravans pass through weekly.",
    ].join("\n"),
  })
).body.node;

const dmView = (await dm("GET", `/nodes/${secretPage.id}`)).body.node;
check("DM sees the secret text", dmView.bodyMd.includes(SECRET_TOKEN), dmView.bodyMd);
check("DM sees the public text too", dmView.bodyMd.includes(PUBLIC_TOKEN), dmView.bodyMd);

const playerView = (await player("GET", `/nodes/${secretPage.id}`)).body.node;
check("player never receives the secret text", !playerView.bodyMd.includes(SECRET_TOKEN), playerView.bodyMd);
check("player still sees the surrounding public text", playerView.bodyMd.includes(PUBLIC_TOKEN), playerView.bodyMd);
check("the fence markers themselves are gone too", !playerView.bodyMd.includes(":::"), playerView.bodyMd);

const playerSearchSecret = (await player("GET", `/worlds/${worldId}/search?q=${SECRET_TOKEN}`)).body.hits;
check("player search cannot find secret-only text", playerSearchSecret.length === 0, playerSearchSecret);

const dmSearchSecret = (await dm("GET", `/worlds/${worldId}/search?q=${SECRET_TOKEN}`)).body.hits;
check(
  "secret text is not indexed for anyone, including the DM (documented trade-off)",
  dmSearchSecret.length === 0,
  dmSearchSecret,
);

const playerSearchPublic = (await player("GET", `/worlds/${worldId}/search?q=${PUBLIC_TOKEN}`)).body.hits;
check("player search still finds the public text on the same page", playerSearchPublic.some((h) => h.nodeId === secretPage.id), playerSearchPublic);

// A player editing their own page, into which a DM has embedded a secret, must not
// be able to silently delete content they cannot even see.
const playerPage = (await player("POST", `/worlds/${worldId}/nodes`, { title: "Player's Own Page", parentId: rootId })).body.node;
const dmInjected = await dm("PATCH", `/nodes/${playerPage.id}`, {
  bodyMd: [`Visible to the player.`, "", ":::secret", `Only the DM should ever see: ${SECRET_TOKEN}`, ":::"].join("\n"),
});
check("DM can add a secret block to a page a player owns", dmInjected.status === 200, dmInjected.body);

const playerBodyEditBlocked = await player("PATCH", `/nodes/${playerPage.id}`, { bodyMd: "Trying to edit my own page." });
check(
  "player is blocked from resaving a body that contains a secret they cannot see",
  playerBodyEditBlocked.status === 400,
  playerBodyEditBlocked.body,
);

const playerTitleEditStillWorks = await player("PATCH", `/nodes/${playerPage.id}`, { title: "Player's Renamed Page" });
check("player can still edit fields other than the body", playerTitleEditStillWorks.status === 200, playerTitleEditStillWorks.body);

const dmBodyEditStillWorks = await dm("PATCH", `/nodes/${playerPage.id}`, {
  bodyMd: "DM rewrote the whole body, secret included.\n\n:::secret\nStill hidden.\n:::",
});
check("the owner/DM can still edit a body containing secrets", dmBodyEditStillWorks.status === 200, dmBodyEditStillWorks.body);

// Posts carry the same rule. Player creates the post (so they own it and can
// normally edit it); DM then injects a secret into it, same as the page case above.
const playerOwnPost = await player("POST", `/nodes/${playerPage.id}/posts`, {
  title: "Rumours",
  bodyMd: "Common talk.",
  visibility: "members",
});
check("player can create a post on their own page", playerOwnPost.status === 201, playerOwnPost.body);
const postId = playerOwnPost.body.post.id;

const dmInjectedPost = await dm("PATCH", `/posts/${postId}`, {
  bodyMd: [`Common talk.`, "", ":::secret", `${SECRET_TOKEN} lives here too.`, ":::"].join("\n"),
});
check("DM can inject a secret into a player-owned post", dmInjectedPost.status === 200, dmInjectedPost.body);

const playerOwnPosts = (await player("GET", `/nodes/${playerPage.id}/posts`)).body.posts;
const playerRumours = playerOwnPosts.find((p) => p.id === postId);
check("player sees their own post", playerRumours !== undefined, playerOwnPosts);
check("but not the secret text the DM added to it", !playerRumours.bodyMd.includes(SECRET_TOKEN), playerRumours?.bodyMd);

const playerPostEditBlocked = await player("PATCH", `/posts/${postId}`, { bodyMd: "trying to edit" });
check(
  "player is blocked from resaving their own post's body once it contains a secret they cannot see",
  playerPostEditBlocked.status === 400,
  playerPostEditBlocked.body,
);

const playerPostTitleStillWorks = await player("PATCH", `/posts/${postId}`, { title: "Rumours (renamed)" });
check("player can still rename their own post", playerPostTitleStillWorks.status === 200, playerPostTitleStillWorks.body);

const dmPostEditWorks = await dm("PATCH", `/posts/${postId}`, { bodyMd: "DM rewrote it, secret gone now." });
check("DM can still edit that post's body", dmPostEditWorks.status === 200, dmPostEditWorks.body);

console.log("\n== per-node ACL: additive grants on top of visibility ==");

const player1Id = added.body.member.id;

const aclSecretPage = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "The Sealed Vault",
    parentId: rootId,
    visibility: "dm",
  })
).body.node;

const beforeGrant = await player("GET", `/nodes/${aclSecretPage.id}`);
check("without a grant, a DM-only page stays invisible to a player", beforeGrant.status === 404, beforeGrant.body);

const playerListAclForbidden = await player("GET", `/nodes/${aclSecretPage.id}/acl`);
check("a player cannot list access grants", playerListAclForbidden.status === 403, playerListAclForbidden.body);

const badRole = await dm("POST", `/nodes/${aclSecretPage.id}/acl`, { subjectType: "role", subjectId: "wizard" });
check("granting to a made-up role is rejected", badRole.status === 400, badRole.body);

const badUser = await dm("POST", `/nodes/${aclSecretPage.id}/acl`, { subjectType: "user", subjectId: "no-such-user" });
check("granting to a nonexistent account is rejected", badUser.status === 400, badUser.body);

const emptyGrant = await dm("POST", `/nodes/${aclSecretPage.id}/acl`, {
  subjectType: "user",
  subjectId: player1Id,
  canRead: false,
  canEdit: false,
});
check("a grant with neither read nor edit is rejected", emptyGrant.status === 400, emptyGrant.body);

const userGrant = await dm("POST", `/nodes/${aclSecretPage.id}/acl`, {
  subjectType: "user",
  subjectId: player1Id,
  canRead: true,
});
check("DM grants one specific player read access", userGrant.status === 201, userGrant.body);

const afterGrant = await player("GET", `/nodes/${aclSecretPage.id}`);
check("that player can now see the DM-only page", afterGrant.status === 200, afterGrant.body);
check("the grant does not also grant edit", afterGrant.body.node?.canEdit === false, afterGrant.body);

const playerEditViaGrant = await player("PATCH", `/nodes/${aclSecretPage.id}`, { title: "Should still fail" });
check("read-only grant does not allow writing", playerEditViaGrant.status === 403, playerEditViaGrant.body);

const listedGrants = await dm("GET", `/nodes/${aclSecretPage.id}/acl`);
check("the grant shows up with a resolved username, not a bare id", listedGrants.body.entries?.[0]?.subjectLabel === "player1", listedGrants.body);

const aclRevoked = await dm("DELETE", `/nodes/${aclSecretPage.id}/acl/${listedGrants.body.entries[0].id}`);
check("DM revokes the grant", aclRevoked.status === 200, aclRevoked.body);
const afterAclRevoke = await player("GET", `/nodes/${aclSecretPage.id}`);
check("the page is invisible again after revoking", afterAclRevoke.status === 404, afterAclRevoke.body);

const aclRevokeAgain = await dm("DELETE", `/nodes/${aclSecretPage.id}/acl/${listedGrants.body.entries[0].id}`);
check("revoking an already-gone grant is a 404", aclRevokeAgain.status === 404, aclRevokeAgain.body);

// Role grants: "anyone with role X" rather than one specific person.
const roleGrantPage = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "Open Workshop",
    parentId: rootId,
    visibility: "members",
  })
).body.node;
const roleGrant = await dm("POST", `/nodes/${roleGrantPage.id}/acl`, {
  subjectType: "role",
  subjectId: "player",
  canRead: true,
  canEdit: true,
});
check("DM grants edit to anyone with the player role", roleGrant.status === 201, roleGrant.body);

const playerEditsSharedPage = await player("PATCH", `/nodes/${roleGrantPage.id}`, {
  title: "Open Workshop (edited by a player)",
});
check(
  "a player who did not create the page can edit it, via the role grant",
  playerEditsSharedPage.status === 200,
  playerEditsSharedPage.body,
);

// Re-granting the same subject updates the row rather than duplicating it.
const regrant = await dm("POST", `/nodes/${roleGrantPage.id}/acl`, {
  subjectType: "role",
  subjectId: "player",
  canRead: true,
  canEdit: false,
});
check("granting the same subject again updates in place", regrant.status === 201, regrant.body);
const afterRegrant = await dm("GET", `/nodes/${roleGrantPage.id}/acl`);
check("still exactly one entry for that subject, not two", afterRegrant.body.entries.length === 1, afterRegrant.body);
const playerEditBlockedAfterRegrant = await player("PATCH", `/nodes/${roleGrantPage.id}`, { title: "Trying again" });
check("edit is gone now that the grant was updated to read-only", playerEditBlockedAfterRegrant.status === 403, playerEditBlockedAfterRegrant.body);

console.log("\n== view as a player: a DM previewing their own world ==");

const dmTreeNormally = (await dm("GET", `/worlds/${worldId}/tree`)).body.nodes;
check("normally the DM sees the DM-only page", dmTreeNormally.some((n) => n.id === secret.id), dmTreeNormally.length);

const dmTreeAsPlayer = await dm("GET", `/worlds/${worldId}/tree`, undefined, { "x-view-as": "player" });
check(
  "with the header, the same DM no longer sees DM-only pages",
  !dmTreeAsPlayer.body.nodes.some((n) => n.id === secret.id),
  dmTreeAsPlayer.body.nodes.length,
);

const dmSecretAsPlayer = await dm("GET", `/nodes/${secret.id}`, undefined, { "x-view-as": "player" });
check("fetching a DM-only page directly also 404s while viewing as a player", dmSecretAsPlayer.status === 404, dmSecretAsPlayer.body);

const dmViewingSomeoneElsesPage = await dm("GET", `/nodes/${playerPage.id}`, undefined, { "x-view-as": "player" });
check(
  "viewing as a player, the DM cannot edit a page a real player created",
  dmViewingSomeoneElsesPage.body.node?.canEdit === false,
  dmViewingSomeoneElsesPage.body,
);

const playerSendingTheHeader = await player("GET", `/worlds/${worldId}/tree`, undefined, { "x-view-as": "player" });
check(
  "a real player sending the header is unaffected — it only ever narrows, never grants",
  playerSendingTheHeader.status === 200 && !playerSendingTheHeader.body.nodes.some((n) => n.id === secret.id),
  playerSendingTheHeader.body.nodes?.length,
);

console.log("\n== anonymous share links: no account needed ==");

const anon = makeSession(); // never logs in — an empty cookie jar, the same as a stranger with a URL

const shareSource = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "Player Handout: The Sunken Bell",
    parentId: rootId,
    visibility: "dm",
    bodyMd: `Public lore text.\n\n:::secret\n${SECRET_TOKEN}\n:::\n`,
  })
).body.node;
const shareChildPublic = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "A Public Room",
    parentId: shareSource.id,
    visibility: "public",
  })
).body.node;
const shareChildDmOnly = (
  await dm("POST", `/worlds/${worldId}/nodes`, {
    title: "A Hidden Room",
    parentId: shareSource.id,
    visibility: "dm",
  })
).body.node;

const playerCannotList = await player("GET", `/nodes/${shareSource.id}/share-links`);
check("a player cannot see share links", playerCannotList.status === 403, playerCannotList.body);
const playerCannotCreate = await player("POST", `/nodes/${shareSource.id}/share-links`);
check("a player cannot create a share link", playerCannotCreate.status === 403, playerCannotCreate.body);

const created = await dm("POST", `/nodes/${shareSource.id}/share-links`);
check("DM creates a share link", created.status === 201 && typeof created.body.token === "string", created.body);
const token = created.body.token;

const anonBadToken = await anon("GET", "/share/not-a-real-token/tree");
check("an unknown token 404s", anonBadToken.status === 404, anonBadToken.body);

const anonTree = await anon("GET", `/share/${token}/tree`);
check(
  "the anonymous tree includes the shared DM-only root, and its public child",
  anonTree.status === 200 &&
    anonTree.body.rootId === shareSource.id &&
    anonTree.body.nodes.some((n) => n.id === shareSource.id) &&
    anonTree.body.nodes.some((n) => n.id === shareChildPublic.id),
  anonTree.body,
);
check(
  "a DM-only page *underneath* the shared root does not inherit the share",
  !anonTree.body.nodes.some((n) => n.id === shareChildDmOnly.id),
  anonTree.body.nodes.map((n) => n.id),
);

const anonRoot = await anon("GET", `/share/${token}/nodes/${shareSource.id}`);
check("secret blocks are stripped for an anonymous visitor", !anonRoot.body.node.bodyMd.includes(SECRET_TOKEN), anonRoot.body.node.bodyMd);
check("the shared root's own breadcrumb is empty (nothing above it leaks)", anonRoot.body.node.breadcrumb.length === 0, anonRoot.body.node.breadcrumb);
check("an anonymous visitor can never edit", anonRoot.body.node.canEdit === false, anonRoot.body.node);

const anonHiddenChild = await anon("GET", `/share/${token}/nodes/${shareChildDmOnly.id}`);
check("fetching the hidden child directly, even with a valid token, still 404s", anonHiddenChild.status === 404, anonHiddenChild.body);

const anonOutsideScope = await anon("GET", `/share/${token}/nodes/${orgella.id}`);
check("a valid token cannot be used to fetch a node outside its share", anonOutsideScope.status === 404, anonOutsideScope.body);

const revokedLink = await dm("DELETE", `/nodes/${shareSource.id}/share-links/${created.body.shareLink.id}`);
check("DM revokes the share link", revokedLink.status === 200, revokedLink.body);
const anonAfterRevoke = await anon("GET", `/share/${token}/tree`);
check("the revoked token no longer works", anonAfterRevoke.status === 404, anonAfterRevoke.body);
const revokeAgain = await dm("DELETE", `/nodes/${shareSource.id}/share-links/${created.body.shareLink.id}`);
check("revoking an already-revoked link 404s", revokeAgain.status === 404, revokeAgain.body);

console.log("\n== archive ==");
const archived = await dm("DELETE", `/nodes/${orgella.id}`);
check("archive succeeds", archived.status === 200, archived.body);
const treeAfterArchive = (await dm("GET", `/worlds/${worldId}/tree`)).body.nodes;
check("archived page leaves the tree", !treeAfterArchive.some((n) => n.id === orgella.id), treeAfterArchive.length);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
