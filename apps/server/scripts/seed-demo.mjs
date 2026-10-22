// Fills an EMPTY server with a demo world so every feature has something to look at.
//   PORT=8090 DATA_DIR=./test-world/data node apps/server/src/index.ts   (empty data dir)
//   SEED_BASE=http://localhost:8090/api/v1 node apps/server/scripts/seed-demo.mjs
// Logins it creates:  demo / demo   (owner)   and   player / player
import sharp from "sharp";

const BASE = process.env.SEED_BASE ?? "http://localhost:8090/api/v1";

function makeSession() {
  const jar = new Map();
  return async function call(method, path, body) {
    const isForm = body instanceof FormData;
    const headers = {};
    if (body !== undefined && !isForm) headers["content-type"] = "application/json";
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return json;
  };
}

const gm = makeSession();

// ---------------------------------------------------------------- map art
const WORLD_W = 3000;
const WORLD_H = 2000;

function worldMapSvg() {
  const forest = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    const x = 820 + rnd() * 520;
    const y = 640 + rnd() * 480;
    forest.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(16 + rnd() * 20).toFixed(0)}" fill="#3f6b3a" opacity="0.75"/>`);
  }
  const peaks = [];
  for (let i = 0; i < 42; i++) {
    const x = 1900 + rnd() * 560;
    const y = 330 + rnd() * 380;
    const s = 26 + rnd() * 30;
    peaks.push(
      `<polygon points="${x - s},${y + s} ${x},${y - s} ${x + s},${y + s}" fill="#8b8478"/>` +
        `<polygon points="${x},${y - s} ${x + s * 0.35},${y - s * 0.2} ${x - s * 0.2},${y - s * 0.1}" fill="#f1f1ef"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WORLD_W}" height="${WORLD_H}" viewBox="0 0 ${WORLD_W} ${WORLD_H}">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25465f"/><stop offset="1" stop-color="#173246"/></linearGradient>
    <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="90"/>
    </filter>
    <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#sea)"/>
  <g filter="url(#rough)">
    <polygon points="500,900 650,600 950,420 1350,360 1750,300 2150,250 2500,380 2650,700 2600,1000 2700,1300 2450,1600 2050,1700 1650,1620 1350,1750 950,1700 650,1500 450,1250" fill="#d8cf9f" filter="url(#soft)" transform="translate(0,0) scale(1.0)"/>
    <polygon points="520,900 660,630 950,450 1350,390 1750,330 2150,285 2480,410 2620,710 2570,1000 2660,1300 2430,1570 2050,1670 1650,1590 1350,1715 950,1670 670,1480 480,1250" fill="#86a25f"/>
    <polygon points="380,1700 560,1640 720,1730 620,1860 430,1850" fill="#86a25f"/>
    <polygon points="2760,1650 2900,1620 2950,1760 2820,1830" fill="#86a25f"/>
  </g>
  <ellipse cx="1700" cy="930" rx="120" ry="70" fill="#2f5f86"/>
  <path d="M2020,650 C1960,760 1850,820 1760,900 M1650,950 C1560,1100 1500,1300 1480,1700" stroke="#2f5f86" stroke-width="12" fill="none" stroke-linecap="round"/>
  ${forest.join("\n  ")}
  ${peaks.join("\n  ")}
  <path d="M2100,1350 C1900,1300 1700,1180 1450,1050 C1200,1020 900,1200 700,1500" stroke="#7a5d3a" stroke-width="7" stroke-dasharray="22 14" fill="none"/>
</svg>`;
}

function townMapSvg(w, h) {
  const houses = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = 160 + rnd() * (w - 320);
    const y = 140 + rnd() * (h - 280);
    houses.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(34 + rnd() * 30).toFixed(0)}" height="${(26 + rnd() * 24).toFixed(0)}" rx="3" fill="#a46a43" stroke="#4d321e" stroke-width="3"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#8fae6a"/>
  <path d="M0,${h * 0.62} C${w * 0.3},${h * 0.55} ${w * 0.6},${h * 0.7} ${w},${h * 0.6}" stroke="#4d7fb0" stroke-width="46" fill="none"/>
  <path d="M${w * 0.5},0 L${w * 0.5},${h}" stroke="#c9b48a" stroke-width="26"/>
  <path d="M0,${h * 0.35} L${w},${h * 0.35}" stroke="#c9b48a" stroke-width="22"/>
  ${houses.join("\n  ")}
  <rect x="${w * 0.5 - 60}" y="${h * 0.35 - 80}" width="120" height="110" rx="6" fill="#7b7f8a" stroke="#33363d" stroke-width="5"/>
</svg>`;
}

async function pngAsset(worldId, svg, name) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/png" }), name);
  return (await gm("POST", `/worlds/${worldId}/assets`, form)).asset;
}

// ---------------------------------------------------------------- setup
console.log("setup…");
const setup = await gm("POST", "/setup", {
  name: "Demo GM",
  username: "demo",
  password: "demo",
  worldName: "Aldermere",
});
const worldId = setup.world?.id ?? (await gm("GET", "/worlds")).worlds[0].id;
const tree = await gm("GET", `/worlds/${worldId}/tree`);
const root = tree.nodes.find((n) => n.parentId === null);
const rootId = root.id;
// Guests only see a page if every ancestor is public too, so the home page has to be.
await gm("PATCH", `/nodes/${rootId}`, { visibility: "public" });

await gm("POST", `/worlds/${worldId}/members`, {
  username: "player",
  role: "player",
  name: "Pip the Player",
  password: "player",
});

const node = async (title, parentId, extra = {}) =>
  (await gm("POST", `/worlds/${worldId}/nodes`, { title, parentId, ...extra })).node;

// ---------------------------------------------------------------- templates
console.log("templates…");
const npcTpl = (await gm("POST", `/worlds/${worldId}/templates`, {
  name: "NPC",
  icon: "🧑",
  visibility: "members",
  sortKey: "a0",
  fieldSchema: [
    { key: "Race", type: "text", label: "Race", visibility: "members" },
    { key: "Role", type: "text", label: "Role", visibility: "members" },
    { key: "Attitude", type: "select", label: "Attitude", options: ["Friendly", "Neutral", "Hostile"], visibility: "members" },
    { key: "Level", type: "number", label: "Level", visibility: "members" },
    { key: "Secret motive", type: "text", label: "Secret motive", visibility: "dm" },
  ],
})).template;
const placeTpl = (await gm("POST", `/worlds/${worldId}/templates`, {
  name: "Location",
  icon: "📍",
  visibility: "members",
  sortKey: "a1",
  fieldSchema: [
    { key: "Population", type: "number", label: "Population", visibility: "members" },
    { key: "Ruler", type: "text", label: "Ruler", visibility: "members" },
    { key: "Visited", type: "checkbox", label: "Visited by the party", visibility: "members" },
  ],
})).template;

const setFields = async (nodeId, values) => {
  const { fields } = await gm("GET", `/nodes/${nodeId}/fields`);
  for (const [key, value] of Object.entries(values)) {
    const f = fields.find((x) => x.key === key);
    if (f) await gm("PATCH", `/nodes/${nodeId}/fields/${f.id}`, { value });
  }
};

// ---------------------------------------------------------------- pages
console.log("pages…");
const locations = await node("Locations", rootId, { icon: "🧭", visibility: "public", bodyMd: "Everywhere the party has been, or will be. See the [[World Map]]." });
const people = await node("People", rootId, { icon: "👥", visibility: "public", bodyMd: "NPCs, allies and enemies. Tagged #npc so they show up together." });
const factions = await node("Factions", rootId, { icon: "⚔️", visibility: "public", bodyMd: "Organisations pulling the strings. Tagged #faction." });
const sessions = await node("Session Log", rootId, { icon: "📖", visibility: "members", bodyMd: "One page per session. Newest at the bottom." });
const lore = await node("Lore & Items", rootId, { icon: "📜", visibility: "members" });

const aldermere = await node("Kingdom of Aldermere", locations.id, {
  icon: "👑",
  templateId: placeTpl.id,
  visibility: "public",
  bodyMd:
    "# Kingdom of Aldermere\n\nA green, quarrelsome realm bounded by the sea to the south and the [[Ironpeak Mountains]] to the north-east. Ruled from [[Silverport]] by Queen Isolde Marr.\n\n## Places of note\n\n- [[Thornwick]] — a market town on the King's Road\n- [[Gloomwood]] — an old forest nobody maps twice the same way\n- [[Sunken Keep]] — a drowned fortress off the western coast\n\n## Politics\n\nThe crown leans on [[The Silver Hand]] for order and quietly distrusts [[The Crimson Cabal]]. #location #kingdom\n\n:::secret\n\nThe Queen is dying. Only Archmage [[Zelnor Vael]] and two physicians know.\n\n:::\n",
});
await setFields(aldermere.id, { Population: 410000, Ruler: "Queen Isolde Marr", "Visited by the party": true });

const thornwick = await node("Thornwick", locations.id, {
  icon: "🏘️",
  templateId: placeTpl.id,
  visibility: "public",
  bodyMd:
    "# Thornwick\n\nA muddy, busy market town at the crossing of the King's Road and the river Wend. The party's base for the first arc.\n\n## The Gilded Boar (inn)\n\nRun by [[Hobb Tanner]]. Good ale, bad stew, and a notice board that never has fewer than six jobs on it.\n\n## Rumours\n\n1. Lights in [[Gloomwood]] after dark.\n2. The miller's son came back from the forest speaking in rhyme.\n3. [[Captain Mira Voss]] is recruiting off the books.\n\n#location #town\n\nSee the [[Thornwick Town Map]].",
});
await setFields(thornwick.id, { Population: 3200, Ruler: "Reeve Dunstan", "Visited by the party": true });

const silverport = await node("Silverport", locations.id, {
  icon: "⚓",
  templateId: placeTpl.id,
  visibility: "members",
  bodyMd: "# Silverport\n\nCapital and busiest harbour of [[Kingdom of Aldermere]]. Seat of [[The Silver Hand]].\n\n#location #city",
});
await setFields(silverport.id, { Population: 88000, Ruler: "Queen Isolde Marr", "Visited by the party": false });

const gloomwood = await node("Gloomwood", locations.id, {
  icon: "🌲",
  visibility: "members",
  bodyMd: "# Gloomwood\n\nAn ancient forest west of [[Thornwick]]. Paths shift. Compasses lie.\n\n:::secret\n\nThe forest is the dreaming mind of a sleeping archfey. [[Old Hobb the Hermit]] is its unwilling gatekeeper.\n\n:::\n\n#location #forest #danger",
});
const ironpeak = await node("Ironpeak Mountains", locations.id, {
  icon: "⛰️",
  visibility: "members",
  bodyMd: "# Ironpeak Mountains\n\nDwarven holds, wyvern nests, and the only known source of starmetal. #location #mountains",
});
const keep = await node("Sunken Keep", locations.id, {
  icon: "🏰",
  visibility: "members",
  bodyMd: "# Sunken Keep\n\nThe flooded fortress of House Marr. At low tide the upper ward can be walked.\n\nSee the [[Sunken Keep Dungeon Map]] — it has fog of war turned on. #location #dungeon",
});

const mira = await node("Captain Mira Voss", people.id, {
  icon: "🛡️",
  templateId: npcTpl.id,
  visibility: "members",
  bodyMd: "# Captain Mira Voss\n\nScarred veteran of [[The Silver Hand]], quietly assembling a crew in [[Thornwick]].\n\n#npc #ally",
});
await setFields(mira.id, { Race: "Human", Role: "Guard captain", Attitude: "Friendly", Level: 6, "Secret motive": "Reports every move of the party to the Queen." });

const hobb = await node("Hobb Tanner", people.id, {
  icon: "🍺",
  templateId: npcTpl.id,
  visibility: "public",
  bodyMd: "# Hobb Tanner\n\nInnkeeper of the Gilded Boar in [[Thornwick]]. Knows everyone, forgets nothing. #npc",
});
await setFields(hobb.id, { Race: "Halfling", Role: "Innkeeper", Attitude: "Friendly", Level: 2 });

const hermit = await node("Old Hobb the Hermit", people.id, {
  icon: "🧙",
  templateId: npcTpl.id,
  visibility: "dm",
  bodyMd: "# Old Hobb the Hermit\n\nGatekeeper of [[Gloomwood]]. Not related to [[Hobb Tanner]], whatever either of them says. #npc #fey",
});
await setFields(hermit.id, { Race: "Half-elf", Role: "Hermit", Attitude: "Neutral", Level: 9, "Secret motive": "Wants the archfey to stay asleep." });

const zelnor = await node("Zelnor Vael", people.id, {
  icon: "🔮",
  templateId: npcTpl.id,
  visibility: "dm",
  bodyMd: "# Zelnor Vael\n\nCourt archmage. Publicly loyal to [[Kingdom of Aldermere]]. Privately a member of [[The Crimson Cabal]]. #npc #villain",
});
await setFields(zelnor.id, { Race: "Elf", Role: "Court archmage", Attitude: "Hostile", Level: 14, "Secret motive": "Wants the Queen's death to look natural." });

const hand = await node("The Silver Hand", factions.id, {
  icon: "🤝",
  visibility: "public",
  bodyMd: "# The Silver Hand\n\nThe crown's order of knights. Headed by [[Captain Mira Voss]] in the field. #faction #order",
});
const cabal = await node("The Crimson Cabal", factions.id, {
  icon: "🩸",
  visibility: "dm",
  bodyMd: "# The Crimson Cabal\n\nAn old conspiracy inside the court. Led by [[Zelnor Vael]]. #faction #villain",
});

const crown = await node("The Ember Crown", lore.id, {
  icon: "👑",
  visibility: "members",
  bodyMd: "# The Ember Crown\n\nA relic said to confirm the rightful ruler by burning everyone else. Last seen in [[Sunken Keep]]. #item #relic",
});

const s1 = await node("Session 1 — A Notice in Thornwick", sessions.id, {
  icon: "🎲",
  visibility: "members",
  bodyMd: "# Session 1\n\nThe party met at the Gilded Boar and took a job from [[Hobb Tanner]]: find the miller's son in [[Gloomwood]].\n\n**XP awarded:** 300 #session",
});
await gm("POST", `/nodes/${s1.id}/posts`, { title: "Player recap", bodyMd: "We found a trail of rhyming notes leading west. Mira Voss warned us to stay out of the trees at night.", visibility: "members" });
await gm("POST", `/nodes/${s1.id}/posts`, { title: "DM prep for next time", bodyMd: "The miller's son is fine — he is the forest's new voice. Hermit appears in session 2.", visibility: "dm" });
const s2 = await node("Session 2 — Into the Gloomwood", sessions.id, {
  icon: "🎲",
  visibility: "members",
  bodyMd: "# Session 2\n\nThe party met [[Old Hobb the Hermit]] and learned the forest was *listening*. #session",
});

await node("Columns demo", lore.id, {
  icon: "🧱",
  visibility: "members",
  bodyMd:
    "# Columns demo\n\n:::columns {layout=\"1-2\"}\n\n:::column\n\n**Left (narrow)**\n\nStat block goes here.\n\n:::\n\n:::column\n\n**Right (wide)**\n\nLong lore text goes here. Resize the window to see it collapse on a phone.\n\n:::\n\n:::\n",
});

// ---------------------------------------------------------------- world map
console.log("world map (tiling in the background)…");
const worldMap = await node("World Map", rootId, { kind: "map", icon: "🗺️", visibility: "public" });
const worldAsset = await pngAsset(worldId, worldMapSvg(), "aldermere.png");
await gm("PUT", `/nodes/${worldMap.id}/map`, { assetId: worldAsset.id });
await gm("PATCH", `/nodes/${worldMap.id}/map`, { scale: { pxPerUnit: 6, unit: "mi" } });

const mk = (body) => gm("POST", `/nodes/${worldMap.id}/map/markers`, { visibility: "public", ...body });
const grpTowns = (await gm("POST", `/nodes/${worldMap.id}/map/groups`, { name: "Settlements", color: "#d9b24a" })).group;
const grpTerrain = (await gm("POST", `/nodes/${worldMap.id}/map/groups`, { name: "Terrain", color: "#4f8a4a" })).group;
const grpParty = (await gm("POST", `/nodes/${worldMap.id}/map/groups`, { name: "Party & NPCs", color: "#c05b5b" })).group;

await mk({ shape: "pin", x: 1450, y: 1050, targetNodeId: thornwick.id, groupId: grpTowns.id });
await mk({ shape: "pin", x: 2100, y: 1350, targetNodeId: silverport.id, groupId: grpTowns.id });
await mk({ shape: "pin", x: 700, y: 1500, targetNodeId: keep.id, groupId: grpTowns.id });
await mk({ shape: "pin", x: 1100, y: 880, targetNodeId: gloomwood.id, groupId: grpTerrain.id, icon: "🌲" });
await mk({ shape: "label", x: 2150, y: 470, label: "IRONPEAK MOUNTAINS", color: "#ffffff", groupId: grpTerrain.id });
await mk({ shape: "label", x: 1650, y: 1030, label: "Lake Mere", color: "#cfe6ff", groupId: grpTerrain.id, minZoom: -1 });
await mk({
  shape: "polygon",
  x: 1080, y: 880,
  points: "820,640 1150,600 1360,760 1340,1100 1000,1140 800,960",
  label: "Gloomwood", color: "#2f6b3a", groupId: grpTerrain.id,
});
await mk({
  shape: "polygon",
  x: 2170, y: 500,
  points: "1880,300 2300,260 2480,420 2440,720 2100,740 1880,560",
  label: "Ironpeak", color: "#8b8478", groupId: grpTerrain.id, targetNodeId: ironpeak.id,
});
await mk({
  shape: "path",
  x: 2100, y: 1350,
  points: "2100,1350 1900,1300 1700,1180 1450,1050 1200,1020 900,1200 700,1500",
  label: "King's Road", color: "#7a5d3a", groupId: grpTerrain.id,
});
await mk({ shape: "circle", x: 1450, y: 1050, radius: 130, label: "Thornwick farmland", color: "#d9b24a", groupId: grpTowns.id });
await mk({ shape: "token", x: 1500, y: 1090, label: "The Party", icon: "🚩", color: "#c05b5b", members: "Thorn, Vex, Brother Anselm, Pip", visibility: "members", groupId: grpParty.id });
await mk({ shape: "pin", x: 2300, y: 600, label: "Wyvern nest (DM only)", icon: "🐉", visibility: "dm", groupId: grpParty.id });
await mk({ shape: "pin", x: 1700, y: 1090, label: "Wend ferry", icon: "⛴️", minZoom: 0.5, groupId: grpTowns.id });

await gm("POST", `/worlds/${worldId}/marker-presets`, { name: "Tavern", shape: "pin", icon: "🍺", color: "#b9803f" });
await gm("POST", `/worlds/${worldId}/marker-presets`, { name: "Danger zone", shape: "circle", color: "#c0392b", radius: 120 });
await gm("POST", `/worlds/${worldId}/marker-presets`, { name: "Ruin", shape: "pin", icon: "🏚️", color: "#7a7d86" });

// ---------------------------------------------------------------- town map
console.log("town + dungeon maps…");
const townMap = await node("Thornwick Town Map", locations.id, { kind: "map", icon: "🗺️", visibility: "members" });
const townAsset = await pngAsset(worldId, townMapSvg(1600, 1100), "thornwick.png");
await gm("PUT", `/nodes/${townMap.id}/map`, { assetId: townAsset.id });
await gm("POST", `/nodes/${townMap.id}/map/markers`, { shape: "pin", x: 800, y: 320, label: "Town hall", icon: "🏛️", visibility: "members" });
await gm("POST", `/nodes/${townMap.id}/map/markers`, { shape: "pin", x: 560, y: 410, targetNodeId: hobb.id, label: "The Gilded Boar", icon: "🍺", visibility: "members" });

const dungeon = await node("Sunken Keep Dungeon Map", locations.id, { kind: "map", icon: "🗺️", visibility: "members" });
const dungeonAsset = await pngAsset(worldId, townMapSvg(1800, 1200).replace(/#8fae6a/g, "#3b4048").replace(/#4d7fb0/g, "#2a5b73"), "keep.png");
await gm("PUT", `/nodes/${dungeon.id}/map`, { assetId: dungeonAsset.id });
await gm("PATCH", `/nodes/${dungeon.id}/map`, { fogEnabled: true, scale: { pxPerUnit: 20, unit: "ft" } });
await gm("POST", `/nodes/${dungeon.id}/map/markers`, { shape: "pin", x: 900, y: 660, label: "Entrance", icon: "🚪", visibility: "members" });
await gm("POST", `/nodes/${dungeon.id}/map/markers`, { shape: "pin", x: 1300, y: 300, label: "Throne room (the Ember Crown)", icon: "👑", targetNodeId: crown.id, visibility: "members" });

console.log("\nDone. Logins:  demo / demo   |   player / player");
console.log(`World ${worldId}, ${(await gm("GET", `/worlds/${worldId}/tree`)).nodes.length} pages.`);
