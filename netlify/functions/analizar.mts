// Función que recibe texto, imágenes o fotogramas y devuelve un informe en JSON.
// Usa ANTHROPIC_API_KEY (Claude) si está cargada; si no, GEMINI_API_KEY (Google).
// Acceso: cada persona usa un código guardado en Netlify Blobs (store "accesos") con un límite de análisis.
// ADMIN_CODE (variable de entorno) entra sin límite y administra los códigos desde /admin.html.
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

  if (req.method !== "POST") return json({ error: "metodo" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "pedido_invalido" }, 400); }

  const codigo = String(body.codigo || "").trim().toUpperCase();
  const adminCode = (Netlify.env.get("ADMIN_CODE") || "").trim().toUpperCase();
  const contacto = Netlify.env.get("CONTACTO") || "";
  const accesos = getStore({ name: "accesos", consistency: "strong" });
  let acceso: any = null;
  // Registro de consultas para el panel (sin guardar el contenido analizado).
  const registro = getStore({ name: "registro" });
  const t0 = Date.now();
  let modeloUsado = "";
  const anotar = async (e: Record<string, unknown>) => {
    try {
      const key = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 8);
      await registro.setJSON(key, {
        fecha: Date.now(), codigo, nombre: acceso ? acceso.nombre : (adminCode && codigo === adminCode ? "Administrador" : ""),
        tipo: body.tipo, base: body.base || null, modo: body.contexto?.modo || "", imagenes: Array.isArray(body.imagenes) ? body.imagenes.length : 0,
        modelo: modeloUsado, segundos: Math.round((Date.now() - t0) / 100) / 10, ...e,
      });
    } catch { /* el registro nunca debe romper el análisis */ }
  };
  if (!codigo) return json({ error: "codigo" }, 401);
  if (!(adminCode && codigo === adminCode)) {
    acceso = await accesos.get(codigo, { type: "json" });
    if (!acceso || !acceso.activo) { await anotar({ ok: false, error: "Código inexistente o desactivado" }); return json({ error: "codigo" }, 401); }
    if ((acceso.usados || 0) >= (acceso.limite || 0)) { await anotar({ ok: false, error: "Sin análisis disponibles" }); return json({ error: "sin_cupo", contacto }, 402); }
  }

  const tipo = ["texto", "imagen", "video", "cuestionario"].includes(body.tipo) ? body.tipo : null;
  if (!tipo) return json({ error: "pedido_invalido" }, 400);

  const imagenes: { mediaType: string; data: string }[] = (Array.isArray(body.imagenes) ? body.imagenes : [])
    .slice(0, 8)
    .filter((i: any) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp)$/.test(i.mediaType));

  const texto = typeof body.texto === "string" ? body.texto.slice(0, 20000) : "";
  if (tipo === "texto" && texto.trim().split(/\s+/).length < 25) return json({ error: "texto_corto" }, 400);
  if ((tipo === "imagen" || tipo === "video") && imagenes.length === 0) return json({ error: "sin_imagen" }, 400);
  if (tipo === "cuestionario" && !texto.trim() && imagenes.length === 0) return json({ error: "pedido_invalido" }, 400);

  const MODOS: Record<string, { quien: string; cuest: string }> = {
    educacion: {
      quien: "Uso: EDUCACIÓN. Un docente revisa el trabajo de un alumno.",
      cuest: "Armá entre 5 y 7 preguntas ORALES para hacerle al alumno sobre el CONTENIDO ESPECÍFICO de este trabajo, que solo pueda responder bien quien lo hizo o lo entendió: explicar con sus palabras una idea puntual, por qué eligió algo, definir un término que usó, aplicar una idea a un ejemplo nuevo, contar cómo lo hizo o qué fuentes usó. Si es una imagen o dibujo, preguntá por el proceso (bocetos, materiales, pasos) y pedí evidencia. Ordenalas de más fácil a más difícil. En 'que_esperar' poné la respuesta esperada o qué tendría que mencionar alguien que realmente lo hizo.",
    },
    empresa: {
      quien: "Uso: EMPRESA / RR. HH. Una empresa revisa material de un candidato, empleado o proveedor (CV, carta, informe, propuesta, fotos de un reclamo o de un trabajo entregado).",
      cuest: "Armá entre 5 y 7 preguntas de ENTREVISTA o de verificación para comprobar que la persona domina lo que presentó y que lo que muestra es real: pedir ejemplos concretos de lo que dice, detalles técnicos, explicar decisiones, y pedir pruebas (fotos originales, contactos, documentos). En 'que_esperar' poné qué debería contestar o mostrar alguien honesto y qué sería una señal de alerta.",
    },
    redes: {
      quien: "Uso: REDES Y NOTICIAS. Alguien quiere saber si una publicación, noticia o contenido viral es real antes de creerlo o compartirlo.",
      cuest: "Armá entre 5 y 7 PASOS DE VERIFICACIÓN concretos, formulados como preguntas para hacerse (¿quién lo publicó primero?, ¿aparece en medios confiables?, ¿la búsqueda inversa de la imagen muestra otra fecha o lugar?, etc.), adaptados a ESTE contenido. En 'que_esperar' explicá cómo hacerlo (con qué herramienta o dónde mirar) y qué resultado indicaría que es falso.",
    },
    personal: {
      quien: "Uso: PERSONAL / FAMILIA. Una persona común (puede ser mayor y sin conocimientos técnicos) recibió esto por WhatsApp, mail o redes y quiere saber si es real. Puede ser un intento de estafa.",
      cuest: "Armá entre 4 y 6 PREGUNTAS O CHEQUEOS muy simples para hacer antes de creerlo o actuar: preguntas para hacerle a quien lo mandó que solo la persona real sabría, llamar por otro canal, no transferir plata ni pasar códigos, etc., adaptados a ESTE contenido. Lenguaje muy simple. En 'que_esperar' explicá qué respuesta sería normal y cuál sería señal de engaño.",
    },
    compras: {
      quien: "Uso: COMPRAS Y VENTAS. Fotos de productos, reseñas, publicaciones de vendedores o comprobantes de pago (por ejemplo, capturas de transferencias que pueden ser falsas).",
      cuest: "Armá entre 4 y 6 VERIFICACIONES concretas antes de pagar o entregar, adaptadas a ESTE contenido: por ejemplo confirmar en el home banking que la plata se acreditó (nunca confiar solo en una captura), pedir una foto nueva del producto con un papel con la fecha y el nombre, revisar reputación y antigüedad del vendedor, comparar precio. En 'que_esperar' explicá cómo hacerlo y qué sería señal de alerta.",
    },
  };
  const ctx = body.contexto || {};
  const modo = MODOS[ctx.modo] ? ctx.modo : "educacion";
  const datos = (Array.isArray(ctx.datos) ? ctx.datos : []).slice(0, 4)
    .map((d: any) => `${String(d[0]).slice(0, 40)}: ${String(d[1]).slice(0, 120)}`).join(". ");
  const contexto = MODOS[modo].quien + (datos ? " Datos: " + datos + "." : "");
  const meta = JSON.stringify(body.meta || {}).slice(0, 1500);

  const formato = `Respondé SOLO con un objeto JSON, en español rioplatense simple (para alguien que no sabe de tecnología), con esta forma:
{"probabilidad_ia": número 0-100, "confianza": "alta"|"media"|"baja", "motivo_confianza": "1 oración, solo si la confianza no es alta", "veredicto": "frase corta", "resumen": "2-3 oraciones explicando por qué", "senales": [{"tipo":"ia"|"humano"|"neutro","detalle":"pista concreta y verificable"}], "consejos": ["2-4 cosas que la persona puede hacer para confirmarlo"]}
Entre 3 y 7 señales. Calibración: 0-20 claramente humano; 20-40 probablemente humano; 40-60 SOLO si hay señales fuertes para los dos lados; 60-80 probablemente IA; 80-100 claramente IA. No uses 50 como respuesta "segura". No inventes datos.`;

  let prompt = "";
  if (tipo === "cuestionario") {
    const base = body.base === "texto" ? "un texto" : body.base === "video" ? "fotogramas de un video" : "una o más imágenes";
    prompt = `${contexto}
Ya se analizó ${base} para ver si fue hecho con IA. Resultado previo: ${meta}.
${MODOS[modo].cuest}
Las preguntas tienen que referirse a detalles REALES de este contenido (nombrá ideas, datos, objetos o partes concretas), no genéricas.
Respondé SOLO con un objeto JSON en español rioplatense simple, con esta forma:
{"titulo": "título corto", "intro": "1-2 oraciones de cómo usarlo", "preguntas": [{"pregunta": "...", "que_esperar": "..."}]}
${texto ? `\nCONTENIDO:\n"""${texto}"""` : ""}`;
  } else if (tipo === "texto") {
    prompt = `Sos un perito que evalúa si un texto fue escrito con IA (ChatGPT, Gemini, Claude, etc.) o por una persona. ${contexto} Tené en cuenta si el estilo y el nivel son esperables para ese contexto.
Pistas automáticas ya calculadas: ${meta}.
Evaluá estilo, estructura, vaguedad, ausencia de experiencia personal, datos dudosos, muletillas típicas de chatbot, errores humanos.
MUY IMPORTANTE, para no subestimar a la IA:
- Mucha gente copia y pega respuestas de ChatGPT, Gemini o Claude. Esas respuestas tienen huellas: negritas o títulos (** o ##), listas con viñetas, encabezados tipo "Precio actual:", frases como "Ten en cuenta que…", "Es importante…", "datos en tiempo real", "puede variar", "fuentes como…", ofrecimientos al final ("¿Querés que…?", "Si querés, puedo…"), avisos ("no es asesoramiento financiero"), saludos o cierres serviciales, emojis decorativos, tono neutro de manual. Si aparecen varias de estas huellas, la probabilidad debe ser ALTA (75-95), aunque el texto sea corto.
- Un texto prolijo, informativo y neutro, sin NINGUNA marca personal (opinión propia, anécdotas, errores de tipeo, modismos, abreviaturas de chat, desorden), no es "humano por defecto": tiene que quedar en 55-75 como mínimo. Para dar menos de 40 tiene que haber señales humanas concretas, y nombrarlas.
- Respuestas tipo consulta de datos (precios, definiciones, pasos, recetas) con estructura ordenada son típicas de chatbot.
- Si el texto tiene menos de 80 palabras, poné "confianza": "baja" y explicalo en "motivo_confianza", pero igual juzgá por las huellas: no te escondas en el 50.
${formato}

TEXTO:
"""${texto}"""`;
  } else if (tipo === "imagen") {
    prompt = `Sos un perito en detectar imágenes generadas o manipuladas con IA (Midjourney, DALL·E, Stable Diffusion, Gemini, Flux, etc.). Puede ser una foto, una ilustración, una captura de Instagram (si se ve la etiqueta "Info de IA" / "Hecho con IA", es evidencia fuerte), la foto de un trabajo, de un producto o un comprobante (si es un comprobante de pago, revisá también tipografías, alineación y datos inconsistentes). ${contexto}
Buscá rastros de IA: anatomía rara (manos, dedos, dientes, orejas, ojos), texto ilegible, simetrías raras, piel plástica, iluminación imposible, sombras y reflejos incoherentes, fondos que se derriten, objetos fusionados, estilo pulido típico de generadores.
Buscá también rasgos de FOTO REAL, que pesan igual: ruido de celular, compresión, enfoque y encuadre imperfectos, escenas cotidianas desprolijas (migas, manchas, objetos comunes), patrones repetidos que se mantienen coherentes, reflejos físicamente correctos.
Una foto casera común sin artefactos de IA debe dar un número BAJO (0-25).
Datos ocultos del archivo: ${meta}. Una marca C2PA o IPTC de IA es evidencia fuerte. Que falten datos de cámara NO es señal de IA (WhatsApp, Instagram y las capturas los borran).
En cada señal decí DÓNDE mirar en la imagen.
${formato}`;
  } else {
    prompt = `Sos un perito en detectar videos generados con IA (Sora, Veo, Kling, Runway, Pika, deepfakes). ${contexto} Te paso ${imagenes.length} fotogramas en orden, tomados a lo largo del video. Datos: ${meta}.
Revisá consistencia entre fotogramas (objetos, ropa, caras, fondo que cambian sin motivo), anatomía, texto ilegible, física rara, caras de cera, marcas de agua de generadores. Si es una filmación casera coherente sin artefactos de IA, el número debe ser bajo. No escuchás el audio: aclaralo si importa.
${formato}`;
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Netlify.env.get("GEMINI_API_KEY");

  try {
    let out = "";
    // Usa Gemini si hay clave de Gemini; Claude solo si no hay Gemini (o si PROVEEDOR=claude).
    const usarClaude = !!anthropicKey && (!geminiKey || (Netlify.env.get("PROVEEDOR") || "").toLowerCase() === "claude");
    if (geminiKey && !usarClaude) {
      // Plan B: si un modelo está saturado, prueba con los siguientes.
      const preferido = Netlify.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
      const modelos = [preferido, "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash"].filter((m, i, arr) => arr.indexOf(m) === i);
      const parts: any[] = imagenes.map((i) => ({ inline_data: { mime_type: i.mediaType, data: i.data } }));
      parts.push({ text: prompt });
      let ultimoError = "";
      let saturado = false;
      for (const model of modelos) {
        for (const conThinking of [true, false]) {
          const generationConfig: any = { responseMimeType: "application/json", temperature: 0.2 };
          if (conThinking) generationConfig.thinkingConfig = { thinkingLevel: "low" };
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": geminiKey },
            body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
          });
          const d: any = await r.json().catch(() => ({}));
          if (r.ok) {
            out = (d.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
            if (out) { modeloUsado = model; break; }
            ultimoError = "respuesta vacía";
            continue;
          }
          ultimoError = d?.error?.message || "Error " + r.status;
          const msg = ultimoError.toLowerCase();
          // Si el problema es la opción de "pensamiento", reintenta el mismo modelo sin ella.
          if (r.status === 400 && conThinking && msg.includes("think")) continue;
          if (r.status === 400 && (msg.includes("api key") || msg.includes("api_key"))) throw new Error("La clave de Gemini no es válida.");
          if ([429, 500, 503, 504].includes(r.status) || msg.includes("demand") || msg.includes("overloaded")) saturado = true;
          break; // pasa al siguiente modelo
        }
        if (out) break;
      }
      if (!out) {
        if (saturado) { await anotar({ ok: false, error: "IA saturada (se probaron todos los modelos)", detalle: ultimoError.slice(0, 200) }); return json({ error: "saturado" }, 503); }
        throw new Error(ultimoError || "sin respuesta");
      }
    } else if (usarClaude) {
      const content: any[] = imagenes.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } }));
      content.push({ type: "text", text: prompt });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: (modeloUsado = Netlify.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001"),
          max_tokens: 2000,
          messages: [{ role: "user", content }],
        }),
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || "Error " + r.status);
      out = (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    } else {
      return json({ error: "sin_clave" }, 503);
    }

    let parsed: any = null;
    try { parsed = JSON.parse(out); } catch {
      const a = out.indexOf("{"), b = out.lastIndexOf("}");
      if (a >= 0 && b > a) { try { parsed = JSON.parse(out.slice(a, b + 1)); } catch { /* sigue null */ } }
    }
    if (!parsed || typeof parsed !== "object") { await anotar({ ok: false, error: "La IA respondió algo que no se pudo leer", detalle: out.slice(0, 200) }); return json({ error: "respuesta_invalida" }, 502); }
    let restantes: number | null = null;
    if (acceso) {
      const fresco: any = (await accesos.get(codigo, { type: "json" })) || acceso;
      fresco.usados = (fresco.usados || 0) + 1;
      fresco.ultimo = Date.now();
      await accesos.setJSON(codigo, fresco);
      restantes = Math.max(0, (fresco.limite || 0) - fresco.usados);
    }
    await anotar(tipo === "cuestionario"
      ? { ok: true, titulo: String(parsed.titulo || "").slice(0, 160), preguntas: Array.isArray(parsed.preguntas) ? parsed.preguntas.length : 0, restantes }
      : { ok: true, probabilidad: parsed.probabilidad_ia, veredicto: String(parsed.veredicto || "").slice(0, 160), resumen: String(parsed.resumen || "").slice(0, 600), restantes });
    return json({ ...parsed, _restantes: restantes, _nombre: acceso ? acceso.nombre : "Administrador" });
  } catch (e: any) {
    await anotar({ ok: false, error: "Falló la IA", detalle: String(e?.message || e).slice(0, 300) });
    return json({ error: "ia", detalle: String(e?.message || e).slice(0, 300) }, 502);
  }
};

export const config = { path: "/api/analizar" };
