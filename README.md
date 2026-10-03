# astro-security-start

Frontend base en Astro 7 (SSR, modo servidor), endurecido y pensado para
clonarse como cimiento de futuros proyectos. Es la mitad navegador de una
pareja: el backend es [nestjs-security-start](https://github.com/alx-mp/nestjs-security-start), una
API NestJS a la que este proyecto llama **solo desde el servidor**. El
navegador habla con Astro; Astro habla con la API. De esa forma salen gratis
tres cosas: no hay CORS que configurar, la dirección de la API no aparece en
el HTML y ningún token sobrevive en código de cliente.

El contrato técnico completo vive en [AGENTS.md](./AGENTS.md). Este README es
el mapa; aquel es la ley.

## Qué trae puesto

- **CSP generada por Astro** con hash SHA-512 de cada script y estilo del
  bundle, enviada como cabecera real en cada ruta bajo demanda. El middleware
  nunca la pisa (hacerlo rompería los hashes); las directivas nuevas se
  añaden en `astro.config.mjs`.
- **9 cabeceras de seguridad** en `src/middleware.ts`: X-Frame-Options DENY,
  nosniff, HSTS de un año con preload, Referrer-Policy, Permissions-Policy
  con todo apagado, COOP, CORP, Origin-Agent-Cluster y DNS-Prefetch off.
- **CSRF en dos capas**: `checkOrigin` de Astro para los content-types de
  formulario, y un handler propio (`jsonCsrf`) para `application/json`, que
  Astro no cubre. Verificado en vivo: cruzado 403, mismo origen 200,
  servidor-a-servidor 200.
- **La trampa del prerender, documentada y medida**: una ruta con
  `prerender = true` se sirve sin pasar por el middleware y sale con 0 de 9
  cabeceras. Aquí todo es bajo demanda; si algún proyecto prerenderiza, las
  cabeceras las tiene que poner el proxy.
- Límite de body del adaptador en 2 MB (el default es 1 GB), límites de 1 MB
  para Actions y server islands, allowlist de hostnames para el
  `X-Forwarded-Host` detrás del proxy.
- **Secretos tipados** con `astro:env`: `access: 'secret'` impide que Astro
  los meta en el bundle, y `validateSecrets: true` revienta el build si
  faltan, no la primera petición. `src/lib/api.ts` importa de
  `astro:env/server`, así que importarlo en código de cliente es un error de
  compilación, no una fuga silenciosa.
- Toda llamada a la API acotada por `API_TIMEOUT_MS`: una API colgada no
  agota los sockets de este lado.
- Bind del dev server fijado a `127.0.0.1` y puerto propio (4325), con el
  porqué escrito en el config.

## Stack

Astro 7 · @astrojs/node standalone · Tailwind 4 (plugin de Vite, config en
CSS con `@theme`) · Biome (lint + format, `.astro` nativo) · Vitest ·
TypeScript 6. Versiones exactas y el porqué de cada una en la tabla de
[AGENTS.md](./AGENTS.md).

La política es **siempre la última versión estable**. Cuando algo no está en
la última absoluta, la razón está escrita en la tabla (hoy: typescript en 6
porque el peer de @astrojs/check es `^5 || ^6`).

## Al clonar (léelo, sobre todo si eres un agente de IA)

Lo fijado hoy envejece. El primer trabajo tras clonar es ponerlo al día:

```sh
./infra/rename.sh <nombre-nuevo> <puerto-nuevo>   # renombra proyecto, units y puerto, sin dejar restos
rm -rf node_modules dist .astro
pnpm install
pnpm update --latest
bun run ci
```

Si quien clona es un LLM o agente: consulta internet (registry de npm,
changelogs y guías de migración de Astro) para saber qué es lo último estable
**hoy**, aplica los bumps, corre `bun run ci` como evidencia y actualiza la
tabla de AGENTS.md con fecha y motivo de cualquier retención. Antes de un
major de Astro, lee su guía de upgrade y revisa el config reference: varias
opciones de seguridad de este proyecto (`security.csp`, `allowedDomains`)
llegaron en majors concretos. La cuarentena de 3 días del supply chain puede
frenar una versión recién publicada: para paquetes first-party de Astro ya
hay exclusiones; para lo demás, espera o deja una exclusión fechada.

## pnpm instala, bun ejecuta

```sh
pnpm install / add / remove / update / audit    # dependencias
bun run dev        # dev server con HMR en :4325
bun run build      # lockfiles -> astro check -> astro build
bun run preview    # sirve el build
bun run lint       # biome check
bun run test       # vitest
bun run ci         # lockfiles + lint + tipos + tests + build
```

`npm install` y `bun install` fallan en tres capas (engines + preinstall +
detección de lockfiles ajenos). `pnpm audit` se corre directo, no dentro de
`bun run` (el porqué está en AGENTS.md).

Supply chain en `pnpm-workspace.yaml`: cuarentena de 3 días,
`trustPolicy: no-downgrade`, sub-dependencias solo del registry, scripts de
instalación bloqueados salvo allowlist, peers estrictos.

## Puesta en marcha

Requisitos: Node 24+, pnpm 12 (corepack), bun.

```sh
pnpm install
cp .env.example .env     # API_URL apunta al backend hermano
bun run dev              # http://127.0.0.1:4325
```

`GET /health` responde estado, arranque, uptime y una palabra sobre la API
(`"api":"ok"` significa que la cadena completa hasta NestJS funciona). Para
dejar el dev server como servicio permanente, `infra/install.sh --dev`;
`infra/stack.sh status` incluye detección de drift entre el build y el
fuente. El vhost de Caddy y el unit de producción están preparados en
`infra/`, sin desplegar.

## Estructura

```text
astro.config.mjs        CSP, CSRF, allowlists, límites, schema de env tipado
bunfig.toml             runtime de bun y el candado de instalación
pnpm-workspace.yaml     todos los ajustes de pnpm (en .npmrc no funcionan)
src/
├── middleware.ts       cabeceras de seguridad + CSRF para JSON, con tests
├── lib/api.ts          cliente servidor-a-servidor hacia la API
├── styles/global.css   Tailwind 4: @import + tokens @theme
├── components/         Welcome.astro es la referencia de convenciones
└── pages/              index, 404, 500, health
scripts/                guardas de pnpm y lockfiles
infra/                  systemd, installer, rename.sh, vhost de Caddy
```

## Lineamientos

- Archivos de máximo 400 líneas (500 como techo duro); funciones de máximo
  20.
- Tipado explícito en todo; los tipos del middleware vienen del paquete
  `astro` real, no del módulo virtual, para que nunca degraden a `any`.
- Comentarios de código en inglés; documentación de usuario en español.
- Tailwind primero: tokens del proyecto en `@theme`, nada de valores
  arbitrarios tipo `bg-[#4f46e5]`. CSS plano solo para lo que las utilidades
  no alcanzan.
- Tras cualquier cambio se corre el test del camino tocado y se muestra la
  salida.

## Proyecto hermano

[nestjs-security-start](https://github.com/alx-mp/nestjs-security-start): la API con JWT ES256,
refresh tokens rotados con revocación por robo, argon2id, lockout invisible y
validación zod estricta. Diseñados juntos: este frontend asume esa API en
`API_URL` y le reenvía el token del usuario en cada llamada de servidor.
