'use strict';

const express = require('express');
const cors = require('cors');
const { calcHotScore, loadData, data } = require('./lib/data');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Root
app.get('/', function(_, res) {
  res.json({
    name: 'Global Hot 50 API',
    version: '1.0.0',
    endpoints: '/api/trending/{domestic|international}/{finance|politics|military}',
    health: '/api/health'
  });
});

// Trending
app.get('/api/trending/:domain/:category', function(req, res) {
  var domain = req.params.domain;
  var cat = req.params.category;
  var key = domain + '_' + cat;
  var raw = data[key];

  if (!raw) {
    return res.status(404).json({
      error: 'Invalid domain/category',
      valid: [
        'domestic-finance', 'domestic-politics', 'domestic-military',
        'international-finance', 'international-politics', 'international-military'
      ]
    });
  }

  res.json({
    domain: domain,
    category: cat,
    updated_at: Date.now(),
    items: loadData(domain, cat, raw)
  });
});

// Health
app.get('/api/health', function(_, res) {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// 404
app.use(function(_, res) {
  res.status(404).json({ error: 'Not found', hint: 'Try / for API docs or /api/health' });
});

// Local dev only
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', function() {
    console.log('Global Hot 50 API server running on port ' + PORT);
  });
}

module.exports = app;
