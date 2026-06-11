'use strict';

const { calcHotScore, loadData, data } = require('./lib/data');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Parse pathname from URL
  const urlStr = req.url || '/';
  const questionIdx = urlStr.indexOf('?');
  const pathname = questionIdx >= 0 ? urlStr.slice(0, questionIdx) : urlStr;

  // Root
  if (pathname === '/' || pathname === '' || pathname === '/index') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      name: 'Global Hot 50 API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: '/api/health',
        trending: '/api/trending/{domestic|international}/{finance|politics|military}'
      },
      examples: [
        '/api/trending/domestic/finance',
        '/api/trending/international/military'
      ]
    }));
  }

  // Health check
  if (pathname === '/api/health') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      status: 'ok',
      version: '1.0.0',
      time: new Date().toISOString()
    }));
  }

  // Trending endpoint
  const match = pathname.match(/^\/api\/trending\/(domestic|international)\/(finance|politics|military)$/);
  if (match) {
    const domain = match[1];
    const cat = match[2];
    const key = domain + '_' + cat;
    const raw = data[key];

    if (!raw) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Category not found' }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      domain: domain,
      category: cat,
      updated_at: Date.now(),
      items: loadData(domain, cat, raw)
    }));
  }

  // 404
  res.statusCode = 404;
  res.end(JSON.stringify({
    error: 'Not found',
    hint: 'Try /, /api/health, or /api/trending/{domain}/{category}'
  }));
};
