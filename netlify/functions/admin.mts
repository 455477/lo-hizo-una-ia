// Panel de administración de códigos de acceso. Solo responde a quien manda ADMIN_CODE.
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "pedido_invalido" }, 400); }

  const adminCode = (Netlify.env.get("ADMIN_CODE") || "").trim().toUpperCase();
  if (!adminCode || String(body.admin || "").trim().toUpperCase() !== adminCode) return json({ error: "no_autorizado" }, 401);

  const store = getStore({ name: "accesos", consistency: "strong" });
  const accion = body.accion;

  if (accion === "listar") {
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.map((b: any) => store.get(b.key, { type: "json" })));
    return json({ codigos: items.filter(Boolean).sort((a: any, b: any) => (b.creado || 0) - (a.creado || 0)) });
  }

  if (accion === "registro") {
    const reg = getStore({ name: "registro" });
    const { blobs } = await reg.list();
    const keys = blobs.map((b: any) => b.key).sort().reverse();
    // Mantener como máximo 3000 entradas: borra las más viejas.
    if (keys.length > 3000) await Promise.all(keys.slice(3000).map((k: string) => reg.delete(k)));
    const limite = Math.max(1, Math.min(500, Number(body.limite) || 200));
    const items = await Promise.all(keys.slice(0, limite).map((k: string) => reg.get(k, { type: "json" })));
    return json({ registro: items.filter(Boolean), total: Math.min(keys.length, 3000) });
  }

  if (accion === "borrar_registro") {
    const reg = getStore({ name: "registro" });
    const { blobs } = await reg.list();
    await Promise.all(blobs.map((b: any) => reg.delete(b.key)));
    return json({ ok: true });
  }

  if (accion === "solicitudes") {
    const st = getStore({ name: "solicitudes", consistency: "strong" });
    const { blobs } = await st.list();
    const keys = blobs.map((b: any) => b.key).sort().reverse().slice(0, 300);
    const items = await Promise.all(keys.map(async (k: string) => ({ id: k, ...((await st.get(k, { type: "json" })) || {}) })));
    return json({ solicitudes: items });
  }

  if (accion === "solicitud_estado") {
    const st = getStore({ name: "solicitudes", consistency: "strong" });
    const id = String(body.id || "");
    const rec: any = await st.get(id, { type: "json" });
    if (!rec) return json({ error: "no_existe" }, 404);
    rec.estado = ["nueva", "vista", "resuelta"].includes(body.estado) ? body.estado : "vista";
    await st.setJSON(id, rec);
    return json({ ok: true });
  }

  if (accion === "crear") {
    const nombre = String(body.nombre || "").trim().slice(0, 80);
    const limite = Math.max(0, Math.min(100000, Math.round(Number(body.limite) || 0)));
    if (!nombre) return json({ error: "falta_nombre" }, 400);
    const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let codigo = "";
    for (let intento = 0; intento < 10; intento++) {
      const r = crypto.getRandomValues(new Uint32Array(6));
      const c = Array.from(r, (n) => letras[n % letras.length]).join("");
      codigo = c.slice(0, 3) + "-" + c.slice(3);
      if (!(await store.get(codigo))) break;
    }
    const rec = { codigo, nombre, limite, usados: 0, activo: true, creado: Date.now(), ultimo: null, nota: String(body.nota || "").slice(0, 200) };
    await store.setJSON(codigo, rec);
    return json({ ok: true, codigo: rec });
  }

  const codigo = String(body.codigo || "").trim().toUpperCase();
  if (!codigo) return json({ error: "falta_codigo" }, 400);

  if (accion === "editar") {
    const rec: any = await store.get(codigo, { type: "json" });
    if (!rec) return json({ error: "no_existe" }, 404);
    const c = body.cambios || {};
    if (c.sumar !== undefined) rec.limite = Math.max(0, (rec.limite || 0) + Math.round(Number(c.sumar) || 0));
    if (c.limite !== undefined) rec.limite = Math.max(0, Math.round(Number(c.limite) || 0));
    if (c.activo !== undefined) rec.activo = !!c.activo;
    if (c.nombre !== undefined) rec.nombre = String(c.nombre).trim().slice(0, 80) || rec.nombre;
    if (c.reiniciar) rec.usados = 0;
    await store.setJSON(codigo, rec);
    return json({ ok: true, codigo: rec });
  }

  if (accion === "borrar") {
    await store.delete(codigo);
    return json({ ok: true });
  }

  return json({ error: "accion_desconocida" }, 400);
};

export const config = { path: "/api/admin" };
