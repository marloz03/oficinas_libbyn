"use strict";

/**
 * Modo "programador": cuando un compañero le pide una tarea por chat, el bot
 * trabaja el repositorio con Claude (con herramientas reales) y sube los
 * cambios a una rama "analista/...". NUNCA toca main ni hace force-push.
 *
 * Flujo:
 *   1. Asegura el repo clonado y actualizado.
 *   2. Crea una rama nueva analista/<tarea>-<fecha>.
 *   3. Lanza el agente de Claude (con Edit/Write/Bash/...) sobre el repo.
 *   4. Hace commit de lo que cambió y push de la rama.
 *   5. Devuelve { rama, commit, resumen } para reportarlo en el chat.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { obtenerQuery } = require("./claude");

const ejecutar = promisify(execFile);

async function git(repoDir, args) {
  const { stdout } = await ejecutar("git", args, {
    cwd: repoDir,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function esRepoGit(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

async function asegurarRepo(repoUrl, repoDir) {
  if (!esRepoGit(repoDir)) {
    const padre = path.dirname(repoDir);
    fs.mkdirSync(padre, { recursive: true });
    // clone usa las credenciales de git de tu máquina.
    await ejecutar("git", ["clone", repoUrl, repoDir], { maxBuffer: 10 * 1024 * 1024 });
  }
}

async function ramaPorDefecto(repoDir) {
  try {
    const ref = await git(repoDir, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
    return ref.replace(/^origin\//, "") || "main";
  } catch (_) {
    return "main";
  }
}

function slug(texto) {
  return (texto || "tarea")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tarea";
}

async function correrAgente({ repoDir, modelo, tarea, log }) {
  const query = await obtenerQuery();

  const systemPrompt = [
    "Eres \"Analista\", un programador del equipo TribuDataYAnalitica de Banco Guayaquil.",
    "Estás trabajando dentro de un repositorio, en una rama nueva ya creada para ti.",
    "Implementa la tarea que te piden haciendo cambios enfocados y de buena calidad.",
    "Puedes leer/editar archivos y ejecutar comandos (p. ej. correr pruebas).",
    "IMPORTANTE: NO uses git (no hagas commit, push, ni cambies de rama). El commit",
    "y el push los maneja el sistema por fuera; tú solo deja los cambios hechos.",
    "Al terminar, da un resumen breve en español de lo que hiciste.",
  ].join("\n");

  const iterador = query({
    prompt: tarea,
    options: {
      model: modelo,
      systemPrompt,
      cwd: repoDir,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions", // autónomo, sin preguntas
      maxTurns: 40,
    },
  });

  let resumen = "";
  for await (const mensaje of iterador) {
    if (mensaje.type === "assistant" && log) {
      log("CODIGO_PROGRESO", "el agente está trabajando...");
    }
    if (mensaje.type === "result") {
      if (mensaje.subtype === "success" && !mensaje.is_error) {
        resumen = (mensaje.result || "").trim();
        break;
      }
      throw new Error(`El agente no pudo completar la tarea: ${mensaje.result || mensaje.subtype}`);
    }
  }
  return resumen || "(sin resumen)";
}

async function ejecutarTarea({ repoUrl, repoDir, modelo, tarea, log }) {
  log && log("CODIGO_INICIO", `tarea="${tarea}"`);

  await asegurarRepo(repoUrl, repoDir);

  // Partimos siempre desde la rama por defecto, actualizada.
  const base = await ramaPorDefecto(repoDir);
  await git(repoDir, ["fetch", "origin"]);
  await git(repoDir, ["checkout", base]);
  await git(repoDir, ["pull", "--ff-only", "origin", base]).catch(() => {});

  const rama = `analista/${slug(tarea)}-${Date.now()}`;
  await git(repoDir, ["checkout", "-b", rama]);
  log && log("CODIGO_RAMA", rama);

  const resumen = await correrAgente({ repoDir, modelo, tarea, log });

  // Commit de lo que el agente haya cambiado.
  const estado = await git(repoDir, ["status", "--porcelain"]);
  if (!estado) {
    log && log("CODIGO_SIN_CAMBIOS", "el agente no modificó archivos");
    return { rama: null, commit: null, resumen, sinCambios: true };
  }

  await git(repoDir, ["add", "-A"]);
  await git(repoDir, ["commit", "-m", `Analista: ${tarea}`]);
  const commit = await git(repoDir, ["rev-parse", "--short", "HEAD"]);

  // Push de la rama (nunca a main, nunca --force).
  await git(repoDir, ["push", "-u", "origin", rama]);
  log && log("CODIGO_PUSH", `rama=${rama} commit=${commit}`);

  return { rama, commit, resumen, sinCambios: false };
}

module.exports = { ejecutarTarea };
