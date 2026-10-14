'use strict';
const { Pool, types } = require('pg');
const seed = require('./seed.json');

// Las columnas DATE se devuelven como texto 'YYYY-MM-DD' para evitar desfases por zona horaria.
types.setTypeParser(1082, v => v);

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool;
function getPool() {
  if (!connectionString) throw new HttpError(500, 'Falta configurar DATABASE_URL (o POSTGRES_URL) en las variables de entorno.');
  if (!pool) pool = new Pool({ connectionString, max: 3 });
  return pool;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const COLUMNS = `id, position, name, level, summary, milestone, start_date AS start, end_date AS "end",
  progress, status, owner, notes, deps`;

let ready;
// Crea la tabla y carga el cronograma original la primera vez que se usa la base de datos.
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const db = getPool();
      await db.query(`CREATE TABLE IF NOT EXISTS tasks (
        id integer PRIMARY KEY,
        position integer NOT NULL,
        name text NOT NULL,
        level smallint NOT NULL,
        summary boolean NOT NULL DEFAULT false,
        milestone boolean NOT NULL DEFAULT false,
        start_date date NOT NULL,
        end_date date NOT NULL,
        progress integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT '',
        owner text NOT NULL DEFAULT '',
        notes text NOT NULL DEFAULT '',
        deps jsonb NOT NULL DEFAULT '[]',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM tasks');
      if (rows[0].n === 0) await withTransaction(c => insertAll(c, seed));
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertAll(client, list) {
  for (const [i, t] of list.entries()) {
    await client.query(
      `INSERT INTO tasks (id, position, name, level, summary, milestone, start_date, end_date, progress, status, owner, notes, deps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      [t.id, i, t.name, t.level, t.summary, t.milestone, t.start, t.end, t.progress, t.status, t.owner, t.notes, JSON.stringify(t.deps)]
    );
  }
}

// ---------- Validación ----------
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

function cleanDeps(deps, selfId, existingIds) {
  if (deps === undefined) return undefined;
  if (!Array.isArray(deps)) throw new HttpError(400, 'Las predecesoras deben ser una lista.');
  const seen = new Set();
  return deps.map(d => {
    const id = Number(d?.id), type = d?.type === 'SS' ? 'SS' : 'FS';
    if (!Number.isInteger(id) || id === selfId || !existingIds.has(id)) throw new HttpError(400, `Predecesora inválida: ${d?.id + 1}`);
    return { id, type };
  }).filter(d => !seen.has(d.id) && seen.add(d.id));
}

// Aplica los campos editables de `input` sobre `task` (in place).
function applyFields(task, input, existingIds) {
  if (input.name !== undefined) task.name = text(input.name, 300);
  if (input.status !== undefined) task.status = text(input.status, 120);
  if (input.owner !== undefined) task.owner = text(input.owner, 120);
  if (input.notes !== undefined) task.notes = text(input.notes, 5000);
  if (input.progress !== undefined) task.progress = Math.max(0, Math.min(100, Math.round(Number(input.progress) || 0)));
  if (input.start !== undefined) task.start = input.start;
  if (input.end !== undefined) task.end = input.end;
  const deps = cleanDeps(input.deps, task.id, existingIds);
  if (deps !== undefined) task.deps = task.summary ? [] : deps;
  if (task.milestone) task.end = task.start;
  if (!task.name) throw new HttpError(400, 'El nombre es obligatorio.');
  if (!isDate(task.start) || !isDate(task.end)) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD.');
  if (task.end < task.start) throw new HttpError(400, 'La fecha de fin no puede ser anterior a la de comienzo.');
  return task;
}

async function save(client, t) {
  await client.query(
    `UPDATE tasks SET name=$2, start_date=$3, end_date=$4, progress=$5, status=$6, owner=$7, notes=$8, deps=$9, updated_at=now() WHERE id=$1`,
    [t.id, t.name, t.start, t.end, t.progress, t.status, t.owner, t.notes, JSON.stringify(t.deps)]
  );
}

// ---------- Operaciones CRUD ----------
async function listTasks() {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT ${COLUMNS} FROM tasks ORDER BY position`);
  return rows;
}

async function getTask(id) {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT ${COLUMNS} FROM tasks WHERE id=$1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Actividad no encontrada.');
  return rows[0];
}

/**
 * Crea una etapa (type='stage'), tarea (type='task') o hito (type='milestone').
 * Las tareas e hitos se insertan al final de la etapa indicada en `parentId`.
 */
async function createTask(input) {
  await ensureSchema();
  return withTransaction(async c => {
    await c.query('LOCK TABLE tasks IN EXCLUSIVE MODE');
    const { rows: all } = await c.query(`SELECT id, position, level FROM tasks ORDER BY position`);
    const ids = new Set(all.map(r => r.id));
    const type = ['stage', 'task', 'milestone'].includes(input.type) ? input.type : 'task';
    const id = Math.max(-1, ...all.map(r => r.id)) + 1;
    let position, level;
    if (type === 'stage') {
      level = 1;
      position = Math.max(-1, ...all.map(r => r.position)) + 1;
    } else {
      level = 2;
      const parent = all.find(r => r.id === Number(input.parentId) && r.level === 1);
      if (!parent) throw new HttpError(400, 'Selecciona una etapa válida para la actividad.');
      const nextStage = all.find(r => r.level === 1 && r.position > parent.position);
      position = nextStage ? nextStage.position : Math.max(...all.map(r => r.position)) + 1;
      await c.query('UPDATE tasks SET position = position + 1 WHERE position >= $1', [position]);
    }
    const task = applyFields({
      id, level, summary: type === 'stage', milestone: type === 'milestone',
      name: '', start: '', end: '', progress: 0, status: 'Pendiente', owner: '', notes: '', deps: []
    }, input, ids);
    await c.query(
      `INSERT INTO tasks (id, position, name, level, summary, milestone, start_date, end_date, progress, status, owner, notes, deps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, position, task.name, level, task.summary, task.milestone, task.start, task.end, task.progress, task.status, task.owner, task.notes, JSON.stringify(task.deps)]
    );
    const { rows } = await c.query(`SELECT ${COLUMNS} FROM tasks WHERE id=$1`, [id]);
    return rows[0];
  });
}

async function updateTask(id, input) {
  await ensureSchema();
  return withTransaction(async c => {
    const { rows } = await c.query(`SELECT ${COLUMNS} FROM tasks WHERE id=$1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Actividad no encontrada.');
    const { rows: idRows } = await c.query('SELECT id FROM tasks');
    const task = applyFields(rows[0], input, new Set(idRows.map(r => r.id)));
    await save(c, task);
    return task;
  });
}

/** Elimina una actividad. Si es una etapa, elimina también sus actividades. Devuelve los ids eliminados. */
async function deleteTask(id) {
  await ensureSchema();
  if (id === 0) throw new HttpError(400, 'No se puede eliminar el proyecto raíz.');
  return withTransaction(async c => {
    await c.query('LOCK TABLE tasks IN EXCLUSIVE MODE');
    const { rows: all } = await c.query(`SELECT id, position, level FROM tasks ORDER BY position`);
    const target = all.find(r => r.id === id);
    if (!target) throw new HttpError(404, 'Actividad no encontrada.');
    let removed = [id];
    if (target.level === 1) {
      const next = all.find(r => r.level <= 1 && r.position > target.position);
      removed = all.filter(r => r.position >= target.position && (!next || r.position < next.position)).map(r => r.id);
    }
    await c.query('DELETE FROM tasks WHERE id = ANY($1::int[])', [removed]);
    // Quitar referencias a las actividades eliminadas en las predecesoras de las demás.
    await c.query(
      `UPDATE tasks SET deps = COALESCE((SELECT jsonb_agg(d) FROM jsonb_array_elements(deps) d
         WHERE NOT ((d->>'id')::int = ANY($1::int[]))), '[]'::jsonb), updated_at = now()
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(deps) d WHERE (d->>'id')::int = ANY($1::int[]))`,
      [removed]
    );
    return removed;
  });
}

/** Reemplaza todo el cronograma (usado por "Importar avances"). */
async function replaceAll(list) {
  await ensureSchema();
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'El archivo debe contener una lista de actividades.');
  const ids = new Set();
  const clean = list.map(t => {
    const id = Number(t?.id), level = Number(t?.level);
    if (!Number.isInteger(id) || id < 0 || ids.has(id)) throw new HttpError(400, `Id de actividad inválido o repetido: ${t?.id}`);
    if (![0, 1, 2].includes(level)) throw new HttpError(400, `Nivel inválido en la actividad ${id + 1}`);
    ids.add(id);
    return { id, level, summary: !!t.summary, milestone: !!t.milestone, name: '', start: '', end: '', progress: 0, status: '', owner: '', notes: '', deps: [], _src: t };
  });
  if (clean[0].id !== 0 || clean[0].level !== 0) throw new HttpError(400, 'La primera fila debe ser el proyecto raíz (id 0).');
  for (const t of clean) { applyFields(t, t._src, ids); delete t._src; }
  await withTransaction(async c => {
    await c.query('LOCK TABLE tasks IN EXCLUSIVE MODE');
    await c.query('DELETE FROM tasks');
    await insertAll(c, clean);
  });
  return listTasks();
}

module.exports = { HttpError, listTasks, getTask, createTask, updateTask, deleteTask, replaceAll };
