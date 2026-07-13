export const PERSONAL_ONTOLOGY_SCHEMA_VERSION = "1.0.0" as const;

export const PERSONAL_ONTOLOGY_PROFILES = [
  "findmnemo.observed-work.v1",
  "flowsensa.process-analysis.v1",
  "sancussight.governance.v1",
] as const;

export const PERSONAL_ONTOLOGY_BUNDLE_KINDS = [
  "observed-work",
  "process-analysis",
  "governance-registry",
  "handoff",
] as const;

export const PERSONAL_ONTOLOGY_TRUTH_STATES = [
  "observed",
  "imported",
  "derived",
  "inferred",
  "user-confirmed",
  "overridden",
] as const;

export type PersonalOntologyProfile =
  (typeof PERSONAL_ONTOLOGY_PROFILES)[number];
export type PersonalOntologyBundleKind =
  (typeof PERSONAL_ONTOLOGY_BUNDLE_KINDS)[number];
export type PersonalOntologyTruthState =
  (typeof PERSONAL_ONTOLOGY_TRUTH_STATES)[number];

export type PersonalOntologyObjectType =
  | "ticket"
  | "work-event"
  | "work-event-ref"
  | "actor"
  | "agent-activity"
  | "decision"
  | "artifact"
  | "evidence"
  | "email-thread"
  | "ai-receipt"
  | "project-progress"
  | "process"
  | "process-revision"
  | "process-task"
  | "transition"
  | "case"
  | "risk"
  | "recommendation"
  | "resource-usage"
  | "override"
  | "governed-asset"
  | "control"
  | "exit-test"
  | "action-handoff";

export type PersonalOntologyLinkType =
  | "belongs-to"
  | "contains"
  | "created-by"
  | "performed-by"
  | "precedes"
  | "observed-in"
  | "has-evidence"
  | "records-decision"
  | "attached-artifact"
  | "updates-state"
  | "supports"
  | "supports-receipt"
  | "has-risk"
  | "has-recommendation"
  | "uses-resource"
  | "overrides"
  | "derived-from"
  | "handoff-targets"
  | "references";

export interface PersonalOntologyProducerMetadata {
  productName: string;
  productId: string;
  exportedAt: string;
  legacyNames?: string[];
  sourceTypes?: string[];
  compatibilityMode?: string;
}

export interface PersonalOntologyEvidenceReference {
  id: string;
  sourceRefs: string[];
  truthState: PersonalOntologyTruthState;
  eventId?: string;
  actorId?: string;
  timestamp?: string;
  unavailable?: boolean;
}

export interface PersonalOntologyObject {
  id: string;
  type: PersonalOntologyObjectType;
  label: string;
  profile: PersonalOntologyProfile;
  properties: Record<string, unknown>;
  sourceRefs: string[];
  truthState: PersonalOntologyTruthState;
  classification?: "private-work-data" | "public-metadata" | "redacted";
  privateDataPolicy?: "refs-only" | "summary" | "raw-included";
  confidence?: number;
}

export interface PersonalOntologyLink {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  type: PersonalOntologyLinkType;
  sourceRefs: string[];
  truthState: PersonalOntologyTruthState;
  evidenceEventIds?: string[];
}

export interface PersonalOntologyActionDefinition {
  id: string;
  label: string;
  mode: "read-only" | "propose-only" | "user-confirmed-write";
  requiredFields: string[];
  optionalFields: string[];
  confirmationRequired: boolean;
  resultDescription: string;
  failureBehavior: string;
}

export interface PersonalOntologyHandoffEnvelope {
  schemaVersion: typeof PERSONAL_ONTOLOGY_SCHEMA_VERSION;
  handoffProfile: "personal-ontology.handoff.v1";
  sourceProduct: string;
  targetProduct: string;
  actionType: string;
  summary: string;
  objectRefs: string[];
  evidenceRefs: string[];
  payload: Record<string, unknown>;
  confirmationRequired: true;
}

export interface PersonalOntologyCompatibility {
  acceptedSourceTypes: string[];
  emittedSourceTypes: string[];
  legacyLocalStorageKeys?: string[];
  legacyUriSchemes?: string[];
}

export interface PersonalOntologyBundle {
  schemaVersion: typeof PERSONAL_ONTOLOGY_SCHEMA_VERSION;
  bundleProfile: PersonalOntologyProfile;
  bundleKind: PersonalOntologyBundleKind;
  producer: PersonalOntologyProducerMetadata;
  compatibility?: PersonalOntologyCompatibility;
  objects: PersonalOntologyObject[];
  links: PersonalOntologyLink[];
  actions?: PersonalOntologyActionDefinition[];
  evidence?: PersonalOntologyEvidenceReference[];
  handoffs?: PersonalOntologyHandoffEnvelope[];
  sourceEventIds?: string[];
  extensions?: Record<string, unknown>;
}

export interface PersonalOntologyValidationIssue {
  path: string;
  message: string;
}

export interface PersonalOntologyValidationResult {
  valid: boolean;
  issues: PersonalOntologyValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSupportedProfile(value: unknown): value is PersonalOntologyProfile {
  return (
    typeof value === "string" &&
    PERSONAL_ONTOLOGY_PROFILES.some((profile) => profile === value)
  );
}

function isSupportedBundleKind(value: unknown): value is PersonalOntologyBundleKind {
  return (
    typeof value === "string" &&
    PERSONAL_ONTOLOGY_BUNDLE_KINDS.some((kind) => kind === value)
  );
}

function isTruthState(value: unknown): value is PersonalOntologyTruthState {
  return (
    typeof value === "string" &&
    PERSONAL_ONTOLOGY_TRUTH_STATES.some((state) => state === value)
  );
}

function validateObject(
  value: unknown,
  index: number,
  issues: PersonalOntologyValidationIssue[],
): void {
  const path = `objects[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    issues.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof value.type !== "string" || value.type.length === 0) {
    issues.push({ path: `${path}.type`, message: "must be a non-empty string" });
  }
  if (typeof value.label !== "string") {
    issues.push({ path: `${path}.label`, message: "must be a string" });
  }
  if (!isSupportedProfile(value.profile)) {
    issues.push({ path: `${path}.profile`, message: "must be a supported profile" });
  }
  if (!isRecord(value.properties)) {
    issues.push({ path: `${path}.properties`, message: "must be an object" });
  }
  if (!isStringArray(value.sourceRefs)) {
    issues.push({ path: `${path}.sourceRefs`, message: "must be a string array" });
  }
  if (!isTruthState(value.truthState)) {
    issues.push({ path: `${path}.truthState`, message: "must be a supported truth state" });
  }
}

function validateLink(
  value: unknown,
  index: number,
  issues: PersonalOntologyValidationIssue[],
): void {
  const path = `links[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }

  for (const field of ["id", "fromObjectId", "toObjectId", "type"] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      issues.push({ path: `${path}.${field}`, message: "must be a non-empty string" });
    }
  }
  if (!isStringArray(value.sourceRefs)) {
    issues.push({ path: `${path}.sourceRefs`, message: "must be a string array" });
  }
  if (!isTruthState(value.truthState)) {
    issues.push({ path: `${path}.truthState`, message: "must be a supported truth state" });
  }
}

export function validatePersonalOntologyBundle(
  input: unknown,
): PersonalOntologyValidationResult {
  const issues: PersonalOntologyValidationIssue[] = [];

  if (!isRecord(input)) {
    return { valid: false, issues: [{ path: "$", message: "must be an object" }] };
  }

  if (input.schemaVersion !== PERSONAL_ONTOLOGY_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `must equal ${PERSONAL_ONTOLOGY_SCHEMA_VERSION}`,
    });
  }
  if (!isSupportedProfile(input.bundleProfile)) {
    issues.push({ path: "bundleProfile", message: "must be a supported profile" });
  }
  if (!isSupportedBundleKind(input.bundleKind)) {
    issues.push({ path: "bundleKind", message: "must be a supported bundle kind" });
  }

  if (!isRecord(input.producer)) {
    issues.push({ path: "producer", message: "must be an object" });
  } else {
    for (const field of ["productName", "productId", "exportedAt"] as const) {
      if (typeof input.producer[field] !== "string" || input.producer[field].length === 0) {
        issues.push({ path: `producer.${field}`, message: "must be a non-empty string" });
      }
    }
  }

  if (!Array.isArray(input.objects)) {
    issues.push({ path: "objects", message: "must be an array" });
  } else {
    input.objects.forEach((value, index) => validateObject(value, index, issues));
  }

  if (!Array.isArray(input.links)) {
    issues.push({ path: "links", message: "must be an array" });
  } else {
    input.links.forEach((value, index) => validateLink(value, index, issues));
  }

  return { valid: issues.length === 0, issues };
}

export function isPersonalOntologyBundle(
  input: unknown,
): input is PersonalOntologyBundle {
  return validatePersonalOntologyBundle(input).valid;
}
