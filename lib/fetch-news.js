'use strict';

const http = require('http');
const https = require('https');
const { SOURCES, calcHotScore } = require('./data');
const cache = require('./cache');

const NEWSAPI_KEY = '480168630be8476bb441a241ae4e3780';
const NEWSAPI_BASE = 'newsapi.org';

// Source mapping (by name matching)
function matchSource(name) {
  const lower = (name || '').toLowerCase();
  const map = {
    '新华社': 'Xinhua', 'xinhua': 'Xinhua', '新华': 'Xinhua',
    '央视': 'CCTV', 'cctv': 'CCTV', '央视新闻': 'CCTV', '中央广播电视总台': 'CCTV',
    '人民': 'PeopleDaily', '人民日报': 'PeopleDaily', 'people': 'PeopleDaily',
    '环球': 'GTimes', '环球时报': 'GTimes',
    '中国日报': 'ChinaDaily', 'china daily': 'ChinaDaily',
    '财新': 'Caixin', 'caixin': 'Caixin',
    '证券': 'CNStock', '证券时报': 'CNStock',
    '商务部': 'MOFCOM',
    '央行': 'PBOC', '人民银行': 'PBOC',
    '国防部': 'MOD',
    '解放军': 'PLADaily', '解放军报': 'PLADaily',
    '航天': 'CNSA', '中国航天': 'CNSA',
    '发改委': 'NDRC',
    'reuters': 'Reuters', '路透': 'Reuters',
    'bloomberg': 'Bloomberg', '彭博': 'Bloomberg',
    'bbc': 'BBC',
    'wall street journal': 'WSJ', 'wsj': 'WSJ',
    'financial times': 'FT',
    'associated press': 'AP', 'ap news': 'AP',
    'defense news': 'DefenseNews', 'defensenews': 'DefenseNews',
    'usni': 'USNI',
    'economist': 'Economist',
    'nhk': 'NHK',
    'al jazeera': 'AlJazeera', 'aljazeera': 'AlJazeera',
    'guardian': 'Guardian',
    'new york times': 'NYT', 'nyt': 'NYT',
    'south china morning post': 'SCMP', 'scmp': 'SCMP',
    'politico': 'Politico',
    'jane': 'JaneDef',
    'military times': 'MilitaryTimes',
  };
  for (const [k, v] of Object.entries(map)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

function getSource(name) {
  const matched = matchSource(name);
  if (matched && SOURCES[matched]) return SOURCES[matched];
  return { color: '#888888', label: (name || '??').slice(0, 2).toUpperCase(), full: name || '未知来源' };
}

// --------- CCTV JSONP API (mainstream Chinese media) ---------
const CCTV_TYPES = {
  'finance': 'economy',
  'politics': 'china',
  'military': 'china'  // Use china page + military keyword filter
};

function fetchCCTV(type) {
  return new Promise((resolve, reject) => {
    const cctvType = CCTV_TYPES[type] || type;
    const url = `http://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/${cctvType}_1.jsonp`;
    http.get(url, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          // Strip JSONP wrapper: callback_name({...}) → {...}
          const jsonStr = data.replace(/^[a-z_]*\s*\(/, '').replace(/\s*\)\s*$/, '');
          const json = JSON.parse(jsonStr);
          if (!json.data || !json.data.list) {
            return reject(new Error('CCTV API: no data'));
          }
          resolve(json.data.list);
        } catch (e) {
          reject(new Error('CCTV parse error: ' + e.message));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// --------- NewsAPI (international news) ---------
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
          if (json.status !== 'ok') return reject(new Error(json.message || 'NewsAPI error'));
          resolve(json.articles || []);
        } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// Military keywords for filtering CCTV top news
const MILITARY_KEYWORDS = [
  '军', '武', '兵', '战', '弹', '舰', '艇', '机', '航母', '导弹',
  '部队', '演习', '国防', '火箭军', '解放军', '海军', '空军', '陆军',
  '火箭', '卫星', '航天', '武器', '装备', '坦克', '战机', '潜艇',
  '开火', '军事', '射击', '巡逻', '护航', '侦察', '雷达', '边境'
];

function isMilitary(title) {
  return MILITARY_KEYWORDS.some(k => title.includes(k));
}

// --------- Main fetch function ---------
async function fetchNews(domain, category) {
  const cacheKey = `${domain}_${category}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const CACHE_TTL = 30 * 60 * 1000;
  let rawItems = [];

  try {
    if (domain === 'domestic') {
      // CCTV for domestic news
      const cctvItems = await fetchCCTV(category);

      // Filter by military keywords for military category
      const filtered = category === 'military'
        ? cctvItems.filter(item => isMilitary(item.title))
        : cctvItems;

      rawItems = filtered.slice(0, 20).map((item, i) => ({
        rank: i + 1,
        title: item.title,
        source: '央视新闻',
        source_full: '央视新闻',
        source_color: '#e8362a',
        source_label: '央视',
        trust: 'A',
        heat: 80 + Math.floor(Math.random() * 18),
        mins_ago: parseMinutesAgo(item.focus_date),
        url: item.url || '',
        cluster: null,
        debunk: false,
        hot_score: 0
      }));
    } else {
      // International: NewsAPI with major mainstream sources
      let sources, path;
      if (category === 'finance') {
        sources = 'bloomberg,reuters,financial-times,the-wall-street-journal,the-economist';
        path = `/v2/top-headlines?sources=${sources}&pageSize=20&apiKey=${NEWSAPI_KEY}`;
      } else if (category === 'politics') {
        sources = 'bbc-news,cnn,the-guardian-uk,associated-press,al-jazeera-english,politico,abc-news';
        path = `/v2/top-headlines?sources=${sources}&pageSize=20&apiKey=${NEWSAPI_KEY}`;
      } else {
        // Military: use everything endpoint with defense keywords and mainstream sources
        sources = 'reuters,bbc-news,associated-press,the-guardian-uk';
        path = `/v2/everything?q=military+OR+defense+OR+war+OR+navy&sources=${sources}&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
      }

      const articles = await fetchNewsAPI(path);
      rawItems = articles.slice(0, 20).map((article, i) => ({
        rank: i + 1,
        title: article.title,
        source: article.source?.name || article.author || '未知来源',
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
    rawItems = [];
  }

  // Calculate hot_score and sort
  const items = rawItems.map(item => ({
    ...item,
    hot_score: calcHotScore(item.heat, item.mins_ago, item.trust)
  })).sort((a, b) => b.hot_score - a.hot_score);

  items.forEach((item, i) => { item.rank = i + 1; });

  const result = { domain, category, updated_at: Date.now(), items };
  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

// Parse CCTV focus_date to minutes ago
function parseMinutesAgo(dateStr) {
  if (!dateStr) return Math.floor(Math.random() * 60);
  try {
    const date = new Date(dateStr.replace(' ', 'T') + '+08:00');
    const diff = Date.now() - date.getTime();
    return Math.max(1, Math.floor(diff / 60000));
  } catch (e) {
    return Math.floor(Math.random() * 60);
  }
}

module.exports = { fetchNews };
