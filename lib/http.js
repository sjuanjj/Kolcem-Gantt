'use strict';
const { HttpError } = require('./db');

// Si EDIT_TOKEN está definido en Vercel, las operaciones de escritura exigen la cabecera X-Edit-Token.
function requireEditor(req) {
  const token = process.env.EDIT_TOKEN;
  if (token && req.headers['x-edit-token'] !== token) throw new HttpError(401, 'Clave de edición incorrecta o ausente.');
}

function readBody(req) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  if (body === undefined || body === null) throw new HttpError(400, 'Falta el cuerpo JSON de la petición.');
  return body;
}

function handler(methods) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const fn = methods[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      return res.status(405).json({ error: `Método ${req.method} no permitido.` });
    }
    try {
      if (req.method !== 'GET') requireEditor(req);
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error(err);
      res.status(status).json({ error: status === 500 ? 'Error interno del servidor: ' + err.message : err.message });
    }
  };
}

module.exports = { handler, readBody };
