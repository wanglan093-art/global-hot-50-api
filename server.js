'use strict';

const express = require('express');
const cors = require('cors');
const { fetchNews } = require('./lib/fetch-news');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Root
app.get('/', function(_, res) {
  res.json({
    name: 'Global Hot 50 API',
    version: '2.0.0',
    endpoint: '/api/trending/{domestic|international}/{finance|politics|military}',
    health: '/api/health',
    sources: {
      domestic: 'Juhe 聚合数据 (v.juhe.cn)',
      international: 'NewsAPI (newsapi.org)'
    },
    cache: '30 minutes'
  });
});

// Trending - with real API fallback to mock
app.get('/api/trending/:domain/:category', async function(req, res) {
  const domain = req.params.domain;
  const cat = req.params.category;

  // Validate
  const validDomains = ['domestic', 'international'];
  const validCats = ['finance', 'politics', 'military'];
  if (!validDomains.includes(domain) || !validCats.includes(cat)) {
    return res.status(404).json({
      error: 'Invalid domain/category',
      valid: [
        'domestic-finance', 'domestic-politics', 'domestic-military',
        'international-finance', 'international-politics', 'international-military'
      ]
    });
  }

  try {
    const result = await fetchNews(domain, cat);
    res.json(result);
  } catch (err) {
    console.error('Trending error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch news from source',
      domain, category: cat,
      message: err.message
    });
  }
});

// Health
app.get('/api/health', function(_, res) {
  res.json({ status: 'ok', version: '2.0.0', uptime: process.uptime() });
});

// 404
app.use(function(_, res) {
  res.status(404).json({ error: 'Not found', hint: 'Try / for API docs or /api/health' });
});

// Local dev only
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', function() {
    console.log('Global Hot 50 API v2.0 server running on port ' + PORT);
    console.log('Domestic: Juhe 聚合数据');
    console.log('International: NewsAPI');
  });
}

module.exports = app;
