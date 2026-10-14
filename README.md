# KOLCEM · Diagrama de Gantt

Cronograma del proyecto KOLCEM con datos compartidos en una base de datos PostgreSQL.
Desde la página se pueden **crear, consultar, editar y eliminar** actividades, hitos y etapas.

## Estructura

- `index.html`: interfaz (Gantt). Lee y guarda los datos mediante la API.
- `api/tasks/index.js`: `GET /api/tasks` (listar), `POST /api/tasks` (crear), `PUT /api/tasks` (reemplazar todo, usado por "Importar avances").
- `api/tasks/[id].js`: `GET`, `PUT`/`PATCH` (actualizar) y `DELETE /api/tasks/:id`.
- `lib/db.js`: acceso a PostgreSQL. La tabla `tasks` se crea sola y se carga con `lib/seed.json` la primera vez.

## Despliegue en Vercel

1. En el proyecto de Vercel: **Storage → Create Database → Neon (Postgres)** y conéctala al proyecto.
   Esto crea la variable `DATABASE_URL` automáticamente (también sirve cualquier Postgres, p. ej. Supabase, definiendo `DATABASE_URL`).
2. Opcional: define `EDIT_TOKEN` para exigir una clave al crear, editar o eliminar. La página la pedirá una vez y la recordará en el navegador.
3. Haz push a GitHub; Vercel volverá a desplegar.

## Desarrollo local

```bash
npm install
DATABASE_URL=postgres://usuario:clave@localhost:5432/kolcem npm run dev
# http://localhost:3000
```

## Ejemplos de la API

```bash
# Crear una tarea al final de la etapa con id 6
curl -X POST /api/tasks -H "Content-Type: application/json" \
  -d '{"type":"task","parentId":6,"name":"Nueva tarea","start":"2026-10-01","end":"2026-10-05","deps":[{"id":11,"type":"FS"}]}'
# Actualizar estado
curl -X PUT /api/tasks/36 -H "Content-Type: application/json" -d '{"status":"Completado"}'
# Eliminar (si es una etapa, elimina también sus actividades)
curl -X DELETE /api/tasks/36
```

`type` puede ser `task`, `milestone` o `stage`. Las predecesoras usan los `id` internos; en la interfaz se escriben como número de fila (p. ej. `3, 5SS`).
