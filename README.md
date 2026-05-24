# Bot "Analista" para Gather.town

Un bot que aparece como un **avatar pixelado** dentro de un espacio de
[Gather.town](https://www.gather.town/), se comporta como un **oficinista
programador** y, cuando se lo piden por chat, **programa de verdad** en un
repositorio de GitHub usando Claude (Claude Code).

---

## ¿Qué hace exactamente?

- Se conecta a tu espacio de Gather y entra como un avatar llamado **`Analista`**.
- **Detecta si hay alguien más** en el espacio:
  - Si **no hay nadie** → se queda **IDLE** (quieto, estado 💤).
  - Si **hay alguien** → modo **oficinista**: camina por la oficina de vez en
    cuando (estado 🙂) y responde por chat.
- Responde el chat cercano como un **programador** del equipo TribuDataYAnalitica
  de Banco Guayaquil, breve y en español (modelo `claude-sonnet-4-5`).
- Cuando un compañero le pide una **tarea de programación** por chat:
  1. confirma que se pone con eso (estado 💻),
  2. trabaja el repositorio configurado (`REPO_URL`) con Claude,
  3. hace commit y **push a una rama `analista/...`** (NUNCA a `main`),
  4. reporta en el chat la rama y un resumen.
- Si Gather se cae, **intenta reconectarse solo**.
- Imprime en consola un registro con hora de cada evento importante.

> ⚠️ El modo programador hace **push autónomo** a ramas `analista/...`. Nunca
> toca `main` ni hace force-push, así que siempre puedes revisar o borrar lo que
> suba. Aun así, revisa sus ramas antes de fusionarlas.

---

## Requisitos previos

1. **Node.js 18 o superior** instalado. Verifícalo con:
   ```bash
   node -v
   ```
2. Una cuenta en **Gather.town** y un espacio (space) creado.
3. Una suscripción **Claude Pro o Max** (la misma de claude.ai). El bot la usa
   mediante **Claude Code**, así que **no necesitas API key de pago**.
4. (Para el modo programador) **git instalado y con permiso de push** al
   repositorio (`git push` debe funcionarte ahí normalmente), y correr el bot
   como **usuario normal** (no root/sudo): el agente de código necesita permisos
   no interactivos que se bloquean si corres como root.

---

## Paso 1 — Crear tu espacio en Gather

1. Entra a https://app.gather.town e inicia sesión.
2. Crea un espacio nuevo (botón **"Create Space"**). Elige cualquier plantilla;
   para la prueba sirve cualquiera.
3. Una vez dentro del espacio, mira la URL en el navegador. Se verá así:
   ```
   https://app.gather.town/app/AbCd1234efGh/MiEspacio
   ```
   El **Space ID** es la parte después de `/app/`, pero escrito con una **barra
   invertida** entre el código y el nombre:
   ```
   AbCd1234efGh\MiEspacio
   ```
   > Guárdalo, lo usarás en el archivo `.env` como `GATHER_SPACE_ID`.

---

## Paso 2 — Obtener tu API key de Gather

1. Ve a **https://gather.town**, entra a tu cuenta.
2. Abre el menú de tu usuario y busca la sección **"API Keys"**
   (también disponible vía https://developers.gather.town).
3. Crea una nueva API key y **cópiala** (es un texto largo).
   > Esta clave es tu `GATHER_API_KEY`. **No es tu contraseña**; trátala como secreta.

---

## Paso 3 — Conseguir tu token de Claude (con tu suscripción Max/Pro)

El bot responde usando tu suscripción de Claude, no una API de pago. Para eso
necesita un **token** que se genera iniciando sesión una vez con tu cuenta.
Esto se hace **en tu computadora** (el login abre tu navegador):

1. Instala **Claude Code** (necesitas Node.js). En una terminal:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Genera el token:
   ```bash
   claude setup-token
   ```
3. Se abrirá tu navegador para **iniciar sesión con tu cuenta Claude (Max/Pro)**
   y autorizar. Al terminar, la terminal te mostrará un token largo que empieza
   con `sk-ant-oat...`. **Cópialo.**
   > Este token es tu `CLAUDE_CODE_OAUTH_TOKEN`. Trátalo como secreto; dura
   > aproximadamente un año y puedes regenerarlo cuando quieras.

---

## Paso 4 — Configurar el proyecto

1. Instala las dependencias (desde la carpeta del proyecto):
   ```bash
   npm install
   ```

2. Crea tu archivo de configuración a partir de la plantilla:
   ```bash
   cp .env.example .env
   ```

3. Abre `.env` con cualquier editor y pega tus tres valores:
   ```env
   GATHER_API_KEY=tu_api_key_de_gather
   GATHER_SPACE_ID=AbCd1234efGh\MiEspacio
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...
   # Modo programador (opcional). Si lo dejas vacío, el bot solo conversa.
   REPO_URL=https://github.com/marloz03/Libbyn.git
   REPO_DIR=
   ```
   > `REPO_DIR` es opcional: por defecto clona el repo en `./workspace/Libbyn`.

   > ⚠️ **Nunca compartas ni subas el archivo `.env`.** Ya está protegido por
   > `.gitignore` para que no se suba a git por error.

---

## Paso 5 — Ejecutar el bot

```bash
node bot.js
```

(o, equivalente: `npm start`)

En la consola verás algo como:

```
[2026-05-24T19:40:00.000Z] INICIO :: bot="Analista" modelo=claude-sonnet-4-5
[2026-05-24T19:40:00.100Z] CONECTANDO :: space=AbCd1234efGh\MiEspacio
[2026-05-24T19:40:01.500Z] CONECTADO :: space=AbCd1234efGh\MiEspacio
[2026-05-24T19:40:01.600Z] BOT_LISTO :: nombre=Analista
[2026-05-24T19:40:31.600Z] MOVIMIENTO :: dir=Right
```

Ahora **entra a tu espacio de Gather desde el navegador**: deberías ver un
avatar llamado **Analista**. Acércate a él y escríbele por el chat: te
responderá en unos segundos.

Para **detener** el bot, presiona `Ctrl + C` en la terminal.

---

## Eventos que verás en los logs

| Evento              | Significado                                            |
|---------------------|--------------------------------------------------------|
| `INICIO`            | El programa arrancó.                                    |
| `CONECTANDO`        | Intentando conectar al space.                           |
| `CONECTADO`         | Conexión establecida con Gather.                        |
| `BOT_LISTO`         | El avatar "Analista" ya entró al mapa.                  |
| `MODO`              | Cambió entre `idle` (nadie) y `activo` (hay gente).     |
| `MOVIMIENTO`        | El bot dio un pasito (solo en modo activo).             |
| `MENSAJE_RECIBIDO`  | Alguien le escribió por chat.                           |
| `RESPUESTA_ENVIADA` | El bot contestó (texto generado por Claude).            |
| `TAREA_LANZADA`     | Detectó una tarea de programación y empezó a trabajarla.|
| `CODIGO_RAMA`       | Creó la rama `analista/...` para la tarea.              |
| `CODIGO_PUSH`       | Subió la rama con los cambios.                          |
| `TAREA_OK`          | Terminó la tarea (rama subida o sin cambios).           |
| `CHAT_IGNORADO`     | Mensaje global ignorado (el bot solo atiende cercanos). |
| `DESCONECTADO`      | Se perdió la conexión con Gather.                       |
| `RECONECTANDO`      | Reintentando conexión tras una caída.                   |
| `ERROR_*`           | Ocurrió un error (config, chat, Anthropic, etc.).       |

---

## Pedirle que programe

Estando cerca de "Analista" en el mapa, escríbele por chat una tarea, por ejemplo:

> "Analista, agrega un archivo CONTRIBUTING.md con las reglas de contribución"

Él decide si es una tarea o solo charla. Si es tarea: trabaja el repo, sube una
rama `analista/...` y te dice cuál en el chat. Luego revisa esa rama en GitHub
y, si te gusta, la fusionas tú.

---

## Solución de problemas

- **`Faltan variables en .env: ...`** → No llenaste alguna clave en `.env`.
  Revisa el Paso 4.
- **No aparece el avatar** → Confirma que el `GATHER_SPACE_ID` use la **barra
  invertida** (`\`) y coincida exactamente con tu URL. Verifica que la
  `GATHER_API_KEY` sea válida.
- **`ERROR_ANTHROPIC`** → Suele ser un `CLAUDE_CODE_OAUTH_TOKEN` inválido o
  vencido. Vuelve a generarlo con `claude setup-token` y actualiza el `.env`.
  Si el error menciona `authentication_failed`, es exactamente eso.
- **No responde a un mensaje** → Asegúrate de estar **cerca** del avatar al
  escribir (el bot solo atiende el chat cercano). Mira los logs: si ves
  `MENSAJE_RECIBIDO` pero no `RESPUESTA_ENVIADA`, revisa el error de Anthropic.

---

## Notas técnicas

- **SDK de Gather:** `@gathertown/gather-game-client` (v43, la versión oficial
  vigente). Se conecta por WebSocket; en Node se usa `isomorphic-ws` + `ws`.
- **Motor de IA:** `@anthropic-ai/claude-agent-sdk` (el SDK de Claude Code),
  autenticado con tu suscripción Max/Pro vía `CLAUDE_CODE_OAUTH_TOKEN`. No usa
  la API de pago.
- **Estructura:** `bot.js` (conexión, presencia, movimiento, ruteo de chat),
  `lib/claude.js` (decide si un mensaje es tarea o charla y genera la respuesta),
  `lib/programador.js` (git + agente de Claude que programa y sube la rama).
- **Seguridad del modo programador:** siempre rama `analista/...`, nunca `main`,
  nunca `--force`. El push usa las credenciales de git de tu máquina.
- **Sin TypeScript:** JavaScript plano (CommonJS) para reducir fricción.
- Las claves se leen siempre desde `.env`; **nunca** están escritas en el código.
