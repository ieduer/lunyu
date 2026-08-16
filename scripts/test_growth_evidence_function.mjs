#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost } from "../functions/api/learning/complete.js";
import { onRequestGet } from "../functions/api/learning/health.js";

const manifest = JSON.parse(readFileSync(new URL("../data/learning-manifest.json", import.meta.url)));
const item = manifest.items[0];
const calls = [];
const healthCalls = [];
const manifestDigest = `sha256:${manifest.resourceKeySha256}`;
const sourceDescriptor = {
  sourceSiteKey: "kz",
  manifestVersion: manifest.manifestVersion,
  manifestDigest,
  itemCount: manifest.itemCount,
  loaderContractVersion: "source-rpc-annotation-v1",
};
const sourceReceipt = {
  ok: true,
  status: "active",
  ...sourceDescriptor,
};
const env = {
  ASSETS: {
    fetch: async () => new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  },
  GROWTH_EVIDENCE: {
    recordCompletion: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        sourceSiteKey: "kz",
        resourceKey: item.resourceKey,
        manifestVersion: manifest.manifestVersion,
        resourceVersion: "sha256:test",
        recorded: true,
      };
    },
    getSourceReceipt: async (descriptor) => {
      healthCalls.push(descriptor);
      return sourceReceipt;
    },
  },
};

const request = new Request("https://kz.bdfz.net/api/learning/complete", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    Origin: "https://kz.bdfz.net",
    Cookie: "bdfz_uc_session=redacted-test-value",
  },
  body: JSON.stringify({
    resourceKey: item.resourceKey,
    manifestVersion: manifest.manifestVersion,
    eventNonce: "kz-test-event-00000001",
    completionKind: "annotation_revealed",
  }),
});
const response = await onRequestPost({ request, env });
assert.equal(response.status, 200);
assert.equal((await response.json()).sourceSiteKey, "kz");
assert.equal(calls.length, 1);
assert.equal(calls[0][0], "bdfz_uc_session=redacted-test-value");
assert.deepEqual(calls[0][1], {
  resourceKey: item.resourceKey,
  manifestVersion: manifest.manifestVersion,
  eventNonce: "kz-test-event-00000001",
  completionKind: "annotation_revealed",
});

const unknown = await onRequestPost({
  request: new Request("https://kz.bdfz.net/api/learning/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://kz.bdfz.net",
      Cookie: "bdfz_uc_session=redacted-test-value",
    },
    body: JSON.stringify({
      resourceKey: "chapter-99999",
      manifestVersion: manifest.manifestVersion,
      eventNonce: "kz-test-event-00000002",
      completionKind: "annotation_revealed",
    }),
  }),
  env,
});
assert.equal(unknown.status, 404);
assert.equal(calls.length, 1);

const missingSession = await onRequestPost({
  request: new Request("https://kz.bdfz.net/api/learning/complete", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://kz.bdfz.net" },
    body: JSON.stringify({
      resourceKey: item.resourceKey,
      manifestVersion: manifest.manifestVersion,
      eventNonce: "kz-test-event-00000003",
      completionKind: "annotation_revealed",
    }),
  }),
  env,
});
assert.equal(missingSession.status, 401);
assert.equal(calls.length, 1);

const selfReportedScore = await onRequestPost({
  request: new Request("https://kz.bdfz.net/api/learning/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://kz.bdfz.net",
      Cookie: "bdfz_uc_session=redacted-test-value",
    },
    body: JSON.stringify({
      resourceKey: item.resourceKey,
      manifestVersion: manifest.manifestVersion,
      eventNonce: "kz-test-event-00000004",
      completionKind: "annotation_revealed",
      score: 100,
    }),
  }),
  env,
});
assert.equal(selfReportedScore.status, 400);
assert.equal(calls.length, 1);

const crossOrigin = await onRequestPost({
  request: new Request("https://kz.bdfz.net/api/learning/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://example.invalid",
      Cookie: "bdfz_uc_session=redacted-test-value",
    },
    body: JSON.stringify({
      resourceKey: item.resourceKey,
      manifestVersion: manifest.manifestVersion,
      eventNonce: "kz-test-event-00000005",
      completionKind: "annotation_revealed",
    }),
  }),
  env,
});
assert.equal(crossOrigin.status, 403);
assert.equal(calls.length, 1);

const health = await onRequestGet({
  request: new Request("https://kz.bdfz.net/api/learning/health"),
  env,
});
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, ...sourceDescriptor, receipt: sourceReceipt });
assert.deepEqual(healthCalls, [sourceDescriptor]);

for (const [field, value] of [
  ["ok", false],
  ["status", "inactive"],
  ["sourceSiteKey", "shi"],
  ["manifestVersion", "kz-stale"],
  ["manifestDigest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ["itemCount", manifest.itemCount - 1],
  ["loaderContractVersion", "source-rpc-stale-v1"],
]) {
  const mismatchHealth = await onRequestGet({
    request: new Request("https://kz.bdfz.net/api/learning/health"),
    env: {
      ...env,
      GROWTH_EVIDENCE: {
        ...env.GROWTH_EVIDENCE,
        getSourceReceipt: async (descriptor) => {
          assert.deepEqual(descriptor, sourceDescriptor);
          return { ...sourceReceipt, [field]: value };
        },
      },
    },
  });
  assert.equal(mismatchHealth.status, 503, `${field} mismatch must fail closed`);
  assert.deepEqual(await mismatchHealth.json(), {
    ok: false,
    sourceSiteKey: "kz",
    error: "receipt mismatch",
  });
}

let invalidManifestRpcCalls = 0;
const invalidManifestHealth = await onRequestGet({
  request: new Request("https://kz.bdfz.net/api/learning/health"),
  env: {
    ...env,
    ASSETS: {
      fetch: async () => new Response(JSON.stringify({ ...manifest, itemCount: manifest.itemCount + 1 })),
    },
    GROWTH_EVIDENCE: {
      getSourceReceipt: async () => {
        invalidManifestRpcCalls += 1;
        return sourceReceipt;
      },
    },
  },
});
assert.equal(invalidManifestHealth.status, 503);
assert.equal(invalidManifestRpcCalls, 0, "invalid local manifest must not activate the source");

process.stdout.write("kz growth evidence function tests passed\n");
