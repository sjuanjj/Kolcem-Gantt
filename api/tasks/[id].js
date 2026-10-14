'use strict';
const db = require('../../lib/db');
const { handler, readBody } = require('../../lib/http');

function taskId(req) {
  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id < 0) throw new db.HttpError(400, 'Id de actividad inválido.');
  return id;
}

// /api/tasks/:id
module.exports = handler({
  GET: async (req, res) => res.status(200).json(await db.getTask(taskId(req))),
  PUT: async (req, res) => res.status(200).json(await db.updateTask(taskId(req), readBody(req))),
  PATCH: async (req, res) => res.status(200).json(await db.updateTask(taskId(req), readBody(req))),
  DELETE: async (req, res) => res.status(200).json({ deleted: await db.deleteTask(taskId(req)) })
});
