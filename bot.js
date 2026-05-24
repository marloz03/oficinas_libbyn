"use strict";

/**
 * Bot "Analista" para Gather.town.
 *
 * Qué hace:
 *  - Se conecta a un space de Gather y aparece como un avatar llamado "Analista".
 *  - Cada 30 s da un pasito al azar para verse "vivo".
 *  - Cuando alguien le escribe por chat (cerca de él), responde con Claude
 *    (Anthropic) en español y de forma breve.
 *  - Reconecta solo si Gather se cae (con espera incremental).
 *
 * Todas las claves se leen del archivo .env. NUNCA van escritas aquí.
 */

require("dotenv").config();

// El SDK de Gather usa el objeto global `WebSocket`. En Node lo proveemos con
// isomorphic-ws (que por debajo usa el paquete `ws`).
global.WebSocket = require("isomorphic-ws");

const { Game, MoveDirection } = require("@gathertown/gather-game-client");
const Anthropic = require("@anthropic-ai/sdk");

// ------------------------------ Configuración ------------------------------

const { GATHER_API_KEY, GATHER_SPACE_ID, ANTHROPIC_API_KEY } = process.env;

const NOMBRE_BOT = "Analista";
const MODELO = "claude-sonnet-4-5";
const SYSTEM_PROMPT =
  "Eres un analista de datos del equipo TribuDataYAnalitica de Banco Guayaquil. Responde breve y en español.";

const INTERVALO_MOVIMIENTO_MS = 30_000; // un pasito cada 30 s
const MAX_TOKENS_RESPUESTA = 400; // respuestas breves

// Tipos de mensaje que NO respondemos (mensajes globales del space).
// Así el bot solo atiende conversaciones cercanas. Si ves en los logs algún
// otro tipo global que no quieras responder, agrégalo aquí.
const TIPOS_IGNORADOS = ["GLOBAL_CHAT"];

// ------------------------------ Utilidades --------------------------------

function log(evento, detalle) {
  const ts = new Date().toISOString();
  if (detalle === undefined || detalle === "") {
    console.log(`[${ts}] ${evento}`);
  } else {
    console.log(`[${ts}] ${evento} :: ${detalle}`);
  }
}

function variablesFaltantes() {
  const faltan = [];
  if (!GATHER_API_KEY) faltan.push("GATHER_API_KEY");
  if (!GATHER_SPACE_ID) faltan.push("GATHER_SPACE_ID");
  if (!ANTHROPIC_API_KEY) faltan.push("ANTHROPIC_API_KEY");
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

// ------------------------------ Anthropic ----------------------------------

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function pensarRespuesta(textoUsuario) {
  const respuesta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS_RESPUESTA,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: textoUsuario }],
  });

  const texto = (respuesta.content || [])
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("\n")
    .trim();

  return texto || "(no tengo una respuesta en este momento)";
}

// --------------------------- Estado de conexión ----------------------------

let game;
let conectado = false;
let intervaloMovimiento = null;
let intentosReconexion = 0;
let reconexionProgramada = false;

// ----------------------------- Movimiento ----------------------------------

function direccionAleatoria() {
  const direcciones = [
    MoveDirection.Left,
    MoveDirection.Right,
    MoveDirection.Up,
    MoveDirection.Down,
  ];
  return direcciones[Math.floor(Math.random() * direcciones.length)];
}

function iniciarMovimiento() {
  detenerMovimiento();
  intervaloMovimiento = setInterval(() => {
    try {
      const dir = direccionAleatoria();
      game.move(dir);
      log("MOVIMIENTO", `dir=${MoveDirection[dir]}`);
    } catch (error) {
      log("ERROR_MOVIMIENTO", error && error.message ? error.message : String(error));
    }
  }, INTERVALO_MOVIMIENTO_MS);
}

function detenerMovimiento() {
  if (intervaloMovimiento) {
    clearInterval(intervaloMovimiento);
    intervaloMovimiento = null;
  }
}

// ------------------------------- Chat --------------------------------------

function manejarChat(data, context) {
  try {
    const miId = game.engine && game.engine.clientUid;

    // 1) Ignorar mis propios mensajes (evita un bucle infinito de respuestas).
    if (miId && data.senderId === miId) return;

    // 2) Ignorar mensajes globales -> el bot solo atiende lo cercano.
    if (TIPOS_IGNORADOS.includes(data.messageType)) {
      log("CHAT_IGNORADO", `tipo=${data.messageType} de=${data.senderName || data.senderId}`);
      return;
    }

    const texto = (data.contents || "").trim();
    if (!texto) return;

    const quien = data.senderName || data.senderId;
    log("MENSAJE_RECIBIDO", `de=${quien} tipo=${data.messageType} texto="${texto}"`);

    // Mapa donde está la persona que escribió (necesario para enviar el chat).
    const mapId = (context && context.player && context.player.map) || data.roomId || "";

    pensarRespuesta(texto)
      .then((respuesta) => {
        // Respondemos directamente a quien escribió (le llega como mensaje suyo).
        game.chat(data.senderId, [], mapId, { contents: respuesta });
        log("RESPUESTA_ENVIADA", `a=${quien} texto="${respuesta}"`);
      })
      .catch((error) => {
        log("ERROR_ANTHROPIC", error && error.message ? error.message : String(error));
      });
  } catch (error) {
    log("ERROR_CHAT", error && error.message ? error.message : String(error));
  }
}

// ----------------------------- Conexión ------------------------------------

function conectar() {
  // Reutilizamos una sola instancia de Game para no duplicar el avatar.
  if (!game) {
    game = new Game(GATHER_SPACE_ID, () =>
      Promise.resolve({ apiKey: GATHER_API_KEY })
    );

    game.subscribeToConnection((estaConectado) => {
      conectado = estaConectado;
      if (estaConectado) {
        intentosReconexion = 0;
        reconexionProgramada = false;
        log("CONECTADO", `space=${GATHER_SPACE_ID}`);
        try {
          game.enter({ name: NOMBRE_BOT });
          log("BOT_LISTO", `nombre=${NOMBRE_BOT}`);
        } catch (error) {
          log("ERROR_ENTRADA", error && error.message ? error.message : String(error));
        }
        iniciarMovimiento();
      } else {
        log("CONEXION_PERDIDA", "connected=false");
        detenerMovimiento();
      }
    });

    game.subscribeToDisconnection((code, reason) => {
      conectado = false;
      log("DESCONECTADO", `code=${code !== undefined ? code : "?"} reason=${reason || ""}`);
      detenerMovimiento();
      programarReconexion();
    });

    game.subscribeToEvent("playerChats", manejarChat);
  }

  log("CONECTANDO", `space=${GATHER_SPACE_ID}`);
  game.connect();
}

function programarReconexion() {
  if (reconexionProgramada) return;
  reconexionProgramada = true;
  intentosReconexion += 1;

  // Espera incremental (backoff): 2s, 4s, 8s, 16s, ... máx 30s.
  const espera = Math.min(30_000, 1000 * 2 ** intentosReconexion);
  log("RECONECTANDO", `intento=${intentosReconexion} en ${espera}ms`);

  setTimeout(() => {
    reconexionProgramada = false;
    if (conectado) {
      log("RECONEXION_CANCELADA", "ya estamos conectados");
      return;
    }
    try {
      conectar();
    } catch (error) {
      log("ERROR_RECONEXION", error && error.message ? error.message : String(error));
      programarReconexion();
    }
  }, espera);
}

// ------------------------------- Arranque ----------------------------------

process.on("unhandledRejection", (error) => {
  log("ERROR_NO_MANEJADO", error && error.message ? error.message : String(error));
});

process.on("SIGINT", () => {
  log("APAGANDO", "recibido Ctrl+C");
  detenerMovimiento();
  try {
    if (game) game.disconnect();
  } catch (_) {
    // ignorar errores al cerrar
  }
  process.exit(0);
});

log("INICIO", `bot="${NOMBRE_BOT}" modelo=${MODELO}`);
conectar();
