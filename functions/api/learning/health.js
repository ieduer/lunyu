const SITE_KEY = "kz";
const MANIFEST_PATH = "/data/learning-manifest.json";
const LOADER_CONTRACT_VERSION = "source-rpc-annotation-v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeDigest(value) {
  const raw = String(value || "").trim().toLowerCase();
  const digest = /^[a-f0-9]{64}$/.test(raw) ? `sha256:${raw}` : raw;
  return /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : "";
}

async function localSourceDescriptor(env, request) {
  const response = await env.ASSETS.fetch(new URL(MANIFEST_PATH, request.url));
  if (!response.ok) throw new Error("learning manifest unavailable");
  const manifest = await response.json();
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const resourceKeys = items.map((item) => String(item?.resourceKey || ""));
  const itemCount = Number(manifest?.itemCount);
  const manifestDigest = normalizeDigest(
    manifest?.resourceKeyHash
    || manifest?.resourceKeySha256
    || manifest?.manifestDigest,
  );
  if (
    manifest?.schemaVersion !== 1
    || manifest?.siteKey !== SITE_KEY
    || !String(manifest?.manifestVersion || "")
    || !manifestDigest
    || !Number.isInteger(itemCount)
    || itemCount <= 0
    || items.length !== itemCount
    || resourceKeys.some((resourceKey) => !resourceKey)
    || new Set(resourceKeys).size !== resourceKeys.length
  ) throw new Error("learning manifest invalid");
  return {
    sourceSiteKey: SITE_KEY,
    manifestVersion: String(manifest.manifestVersion),
    manifestDigest,
    itemCount,
    loaderContractVersion: LOADER_CONTRACT_VERSION,
  };
}

export async function onRequestGet(context) {
  if (typeof context.env.GROWTH_EVIDENCE?.getSourceReceipt !== "function") {
    return json({ ok: false, sourceSiteKey: SITE_KEY, error: "binding unavailable" }, 503);
  }
  try {
    const local = await localSourceDescriptor(context.env, context.request);
    const receipt = await context.env.GROWTH_EVIDENCE.getSourceReceipt(local);
    if (
      receipt?.ok !== true
      || receipt.status !== "active"
      || receipt.sourceSiteKey !== local.sourceSiteKey
      || receipt.manifestVersion !== local.manifestVersion
      || receipt.manifestDigest !== local.manifestDigest
      || receipt.itemCount !== local.itemCount
      || receipt.loaderContractVersion !== local.loaderContractVersion
    ) {
      return json({ ok: false, sourceSiteKey: SITE_KEY, error: "receipt mismatch" }, 503);
    }
    return json({ ok: true, ...local, receipt });
  } catch {
    return json({ ok: false, sourceSiteKey: SITE_KEY, error: "source unavailable" }, 503);
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "method not allowed" }, 405);
  return onRequestGet(context);
}
