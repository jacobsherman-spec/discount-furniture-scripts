const BRIDGE_VERSION = "2026-05-01";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function parseJsonBody(request) {
  try { return await request.json(); } catch { return null; }
}

function priceHash(payload) {
  const raw = JSON.stringify(payload);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

function buildPricingSnapshot(product, selectedSupplier) {
  return {
    product_id: product?.id ?? null,
    sku: product?.sku ?? null,
    retail_price: product?.default_price ?? product?.retail_price ?? null,
    retail_price_including_tax: product?.default_price_including_tax ?? null,
    product_supplier_id: selectedSupplier?.id ?? null,
    supplier_price: selectedSupplier?.price ?? null,
    supplier_code: selectedSupplier?.code ?? null
  };
}

function selectSupplier(product, requestedSupplierId) {
  const suppliers = Array.isArray(product?.product_suppliers) ? product.product_suppliers : [];
  if (!suppliers.length) {
    return { error: "Product has no product_suppliers.", status: 400 };
  }
  if (requestedSupplierId) {
    const found = suppliers.find((s) => String(s.id) === String(requestedSupplierId));
    if (!found) return { error: "product_supplier_id not found on product.", status: 400 };
    return { supplier: found };
  }
  if (suppliers.length === 1) return { supplier: suppliers[0] };
  return { error: "product_supplier_id is required when product has multiple suppliers.", status: 400 };
}

async function d1InsertAudit(env, fields) {
  const stmt = env.DB.prepare(`INSERT INTO price_history (
    action_type, status, product_id, sku, product_name, brand,
    product_supplier_id, supplier_id,
    old_supplier_price, new_supplier_price,
    old_supplier_code, new_supplier_code,
    approved_by, approval_note, request_json, rollback_of_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const result = await stmt.bind(
    fields.action_type,
    "pending",
    fields.product_id,
    fields.sku,
    fields.product_name,
    fields.brand,
    fields.product_supplier_id,
    fields.supplier_id,
    fields.old_supplier_price,
    fields.new_supplier_price,
    fields.old_supplier_code,
    fields.new_supplier_code,
    fields.approved_by,
    fields.approval_note,
    JSON.stringify(fields.request_json ?? {}),
    fields.rollback_of_id ?? null
  ).run();
  return result.meta.last_row_id;
}

async function d1FinalizeAudit(env, id, status, resultJson) {
  await env.DB.prepare("UPDATE price_history SET status = ?, result_json = ? WHERE id = ?")
    .bind(status, JSON.stringify(resultJson ?? {}), id)
    .run();
}

async function lsFetch(env, path, options = {}) {
  if (!env.LIGHTSPEED_TOKEN) {
    return { ok: false, status: 500, data: { error: "Missing LIGHTSPEED_TOKEN." } };
  }
  const base = String(env.LIGHTSPEED_API_BASE || "https://api.lightspeedapp.com").replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${env.LIGHTSPEED_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data };
}

async function fetchProduct(env, productId) {
  return lsFetch(env, `/api/2026-04/products/${productId}`);
}

function denyRetailWriteIfUnsupported(payload) {
  if (payload.price_update_type === "supplier_price") return null;
  if (payload.price_update_type === "retail_price" || payload.price_update_type === "supplier_and_retail_price") {
    if (payload.price_book_id && payload.price_book_product_id) {
      return "Retail write requires products:write:price_books confirmation and is preview-only in this release.";
    }
    return "Retail write is preview-only in this release.";
  }
  return "Unsupported price_update_type.";
}

async function handlePricingPreview(env, productId, payload) {
  const productRes = await fetchProduct(env, productId);
  if (!productRes.ok) return jsonResponse({ error: "Failed to fetch product.", details: productRes.data }, productRes.status);
  const product = productRes.data?.product ?? productRes.data;
  const selected = selectSupplier(product, payload.product_supplier_id);
  if (selected.error) return jsonResponse({ error: selected.error }, selected.status);
  const snapshot = buildPricingSnapshot(product, selected.supplier);
  return jsonResponse({ ok: true, mode: "preview", product_id: productId, current_price_hash: priceHash(snapshot), snapshot, requested: payload });
}

async function handlePricingWrite(env, productId, payload, actionType = "update", rollbackOfId = null) {
  if (!payload.approved) return jsonResponse({ error: "approved=true is required for pricing writes." }, 400);
  if (!payload.confirm_sku) return jsonResponse({ error: "confirm_sku is required for pricing writes." }, 400);
  if (!payload.expected_current_price_hash) return jsonResponse({ error: "expected_current_price_hash is required." }, 400);

  const retailError = denyRetailWriteIfUnsupported(payload);
  if (retailError) return jsonResponse({ error: retailError }, 400);

  const productRes = await fetchProduct(env, productId);
  if (!productRes.ok) return jsonResponse({ error: "Failed to fetch product.", details: productRes.data }, productRes.status);
  const product = productRes.data?.product ?? productRes.data;
  if (String(product.sku) !== String(payload.confirm_sku)) return jsonResponse({ error: "confirm_sku mismatch." }, 409);

  const selected = selectSupplier(product, payload.product_supplier_id);
  if (selected.error) return jsonResponse({ error: selected.error }, selected.status);
  const snapshot = buildPricingSnapshot(product, selected.supplier);
  const currentHash = priceHash(snapshot);
  if (currentHash !== payload.expected_current_price_hash) {
    return jsonResponse({ error: "Current price hash changed.", current_price_hash: currentHash, snapshot }, 409);
  }

  const oldPrice = selected.supplier?.price ?? null;
  const oldCode = selected.supplier?.code ?? null;
  const newPrice = payload.supplier_price ?? oldPrice;
  const newCode = payload.supplier_code ?? oldCode;

  const auditId = await d1InsertAudit(env, {
    action_type: actionType,
    product_id: product.id,
    sku: product.sku,
    product_name: product.description ?? product.name ?? null,
    brand: product.brand_name ?? null,
    product_supplier_id: selected.supplier.id,
    supplier_id: selected.supplier.supplier_id ?? payload.supplier_id ?? null,
    old_supplier_price: oldPrice,
    new_supplier_price: newPrice,
    old_supplier_code: oldCode,
    new_supplier_code: newCode,
    approved_by: payload.approved_by ?? null,
    approval_note: payload.approval_note ?? null,
    request_json: payload,
    rollback_of_id: rollbackOfId
  });

  const detailsPayload = { id: product.id, product_suppliers: [{ id: selected.supplier.id, supplier_id: selected.supplier.supplier_id, price: newPrice, code: newCode }] };
  const writeRes = await lsFetch(env, `/api/2026-04/products/${product.id}`, { method: "PUT", body: { details: detailsPayload } });

  if (!writeRes.ok) {
    const status = writeRes.status === 401 || writeRes.status === 403 ? 403 : writeRes.status;
    const error = status === 403 ? "Token/scopes are insufficient for pricing write." : "Pricing write failed.";
    await d1FinalizeAudit(env, auditId, "failed", writeRes.data);
    return jsonResponse({ error, details: writeRes.data, price_audit_id: auditId }, status);
  }

  await d1FinalizeAudit(env, auditId, "success", writeRes.data);
  return jsonResponse({ ok: true, price_audit_id: auditId, result: writeRes.data });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return jsonResponse({ ok: true, service: "internal-bridge", version: BRIDGE_VERSION });

    const pricingMatch = url.pathname.match(/^\/products\/([^/]+)\/pricing\/preview$/);
    if (request.method === "POST" && pricingMatch) {
      const body = await parseJsonBody(request);
      if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);
      return handlePricingPreview(env, pricingMatch[1], body);
    }

    const pricingWriteMatch = url.pathname.match(/^\/products\/([^/]+)\/pricing$/);
    if (request.method === "PUT" && pricingWriteMatch) {
      const body = await parseJsonBody(request);
      if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);
      return handlePricingWrite(env, pricingWriteMatch[1], body);
    }

    const historyMatch = url.pathname.match(/^\/products\/([^/]+)\/pricing\/history$/);
    if (request.method === "GET" && historyMatch) {
      const rows = await env.DB.prepare("SELECT * FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT 50").bind(historyMatch[1]).all();
      return jsonResponse({ ok: true, rows: rows.results || [] });
    }

    const rollbackPreviewMatch = url.pathname.match(/^\/products\/([^/]+)\/pricing\/rollback\/preview$/);
    if (request.method === "POST" && rollbackPreviewMatch) {
      const body = await parseJsonBody(request);
      if (!body?.history_id) return jsonResponse({ error: "history_id is required." }, 400);
      const row = await env.DB.prepare("SELECT * FROM price_history WHERE id = ? AND product_id = ? AND status = 'success'").bind(body.history_id, rollbackPreviewMatch[1]).first();
      if (!row) return jsonResponse({ error: "No successful history record found for rollback." }, 404);
      return handlePricingPreview(env, rollbackPreviewMatch[1], { ...body, product_supplier_id: row.product_supplier_id, supplier_price: row.old_supplier_price, supplier_code: row.old_supplier_code, price_update_type: "supplier_price" });
    }

    const rollbackWriteMatch = url.pathname.match(/^\/products\/([^/]+)\/pricing\/rollback$/);
    if (request.method === "PUT" && rollbackWriteMatch) {
      const body = await parseJsonBody(request);
      if (!body?.history_id) return jsonResponse({ error: "history_id is required." }, 400);
      const row = await env.DB.prepare("SELECT * FROM price_history WHERE id = ? AND product_id = ? AND status = 'success'").bind(body.history_id, rollbackWriteMatch[1]).first();
      if (!row) return jsonResponse({ error: "No successful history record found for rollback." }, 404);
      return handlePricingWrite(env, rollbackWriteMatch[1], { ...body, product_supplier_id: row.product_supplier_id, supplier_price: row.old_supplier_price, supplier_code: row.old_supplier_code, price_update_type: "supplier_price" }, "rollback", row.id);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
