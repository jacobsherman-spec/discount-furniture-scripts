const FACADE_VERSION = "2026-05-01";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function parseJsonBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function internalFetch(env, method, path, body) {
  if (!env.INTERNAL_BRIDGE_API_KEY) {
    return { ok: false, status: 500, data: { error: "Facade is missing INTERNAL_BRIDGE_API_KEY." } };
  }
  const headers = {
    Authorization: `Bearer ${env.INTERNAL_BRIDGE_API_KEY}`,
    Accept: "application/json",
    "User-Agent": `DiscountFurnitureGPTFacade/${FACADE_VERSION}`
  };
  if (method !== "GET") headers["Content-Type"] = "application/json";

  let response;
  if (env.INTERNAL_BRIDGE_SERVICE) {
    response = await env.INTERNAL_BRIDGE_SERVICE.fetch(new Request(`https://internal-bridge.local${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    }));
  } else {
    const base = String(env.INTERNAL_BRIDGE_URL || "").replace(/\/+$/, "");
    if (!base) return { ok: false, status: 500, data: { error: "Facade is missing INTERNAL_BRIDGE_URL and INTERNAL_BRIDGE_SERVICE." } };
    response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data };
}

async function handlePreview(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);

  if (body.type === "pricing_update") {
    if (!body.productId) return jsonResponse({ error: "productId is required for pricing_update." }, 400);
    const res = await internalFetch(env, "POST", `/products/${body.productId}/pricing/preview`, body);
    return jsonResponse(res.data, res.status);
  }

  if (body.type === "pricing_rollback") {
    if (!body.productId) return jsonResponse({ error: "productId is required for pricing_rollback." }, 400);
    const res = await internalFetch(env, "POST", `/products/${body.productId}/pricing/rollback/preview`, body);
    return jsonResponse(res.data, res.status);
  }

  const res = await internalFetch(env, "POST", "/preview", body);
  return jsonResponse(res.data, res.status);
}

async function handleWrite(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);

  if (body.type === "pricing_update") {
    if (!body.productId) return jsonResponse({ error: "productId is required for pricing_update." }, 400);
    const res = await internalFetch(env, "PUT", `/products/${body.productId}/pricing`, body);
    return jsonResponse(res.data, res.status);
  }

  if (body.type === "pricing_rollback") {
    if (!body.productId) return jsonResponse({ error: "productId is required for pricing_rollback." }, 400);
    const res = await internalFetch(env, "PUT", `/products/${body.productId}/pricing/rollback`, body);
    return jsonResponse(res.data, res.status);
  }

  const res = await internalFetch(env, "PUT", "/write", body);
  return jsonResponse(res.data, res.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return jsonResponse({ ok: true, service: "gpt-facade", version: FACADE_VERSION }, 200);
    if (request.method === "POST" && url.pathname === "/read") {
      const body = await parseJsonBody(request);
      if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);
      const res = await internalFetch(env, "POST", "/read", body);
      return jsonResponse(res.data, res.status);
    }
    if (request.method === "POST" && url.pathname === "/preview") return handlePreview(request, env);
    if (request.method === "PUT" && url.pathname === "/write") return handleWrite(request, env);
    return jsonResponse({ error: "Not found" }, 404);
  }
};
