'use strict';

const http = require('http');
const https = require('https');
const { SOURCES, calcHotScore, loadData } = require('./data');
const cache = require('./cache');

const JUHE_KEY = 'b093df77b8f4e7be84ef90efd77dc0eb';
const NEWSAPI_KEY = '480168630be8476bb441a241ae4e3780';
const NEWSAPI_BASE = 'newsapi.org';

// Source name mapping: try to match API source names to our SOURCES
function matchSource(name) {
  const lower = (name || '').toLowerCase();
  const map = {
    '新华社': 'Xinhua', '新华': 'Xinhua', 'xinhua': 'Xinhua',
    '央视': 'CCTV', 'cctv': 'CCTV', '央视新闻': 'CCTV',
    '人民': 'PeopleDaily', '人民日报': 'PeopleDaily',
    '环球': 'GTimes', '环球时报': 'GTimes',
    '中国日报': 'ChinaDaily', 'china daily': 'ChinaDaily',
    '财新': 'Caixin', 'caixin': 'Caixin',
    '证券': 'CNStock', '证券时报': 'CNStock',
    '商务部': 'MOFCOM',
    '央行': 'PBOC',
    '国防部': 'MOD',
    '解放军': 'PLADaily', '解放军报': 'PLADaily',
    '航天': 'CNSA', '中国航天': 'CNSA',
    'reuters': 'Reuters', '路透': 'Reuters',
    'bloomberg': 'Bloomberg', '彭博': 'Bloomberg',
    'bbc': 'BBC',
    'wall street journal': 'WSJ', 'wsj': 'WSJ',
    'financial times': 'FT', 'ft': 'FT',
    'associated press': 'AP', 'ap': 'AP',
    'defense news': 'DefenseNews', 'defensenews': 'DefenseNews',
    'usni': 'USNI',
    'economist': 'Economist',
    'nhk': 'NHK',
    'al jazeera': 'AlJazeera', 'aljazeera': 'AlJazeera',
    'guardian': 'Guardian',
    'new york times': 'NYT', 'nyt': 'NYT',
    'south china morning post': 'SCMP', 'scmp': 'SCMP',
    'politico': 'Politico',
    'jane': 'JaneDef', 'janes': 'JaneDef',
    'military times': 'MilitaryTimes', 'militarytimes': 'MilitaryTimes',
    '发改委': 'NDRC',
  };
  for (const [k, v] of Object.entries(map)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

function getSource(name) {
  const matched = matchSource(name);
  if (matched && SOURCES[matched]) {
    return SOURCES[matched];
  }
  // Return a default source
  return { color: '#888888', label: (name || '??').slice(0, 2).toUpperCase(), full: name || '未知来源' };
}

// ---------- Juhe API (domestic news) ----------
const JUHE_TYPES = {
  'finance': 'caijing',
  'politics': 'guonei',
  'military': 'junshi'
};

async function fetchJuhe(type) {
  return new Promise((resolve, reject) => {
    const juheType = JUHE_TYPES[type] || type;
    const url = `http://v.juhe.cn/toutiao/index?key=${JUHE_KEY}&type=${juheType}`;
    http.get(url, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reasonOk = json.reason === 'success!' || json.reason === 'success';
          if (!reasonOk || !json.result || !json.result.data) {
            return reject(new Error('Juhe API error: ' + (json.reason || 'unknown') + ' stat:' + (json.result?.stat || 'none')));
          }
          resolve(json.result.data);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// ---------- NewsAPI (international news) ----------
const NEWSAPI_CATEGORY = {
  'finance': 'business',
  'politics': 'general',
  'military': 'general'  // NewsAPI has no military category, use query
};

function fetchNewsAPI(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: NEWSAPI_BASE,
      path,
      method: 'GET',
      headers: { 'User-Agent': 'GlobalHot50/1.0' },
      timeout: 10000
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status !== 'ok') {
            return reject(new Error('NewsAPI error: ' + (json.message || 'unknown')));
          }
          resolve(json.articles || []);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// ---------- Format items to our standard format ----------
function formatItem(item, rank, minsAgo, domain) {
  const sourceName = item.source || item.author_name || item.sourceFull || '';
  const sourceInfo = getSource(sourceName);
  const trust = domain === 'domestic' ? 'A' : 'B'; // Default trust levels
  const heat = Math.floor(50 + Math.random() * 45); // We'll recalculate below

  return {
    rank,
    title: item.title || '',
    source: sourceInfo.full ? Object.keys(SOURCES).find(k => SOURCES[k] === sourceInfo) || sourceInfo.label : sourceInfo.label,
    source_full: sourceInfo.full,
    source_color: sourceInfo.color,
    source_label: sourceInfo.label,
    trust,
    heat,
    mins_ago: minsAgo,
    url: item.url || '',
    cluster: null,
    debunk: false,
    hot_score: 0 // Will be set after sorting
  };
}

// ---------- Main fetch function ----------
async function fetchNews(domain, category) {
  const cacheKey = `${domain}_${category}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  let rawItems = [];

  try {
    if (domain === 'domestic') {
      // Juhe for domestic news
      const juheData = await fetchJuhe(category);
      rawItems = juheData.slice(0, 20).map((item, i) => ({
        rank: i + 1,
        title: item.title,
        source: item.author_name || '未知',
        source_full: item.author_name || '未知来源',
        source_color: getSource(item.author_name).color,
        source_label: getSource(item.author_name).label,
        trust: matchSource(item.author_name) ? 'A' : 'B',
        heat: 70 + Math.floor(Math.random() * 28),
        mins_ago: Math.floor(Math.random() * 120),
        url: item.url || '',
        cluster: item.category || null,
        debunk: false,
        hot_score: 0
      }));
    } else {
      // NewsAPI for international news
      const cat = NEWSAPI_CATEGORY[category] || 'general';
      let path;
      if (category === 'military') {
        path = `/v2/everything?q=military+defense&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
      } else {
        path = `/v2/top-headlines?country=us&category=${cat}&pageSize=20&apiKey=${NEWSAPI_KEY}`;
      }

      const articles = await fetchNewsAPI(path);
      rawItems = articles.slice(0, 20).map((article, i) => ({
        rank: i + 1,
        title: article.title,
        source: article.source?.name || article.author || '未知',
        source_full: article.source?.name || '未知来源',
        source_color: getSource(article.source?.name).color,
        source_label: getSource(article.source?.name).label,
        trust: matchSource(article.source?.name) ? 'A' : 'B',
        heat: 70 + Math.floor(Math.random() * 28),
        mins_ago: Math.floor(Math.random() * 180),
        url: article.url || '',
        cluster: null,
        debunk: false,
        hot_score: 0
      }));
    }
  } catch (err) {
    console.error(`Fetch error for ${domain}/${category}:`, err.message);
    // Return empty on error - client will show error state
    rawItems = [];
  }

  // Calculate hot_score for all items
  const items = rawItems.map(item => ({
    ...item,
    hot_score: calcHotScore(item.heat, item.mins_ago, item.trust)
  })).sort((a, b) => b.hot_score - a.hot_score);

  // Re-rank after sorting by hot_score
  items.forEach((item, i) => { item.rank = i + 1; });

  const result = {
    domain,
    category,
    updated_at: Date.now(),
    items
  };

  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

module.exports = { fetchNews };
