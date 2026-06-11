'use strict';

const { fetchNews } = require('./lib/fetch-news');

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
  const urlStr = req.url || '/';
  const questionIdx = urlStr.indexOf('?');
  const pathname = questionIdx >= 0 ? urlStr.slice(0, questionIdx) : urlStr;

  if (pathname === '/' || pathname === '' || pathname === '/index') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      name: 'Global Hot 50 API', version: '2.0.0',
      endpoints: { health: '/api/health', trending: '/api/trending/{domain}/{category}' },
      sources: { domestic: 'Juhe 聚合数据', international: 'NewsAPI' }
    }));
  }

  if (pathname === '/api/health') {
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', version: '2.0.0', time: new Date().toISOString() }));
  }

  const match = pathname.match(/^\/api\/trending\/(domestic|international)\/(finance|politics|military)$/);
  if (match) {
    try {
      const result = await fetchNews(match[1], match[2]);
      res.statusCode = 200;
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: 'Fetch failed', message: err.message }));
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
};
