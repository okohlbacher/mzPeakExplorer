#!/usr/bin/env node
// Build src/data/cv-terms.json — a compact { "MS:1000511": { n: name, d: def } }
// map used to annotate CV accessions in the UI with their ontology term name and
// description. Downloads the source OBO ontologies (PSI-MS, Unit, Imaging-MS) so
// the repo only carries the generated JSON, not the multi-MB OBO files.
//
// Run manually to refresh:  node scripts/gen-cv-terms.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES = [
  "https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo",
  "https://purl.obolibrary.org/obo/uo.obo",
  "https://raw.githubusercontent.com/imzML/imzML/master/imagingMS.obo",
];

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/cv-terms.json");

/** Parse OBO [Term] stanzas into { accession: { n, d } }. */
function parseObo(text, into) {
  let id = null;
  let name = null;
  let def = null;
  const flush = () => {
    if (id && name) into[id] = def ? { n: name, d: def } : { n: name };
    id = name = def = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line === "[Term]") {
      flush();
    } else if (line.startsWith("id: ")) {
      id = line.slice(4).trim();
    } else if (line.startsWith("name: ")) {
      name = line.slice(6).trim();
    } else if (line.startsWith("def: ")) {
      const m = line.match(/^def: "((?:[^"\\]|\\.)*)"/);
      if (m) def = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    }
  }
  flush();
}

const terms = {};
for (const url of SOURCES) {
  process.stdout.write(`fetching ${url} … `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`FAILED (${res.status})`);
    continue;
  }
  const before = Object.keys(terms).length;
  parseObo(await res.text(), terms);
  console.log(`+${Object.keys(terms).length - before} terms`);
}

// Stable key order keeps diffs small across regenerations.
const sorted = {};
for (const k of Object.keys(terms).sort()) sorted[k] = terms[k];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(sorted));
console.log(`wrote ${Object.keys(sorted).length} terms → ${OUT}`);
