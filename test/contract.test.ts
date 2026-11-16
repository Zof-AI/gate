import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/answer.js";
import { detectCi } from "../src/ci/index.js";
import {
  BASES,
  CONTRACT,
  CONTRACT_REVISION,
  ERROR_CODES,
  FAILURE_CODES,
  GATE_RESULTS,
  GATE_STATES,
  PROVIDERS,
  SCHEMA_VERSION,
} from "../src/contract.js";
import { buildRequest, requestBody } from "../src/request.js";
import { ANSWER_FIXTURES, fixture, readContract } from "./helpers.js";

interface Manifest {
  contract: string;
  schema_version: number;
  openapi_version: string;
  source_commit: string;
  files: Record<string, { source: string; sha256: string }>;
}

interface JsonSchema {
  $id: string;
  properties: Record<string, { const?: unknown }>;
  $defs: Record<string, { enum?: string[] }>;
}

interface OpenApi {
  info: { version: string };
  components: { schemas: Record<string, { enum?: string[] }> };
}

const manifest = readContract("SOURCE.json") as Manifest;
const answerSchema = readContract("schemas/release_gate.v1.json") as JsonSchema;
const requestSchema = readContract("schemas/release_gate_request.v1.json") as JsonSchema;
const openapi = readContract("openapi.gate.v1.json") as OpenApi;

function ajv() {
  const a = new Ajv2020.default({ strict: false, allErrors: true });
  addFormats.default(a);
  return a;
}

describe("gate.v1 contract copy", () => {
  it("is byte-identical to what SOURCE.json records (re-run scripts/sync-contract.mjs)", () => {
    for (const [path, { sha256 }] of Object.entries(manifest.files)) {
      const text = readFileSync(new URL(`../fixtures/gate.v1/${path}`, import.meta.url));
      expect(createHash("sha256").update(text).digest("hex"), path).toBe(sha256);
    }
    expect(Object.keys(manifest.files)).toHaveLength(11);
  });

  it("is the schema version and contract revision this client speaks", () => {
    expect(manifest.contract).toBe(CONTRACT);
    expect(manifest.schema_version).toBe(SCHEMA_VERSION);
    expect(answerSchema.properties.schema_version?.const).toBe(SCHEMA_VERSION);
    expect(requestSchema.properties.schema_version?.const).toBe(SCHEMA_VERSION);
    expect(answerSchema.$id).toBe(`urn:zof:control:release_gate:v${SCHEMA_VERSION}`);
    expect(requestSchema.$id).toBe(`urn:zof:control:release_gate_request:v${SCHEMA_VERSION}`);
    expect(openapi.info.version).toBe(CONTRACT_REVISION);
    expect(manifest.openapi_version).toBe(CONTRACT_REVISION);
  });

  it("every fixture carries the client's schema version", () => {
    for (const path of Object.keys(manifest.files).filter((p) => p.startsWith("fixtures/"))) {
      expect((readContract(path) as { schema_version: unknown }).schema_version, path).toBe(
        SCHEMA_VERSION,
      );
    }
  });

  it("the client's vocabulary equals the schemas' enums", () => {
    const defs = answerSchema.$defs;
    expect([...GATE_STATES]).toEqual(defs.GateState?.enum);
    expect([...GATE_RESULTS]).toEqual(defs.GateResult?.enum);
    expect([...BASES]).toEqual(defs.Basis?.enum);
    expect([...FAILURE_CODES]).toEqual(defs.FailureCode?.enum);
    expect([...PROVIDERS]).toEqual(requestSchema.$defs.Provider?.enum);
    expect([...ERROR_CODES]).toEqual(openapi.components.schemas.GateErrorCode?.enum);
  });
});

describe("CP-1 fixtures", () => {
  it.each(ANSWER_FIXTURES)("%s is a valid answer by the schema and by the parser", (name) => {
    const validate = ajv().compile(answerSchema);
    const body = fixture(name);
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    expect(parseAnswer(body).ok).toBe(true);
  });

  it.each(["release-gate-request", "release-gate-request-break-glass"])(
    "%s is valid by the request schema",
    (name) => {
      const validate = ajv().compile(requestSchema);
      expect(validate(fixture(name)), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it("the client builds the request fixture byte for byte (as parsed JSON)", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "example-org/shop",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_REF: "refs/heads/main",
      GITHUB_RUN_ID: "1234567890",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "deploy",
      GITHUB_SERVER_URL: "https://github.com",
    };
    const built = buildRequest(
      { environment: "prod-eu", pr: "42" },
      detectCi(env, { readFile: () => undefined }),
    );
    if (!built.ok) throw new Error(built.error);
    expect(JSON.parse(requestBody(built.request))).toEqual(fixture("release-gate-request"));
    const validate = ajv().compile(requestSchema);
    expect(validate(JSON.parse(requestBody(built.request)))).toBe(true);
  });

  it("the break-glass request matches its fixture", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "example-org/shop",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "1234567890",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "deploy",
    };
    const built = buildRequest(
      {
        environment: "prod-eu",
        breakGlassReason: "Hotfix for a payments outage; approved on the incident call",
      },
      detectCi(env, { readFile: () => undefined }),
    );
    if (!built.ok) throw new Error(built.error);
    expect(JSON.parse(requestBody(built.request))).toEqual(
      fixture("release-gate-request-break-glass"),
    );
  });
});
