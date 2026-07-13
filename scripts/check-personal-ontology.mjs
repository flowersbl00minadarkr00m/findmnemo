import assert from "node:assert/strict";
import {
  PERSONAL_ONTOLOGY_PROFILES,
  validatePersonalOntologyBundle,
} from "@henry/personal-ontology";

const validBundle = {
  schemaVersion: "1.0.0",
  bundleProfile: "findmnemo.observed-work.v1",
  bundleKind: "observed-work",
  producer: {
    productName: "FindMnemo",
    productId: "findmnemo",
    exportedAt: "2026-07-09T00:00:00.000Z",
  },
  objects: [],
  links: [],
};

assert.deepEqual(PERSONAL_ONTOLOGY_PROFILES, [
  "findmnemo.observed-work.v1",
  "flowsensa.process-analysis.v1",
  "sancussight.governance.v1",
]);
assert.equal(validatePersonalOntologyBundle(validBundle).valid, true);
assert.equal(
  validatePersonalOntologyBundle({ ...validBundle, schemaVersion: undefined }).valid,
  false,
);
assert.equal(
  validatePersonalOntologyBundle({ ...validBundle, bundleProfile: "unknown.v1" }).valid,
  false,
);
assert.equal(
  validatePersonalOntologyBundle({ ...validBundle, objects: {}, links: null }).valid,
  false,
);

console.log("Personal ontology package checks passed (4 assertions).");
