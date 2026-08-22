// Writes the generated spec to docs/openapi.json so drift shows up in review.
import fs from "node:fs";
import { buildOpenApiDocument } from "../packages/schema/src/openapi.ts";

const doc = buildOpenApiDocument();
fs.writeFileSync("docs/openapi.json", JSON.stringify(doc, null, 2) + "\n");
const paths = Object.keys(doc.paths).length;
const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
const schemas = Object.keys(doc.components.schemas).length;
console.log(`docs/openapi.json — ${paths} paths, ${ops} operations, ${schemas} schemas`);
