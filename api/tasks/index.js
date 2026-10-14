'use strict';
const db = require('../../lib/db');
const { handler, readBody } = require('../../lib/http');

// /api/tasks
module.exports = handler({
  // Listar todas las actividades en orden.
  GET: async (req, res) => res.status(200).json(await db.listTasks()),
  // Crear una etapa, tarea o hito.
  POST: async (req, res) => res.status(201).json(await db.createTask(readBody(req))),
  // Reemplazar el cronograma completo (importación).
  PUT: async (req, res) => res.status(200).json(await db.replaceAll(readBody(req)))
});
