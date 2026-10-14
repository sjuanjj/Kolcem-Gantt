'use strict';
// Servidor local que imita el enrutado de Vercel: sirve index.html y las funciones de /api.
// Uso: DATABASE_URL=postgres://... npm run dev
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tasksIndex = require('../api/tasks/index');
const taskById = require('../api/tasks/[id]');

function enhance(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
}

http.createServer(async (req, res) => {
  enhance(res);
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  req.body = raw;
  req.query = Object.fromEntries(url.searchParams);
  if (url.pathname === '/api/tasks') return tasksIndex(req, res);
  const m = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (m) { req.query.id = decodeURIComponent(m[1]); return taskById(req, res); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(fs.readFileSync(path.join(root, 'index.html')));
  }
  res.status(404).end('No encontrado');
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
