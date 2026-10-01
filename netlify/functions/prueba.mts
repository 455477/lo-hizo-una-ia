// Pruebas gratis automáticas y pedidos de más análisis.
// - accion "prueba": crea un código propio con PRUEBA_USOS análisis (3 por defecto).
//   Antiabuso: una prueba por WhatsApp/mail, una por dispositivo y como máximo 3 por conexión por día.
// - accion "mas": registra un pedido de más análisis para un código existente.
// Cada pedido queda en el store "solicitudes" para verlo en /admin.html.
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: any) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "pedido_invalido" }, 400); }

  const limpiar = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const nombre = limpiar(body.nombre, 80);
  const contactoTxt = limpiar(body.contacto, 120);
  const institucion = limpiar(body.institucion, 120);
  const uso = limpiar(body.uso, 40);
  const comentario = limpiar(body.comentario, 400);
  const dispositivo = limpiar(body.dispositivo, 64);

  // Normaliza el contacto: mail en minúsculas o los últimos 10 dígitos del teléfono.
  let contacto = "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactoTxt)) contacto = "mail:" + contactoTxt.toLowerCase();
  else {
    const dig = contactoTxt.replace(/\D/g, "");
    if (dig.length >= 8) contacto = "tel:" + dig.slice(-10);
  }

  const accesos = getStore({ name: "accesos", consistency: "strong" });
  const pruebas = getStore({ name: "pruebas", consistency: "strong" });
  const solicitudes = getStore({ name: "solicitudes", consistency: "strong" });
  const clave = () => String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 8);
  const ip = String(context?.ip || req.headers.get("x-nf-client-connection-ip") || "sin-ip");

  if (body.accion === "mas") {
    const codigo = limpiar(body.codigo, 20).toUpperCase();
    const acc: any = codigo ? await accesos.get(codigo, { type: "json" }) : null;
    if (!acc) return json({ error: "codigo" }, 400);
    if (!contacto) return json({ error: "contacto" }, 400);
    // Evita repetir el mismo pedido muchas veces seguidas.
    const flag = "mas:" + codigo;
    const previo: any = await pruebas.get(flag, { type: "json" });
    if (previo && Date.now() - previo.fecha < 10 * 60 * 1000) return json({ ok: true, repetido: true });
    await pruebas.setJSON(flag, { fecha: Date.now() });
    const sol = { tipo: "mas", estado: "nueva", fecha: Date.now(), nombre: nombre || acc.nombre, contacto: contactoTxt, institucion, uso, comentario, codigo, usados: acc.usados, limite: acc.limite };
    await solicitudes.setJSON(clave(), sol);
    return json({ ok: true, codigo, nombreCodigo: acc.nombre });
  }

  if (body.accion === "consulta") {
    if (!contacto) return json({ error: "contacto" }, 400);
    const flag = "q:" + contacto;
    const previo: any = await pruebas.get(flag, { type: "json" });
    if (previo && Date.now() - previo.fecha < 10 * 60 * 1000) return json({ ok: true, repetido: true });
    await pruebas.setJSON(flag, { fecha: Date.now() });
    await solicitudes.setJSON(clave(), { tipo: "consulta", estado: "nueva", fecha: Date.now(), nombre, contacto: contactoTxt, institucion, uso, comentario });
    return json({ ok: true });
  }

  if (body.accion !== "prueba") return json({ error: "accion" }, 400);
  if (nombre.length < 2) return json({ error: "nombre" }, 400);
  if (!contacto) return json({ error: "contacto" }, 400);

  // Antiabuso
  if (await pruebas.get("c:" + contacto)) return json({ error: "ya_pediste" }, 409);
  if (dispositivo && (await pruebas.get("d:" + dispositivo))) return json({ error: "ya_pediste" }, 409);
  const dia = new Date().toISOString().slice(0, 10);
  const ipKey = "ip:" + ip + ":" + dia;
  const ipCount = Number((await pruebas.get(ipKey)) || 0);
  if (ipCount >= 3) return json({ error: "muchas" }, 429);

  // Crea el código de prueba
  const usos = Math.max(1, Math.min(50, Number(Netlify.env.get("PRUEBA_USOS")) || 3));
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 10; i++) {
    const r = crypto.getRandomValues(new Uint32Array(6));
    const c = Array.from(r, (n) => letras[n % letras.length]).join("");
    codigo = c.slice(0, 3) + "-" + c.slice(3);
    if (!(await accesos.get(codigo))) break;
  }
  const rec = {
    codigo, nombre: nombre + (institucion ? " – " + institucion : ""), limite: usos, usados: 0, activo: true,
    creado: Date.now(), ultimo: null, origen: "prueba", contacto: contactoTxt,
    nota: "Prueba gratis automática" + (uso ? " · " + uso : ""),
  };
  await accesos.setJSON(codigo, rec);
  await pruebas.setJSON("c:" + contacto, { codigo, fecha: Date.now() });
  if (dispositivo) await pruebas.setJSON("d:" + dispositivo, { codigo, fecha: Date.now() });
  await pruebas.set(ipKey, String(ipCount + 1));
  await solicitudes.setJSON(clave(), { tipo: "prueba", estado: "nueva", fecha: Date.now(), nombre, contacto: contactoTxt, institucion, uso, comentario, codigo, limite: usos });

  return json({ ok: true, codigo, limite: usos, nombre: rec.nombre });
};

export const config = { path: "/api/prueba" };
