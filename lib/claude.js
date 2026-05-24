"use strict";

/**
 * Capa de IA del bot, usando el Claude Agent SDK (tu suscripción Claude Code).
 *
 * - enrutarMensaje(): en UNA sola llamada decide si el mensaje de chat es una
 *   tarea de programación o solo conversación, y genera la respuesta de chat.
 *   (Hacerlo en una sola llamada es más rápido que clasificar y responder por
 *   separado.)
 *
 * El SDK es solo-ESM, así que se importa con import() dinámico y se cachea.
 */

let _query = null;
async function obtenerQuery() {
  if (!_query) {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    _query = mod.query;
  }
  return _query;
}

// Extrae el primer objeto JSON de un texto (tolera ```json ... ``` y texto extra).
function extraerJson(texto) {
  if (!texto) return null;
  let limpio = texto.trim();
  const cerca = limpio.indexOf("{");
  const lejos = limpio.lastIndexOf("}");
  if (cerca === -1 || lejos === -1 || lejos < cerca) return null;
  const posible = limpio.slice(cerca, lejos + 1);
  try {
    return JSON.parse(posible);
  } catch (_) {
    return null;
  }
}

async function ejecutarConsultaTexto({ modelo, systemPrompt, prompt }) {
  const query = await obtenerQuery();
  const iterador = query({
    prompt,
    options: {
      model: modelo,
      systemPrompt,
      allowedTools: [], // sin herramientas: solo generar texto
      maxTurns: 1,
    },
  });
  for await (const mensaje of iterador) {
    if (mensaje.type === "result") {
      if (mensaje.subtype === "success" && !mensaje.is_error) return mensaje.result || "";
      throw new Error(`Claude no pudo responder: ${mensaje.result || mensaje.subtype}`);
    }
  }
  throw new Error("Claude no devolvió respuesta");
}

/**
 * Decide si el mensaje es una tarea de programación y prepara la respuesta de
 * chat. Devuelve { esTarea, tarea, respuesta }.
 */
async function enrutarMensaje({ modelo, texto, repoNombre }) {
  const systemPrompt = [
    "Eres \"Analista\", un programador del equipo TribuDataYAnalitica de Banco",
    `Guayaquil. Trabajas en una oficina virtual y tu repositorio es "${repoNombre}".`,
    "Te llega un mensaje de un compañero por el chat.",
    "Decide si es una SOLICITUD accionable para programar o modificar código en",
    "el repositorio, o si es solo conversación.",
    "Responde ÚNICAMENTE con JSON válido, sin texto extra, con esta forma:",
    '{"esTarea": boolean, "tarea": string, "respuesta": string}.',
    "- \"respuesta\": lo que le dices por el chat. Breve, en español, tono de compañero de oficina.",
    "- Si esTarea=true: \"tarea\" es la descripción accionable a implementar, y",
    "  \"respuesta\" confirma brevemente que te pones con eso.",
    "- Si esTarea=false: \"tarea\" es \"\" y \"respuesta\" es tu contestación normal.",
  ].join("\n");

  const crudo = await ejecutarConsultaTexto({ modelo, systemPrompt, prompt: texto });
  const json = extraerJson(crudo);

  if (!json || typeof json.respuesta !== "string") {
    // Si no pudo parsear, lo tratamos como conversación normal.
    return {
      esTarea: false,
      tarea: "",
      respuesta: (crudo || "").trim() || "Perdona, no te entendí bien. ¿Me lo repites?",
    };
  }

  return {
    esTarea: Boolean(json.esTarea),
    tarea: typeof json.tarea === "string" ? json.tarea.trim() : "",
    respuesta: json.respuesta.trim(),
  };
}

module.exports = { obtenerQuery, enrutarMensaje };
