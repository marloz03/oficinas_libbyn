"use strict";

/**
 * Bot "Analista" para Gather.town — programador del equipo TribuDataYAnalitica.
 *
 * Comportamiento:
 *  - Si NO hay otro humano en el espacio  -> se queda IDLE (quieto).
 *  - Si hay alguien                       -> modo oficinista: camina por la
 *    oficina de vez en cuando y responde por chat.
 *  - Cuando un compañero le pide una TAREA de programación por chat, trabaja el
 *    repositorio con Claude y sube los cambios a una rama "analista/..." (nunca
 *    a main). Luego reporta la rama en el chat.
 *
 * Todas las claves se leen de .env. La IA usa tu suscripción Claude (Claude
 * Code), no la API de pago.
 */

require("dotenv").config();
global.WebSocket = require("isomorphic-ws");

const path = require("path");
const { Game } = require("@gathertown/gather-game-client");
const { enrutarMensaje } = require("./lib/claude");
const { ejecutarTarea } = require("./lib/programador");

// ------------------------------ Configuración ------------------------------

const { GATHER_API_KEY, GATHER_SPACE_ID, CLAUDE_CODE_OAUTH_TOKEN } = process.env;

// La IA usa tu suscripción de Claude. Quitamos credenciales/gateway que pudieran
// tener prioridad sobre el token de la suscripción.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_BASE_URL;

const NOMBRE_BOT = "Analista";
const MODELO = "claude-sonnet-4-5";

// Repositorio donde programa (opcional: si falta, el modo programador se apaga
// y el bot solo conversa).
const REPO_URL = process.env.REPO_URL || "";
const REPO_DIR = process.env.REPO_DIR
  ? path.resolve(process.env.REPO_DIR)
  : path.join(process.cwd(), "workspace", "Libbyn");
const REPO_NOMBRE = (REPO_URL.split("/").pop() || "el repositorio").replace(/\.git$/, "");

const PASEO_MS = 15_000; // cada cuánto considera dar un pasito (solo si hay gente)
const TIPOS_IGNORADOS = ["GLOBAL_CHAT"]; // mensajes globales -> no responde
const MAX_CHAT = 900; // tope de caracteres por mensaje de chat

// ------------------------------ Utilidades --------------------------------

function log(evento, detalle) {
  const ts = new Date().toISOString();
  console.log(detalle ? `[${ts}] ${evento} :: ${detalle}` : `[${ts}] ${evento}`);
}

function recortar(texto) {
  const t = (texto || "").trim();
  return t.length > MAX_CHAT ? t.slice(0, MAX_CHAT - 1) + "…" : t;
}

function variablesFaltantes() {
  const faltan = [];
  if (!GATHER_API_KEY) faltan.push("GATHER_API_KEY");
  if (!GATHER_SPACE_ID) faltan.push("GATHER_SPACE_ID");
  if (!CLAUDE_CODE_OAUTH_TOKEN) faltan.push("CLAUDE_CODE_OAUTH_TOKEN");
  return faltan;
}

// ------------------------- Validación de entorno ---------------------------

const faltantes = variablesFaltantes();
if (faltantes.length > 0) {
  log(
    "ERROR_CONFIG",
    `Faltan variables en .env: ${faltantes.join(", ")}. ` +
      'Copia ".env.example" a ".env" y complétalas (ver README.md).'
  );
  process.exit(1);
}
if (!REPO_URL) {
  log("AVISO", "REPO_URL no está configurado: el modo programador queda apagado (solo conversa).");
}

// --------------------------- Estado del bot --------------------------------

let game;
let conectado = false;
let modo = "idle"; // "idle" | "activo"
let ocupado = false; // true mientras programa una tarea
let intervaloPaseo = null;
let intentosReconexion = 0;
let reconexionProgramada = false;

function miId() {
  return game && game.engine && game.engine.clientUid;
}

// ----------------------------- Presencia -----------------------------------

function contarHumanos() {
  const mi = miId();
  const jugadores = (game && game.players) || {};
  return Object.keys(jugadores).filter((id) => id !== mi).length;
}

function actualizarPresencia() {
  const humanos = contarHumanos();
  const nuevoModo = humanos > 0 ? "activo" : "idle";
  if (nuevoModo !== modo) {
    modo = nuevoModo;
    log("MODO", `${modo} (humanos=${humanos})`);
    aplicarEstadoVisible();
  }
}

function aplicarEstadoVisible() {
  try {
    if (ocupado) game.setTextStatus("💻 programando…");
    else if (modo === "activo") game.setTextStatus("🙂 en la oficina");
    else game.setTextStatus("💤 idle");
  } catch (_) {
    /* sin estado, no pasa nada */
  }
}

// ----------------------------- Movimiento ----------------------------------

function direccionAleatoria() {
  // 0=Left 1=Right 2=Up 3=Down (enum MoveDirection)
  return Math.floor(Math.random() * 4);
}

function darUnPaseo() {
  const dir = direccionAleatoria();
  const pasos = 1 + Math.floor(Math.random() * 3); // 1 a 3 pasos
  let i = 0;
  const paso = () => {
    if (i >= pasos) return;
    i += 1;
    try {
      game.move(dir);
    } catch (_) {
      /* ignorar */
    }
    setTimeout(paso, 350);
  };
  paso();
  log("MOVIMIENTO", `dir=${dir} pasos=${pasos}`);
}

function iniciarComportamiento() {
  detenerComportamiento();
  intervaloPaseo = setInterval(() => {
    // Solo se mueve si hay humanos (activo) y no está programando.
    if (modo === "activo" && !ocupado) darUnPaseo();
  }, PASEO_MS);
}

function detenerComportamiento() {
  if (intervaloPaseo) {
    clearInterval(intervaloPaseo);
    intervaloPaseo = null;
  }
}

// ------------------------------- Tareas ------------------------------------

function lanzarTarea(tarea, senderId, mapId, quien) {
  ocupado = true;
  aplicarEstadoVisible();
  log("TAREA_LANZADA", `de=${quien} tarea="${tarea}"`);

  ejecutarTarea({ repoUrl: REPO_URL, repoDir: REPO_DIR, modelo: MODELO, tarea, log })
    .then((res) => {
      let mensaje;
      if (res.sinCambios) {
        mensaje = `Revisé la tarea pero no hizo falta cambiar archivos. ${res.resumen}`;
      } else {
        mensaje = `✅ Listo. Subí la rama "${res.rama}" (commit ${res.commit}).\n${res.resumen}`;
      }
      enviarChat(senderId, mapId, mensaje);
      log("TAREA_OK", res.rama || "sin-cambios");
    })
    .catch((e) => {
      enviarChat(senderId, mapId, `Uy, tuve un problema con la tarea: ${e.message}`);
      log("ERROR_TAREA", e && e.message ? e.message : String(e));
    })
    .finally(() => {
      ocupado = false;
      aplicarEstadoVisible();
    });
}

// ------------------------------- Chat --------------------------------------

function enviarChat(destino, mapId, texto) {
  try {
    game.chat(destino, [], mapId, { contents: recortar(texto) });
  } catch (e) {
    log("ERROR_ENVIO_CHAT", e && e.message ? e.message : String(e));
  }
}

async function manejarChat(data, context) {
  try {
    const mi = miId();
    if (mi && data.senderId === mi) return; // ignorar mis propios mensajes
    if (TIPOS_IGNORADOS.includes(data.messageType)) {
      log("CHAT_IGNORADO", `tipo=${data.messageType}`);
      return;
    }
    const texto = (data.contents || "").trim();
    if (!texto) return;

    const quien = data.senderName || data.senderId;
    const mapId = (context && context.player && context.player.map) || data.roomId || "";
    log("MENSAJE_RECIBIDO", `de=${quien} texto="${texto}"`);

    if (ocupado) {
      enviarChat(data.senderId, mapId, "Estoy terminando otra tarea, dame un momento y te atiendo. 🙏");
      return;
    }

    const ruta = await enrutarMensaje({ modelo: MODELO, texto, repoNombre: REPO_NOMBRE });
    enviarChat(data.senderId, mapId, ruta.respuesta);
    log("RESPUESTA_ENVIADA", `a=${quien}`);

    if (ruta.esTarea && ruta.tarea) {
      if (!REPO_URL) {
        enviarChat(data.senderId, mapId, "Me encantaría, pero todavía no tengo configurado el repositorio.");
        return;
      }
      lanzarTarea(ruta.tarea, data.senderId, mapId, quien);
    }
  } catch (e) {
    log("ERROR_CHAT", e && e.message ? e.message : String(e));
  }
}

// ----------------------------- Conexión ------------------------------------

function conectar() {
  if (!game) {
    game = new Game(GATHER_SPACE_ID, () => Promise.resolve({ apiKey: GATHER_API_KEY }));

    game.subscribeToConnection((estaConectado) => {
      conectado = estaConectado;
      if (estaConectado) {
        intentosReconexion = 0;
        reconexionProgramada = false;
        log("CONECTADO", `space=${GATHER_SPACE_ID}`);
        try {
          game.enter({ name: NOMBRE_BOT });
          game.setName(NOMBRE_BOT);
          log("BOT_LISTO", `nombre=${NOMBRE_BOT}`);
        } catch (e) {
          log("ERROR_ENTRADA", e && e.message ? e.message : String(e));
        }
        actualizarPresencia();
        aplicarEstadoVisible();
        iniciarComportamiento();
      } else {
        log("CONEXION_PERDIDA", "connected=false");
        detenerComportamiento();
      }
    });

    game.subscribeToDisconnection((code, reason) => {
      conectado = false;
      log("DESCONECTADO", `code=${code !== undefined ? code : "?"} reason=${reason || ""}`);
      detenerComportamiento();
      programarReconexion();
    });

    game.subscribeToEvent("playerChats", manejarChat);
    game.subscribeToEvent("playerJoins", () => actualizarPresencia());
    game.subscribeToEvent("playerExits", () => actualizarPresencia());
  }

  log("CONECTANDO", `space=${GATHER_SPACE_ID}`);
  game.connect();
}

function programarReconexion() {
  if (reconexionProgramada) return;
  reconexionProgramada = true;
  intentosReconexion += 1;
  const espera = Math.min(30_000, 1000 * 2 ** intentosReconexion); // backoff, máx 30s
  log("RECONECTANDO", `intento=${intentosReconexion} en ${espera}ms`);
  setTimeout(() => {
    reconexionProgramada = false;
    if (conectado) {
      log("RECONEXION_CANCELADA", "ya estamos conectados");
      return;
    }
    try {
      conectar();
    } catch (e) {
      log("ERROR_RECONEXION", e && e.message ? e.message : String(e));
      programarReconexion();
    }
  }, espera);
}

// ------------------------------- Arranque ----------------------------------

process.on("unhandledRejection", (e) => {
  log("ERROR_NO_MANEJADO", e && e.message ? e.message : String(e));
});

process.on("SIGINT", () => {
  log("APAGANDO", "recibido Ctrl+C");
  detenerComportamiento();
  try {
    if (game) game.disconnect();
  } catch (_) {
    /* ignorar */
  }
  process.exit(0);
});

log("INICIO", `bot="${NOMBRE_BOT}" modelo=${MODELO} repo=${REPO_NOMBRE}`);
conectar();
