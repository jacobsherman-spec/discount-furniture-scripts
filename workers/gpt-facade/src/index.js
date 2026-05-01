const FACADE_VERSION = "2026-04-29";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function internalFetch(env, method, path, body) {
  if (!env.INTERNAL_BRIDGE_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: {
        error: "Facade is missing INTERNAL_BRIDGE_API_KEY."
      }
    };
  }

  const headers = {
    "Authorization": `Bearer ${env.INTERNAL_BRIDGE_API_KEY}`,
    "Accept": "application/json",
    "User-Agent": `DiscountFurnitureGPTFacade/${FACADE_VERSION}`
  };

  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  let response;

  if (env.INTERNAL_BRIDGE_SERVICE) {
    const internalRequest = new Request(`https://internal-bridge.local${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    response = await env.INTERNAL_BRIDGE_SERVICE.fetch(internalRequest);
  } else {
    const base = String(env.INTERNAL_BRIDGE_URL || "").replace(/\/+$/, "");

    if (!base) {
      return {
        ok: false,
        status: 500,
        data: {
          error: "Facade is missing INTERNAL_BRIDGE_URL and INTERNAL_BRIDGE_SERVICE."
        }
      };
    }

    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  }

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function handleBridgeRequest(request, env, method, path) {
  const body = method === "GET" ? undefined : await parseJsonBody(request);
  if (method !== "GET" && body === null) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const result = await internalFetch(env, method, path, body);
  return jsonResponse(result.data, result.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "gpt-facade", version: FACADE_VERSION }, 200);
    }

    if (request.method === "POST" && url.pathname === "/read") {
      return handleBridgeRequest(request, env, "POST", "/read");
    }

    if (request.method === "POST" && url.pathname === "/preview") {
      return handleBridgeRequest(request, env, "POST", "/preview");
    }

    if (request.method === "PUT" && url.pathname === "/write") {
      return handleBridgeRequest(request, env, "PUT", "/write");
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
