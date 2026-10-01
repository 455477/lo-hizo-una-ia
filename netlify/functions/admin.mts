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
