//help me
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();

const allowedOrigins = [
  'https://classroom.google.com',
  'https://parser.antimatter137.dev',
  'http://localhost:3000',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(__dirname, 'public')));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DATA_FILE = path.join(__dirname, 'data.jsonl');

const KEYFILEPATH = path.join(__dirname, 'service-account.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function appendToSheet(rows) {
  if (!SPREADSHEET_ID) return console.warn('No SPREADSHEET_ID set.');

  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
  });
  const clientAuth = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: clientAuth });

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:A',
  });
  const existingDates = new Set((existing.data.values || []).flat().map(d => d.toString().trim()));

  const newRows = rows.filter(r => r.date_label && !existingDates.has(r.date_label));
  if (!newRows.length) return console.log('No new rows to append.');

  const resource = {
    values: newRows.map(r => [
      r.date_label,
      r.minutes,
      r.miles,
      r.calories,
      r.steps
    ]),
  };

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:E',
    valueInputOption: 'USER_ENTERED',
    resource,
  });

  console.log(`Appended ${response.data.updates.updatedRows} rows to Google Sheet.`);
}

function splitMultiDatePosts(posts) {
  const splitPosts = [];
  const datePattern = /(Mon|Tues|Tue|Wed|Thurs|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\/\d{1,2}/gi;

  for (const post of posts) {
    if (!post) continue;
    const matches = [...post.matchAll(datePattern)];
    if (matches.length <= 1) { splitPosts.push(post.trim()); continue; }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : post.length;
      const chunk = post.slice(start, end).trim();
      if (chunk) splitPosts.push(chunk);
    }
  }
  return splitPosts;
}

function normalizeDateLabel(label) {
  if (!label || typeof label !== 'string') return label;
  const s = label.trim();
  const mmddMatch = s.match(/(\d{1,2})\/(\d{1,2})/);
  let month, day;
  if (mmddMatch) { month = parseInt(mmddMatch[1]); day = parseInt(mmddMatch[2]); }
  else {
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = s.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const lower = parts[i].toLowerCase();
      const idx = monthNames.indexOf(lower) !== -1 ? monthNames.indexOf(lower) : shortMonths.map(m=>m.toLowerCase()).indexOf(lower);
      if (idx !== -1) { month = idx + 1; const maybeDay = parseInt(parts[i + 1]); if (!isNaN(maybeDay)) day = maybeDay; break; }
    }
  }
  if (!month || !day) return label;
  const d = new Date(new Date().getFullYear(), month-1, day);
  const monthAbbr = d.toLocaleString('en-US', { month: 'short' });
  return `${monthAbbr} ${d.getDate()}`;
}

async function parsePosts(posts) {
  const systemPrompt = `
You are a strict JSON API that extracts walking stats from teacher posts.

Return ONLY JSON: { "results": [...] } with exactly one entry per input post.

Each entry must have:
- "date_label": string or null
- "minutes": number or null
- "miles": number or null
- "calories": number or null
- "steps": number or null

DATE RULES: Format "Oct 30", "Nov 18". Missing → null.
STATS RULES: parse "31 minutes", "1.81 miles", "3,823 steps", "117 calories". Missing → null.
Ignore elevation/BPM. "1/15 miles" → 1.15 miles.
`;

  const userPrompt = `
Here is an array of posts (each full post as one element):

${JSON.stringify(posts, null, 2)}

Return exactly one JSON object: { "results": [...] }.
`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0,
    response_format: { type: "json_object" }
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  return parsed.results.map(r => ({
    date_label: r.date_label ? normalizeDateLabel(r.date_label) : null,
    minutes: typeof r.minutes === 'number' ? r.minutes : null,
    miles: typeof r.miles === 'number' ? r.miles : null,
    calories: typeof r.calories === 'number' ? r.calories : null,
    steps: typeof r.steps === 'number' ? r.steps : null
  }));
}

function appendToFile(entries) {
  if (!entries.length) return;
  const now = new Date().toISOString();
  const lines = entries.map(e => JSON.stringify({ ...e, created_at: now }));
  fs.appendFileSync(DATA_FILE, lines.join('\n') + '\n', 'utf8');
}

app.get('/', (req, res) => {
  res.type('text').send('running: { "posts": [...] }');
});

app.options('/parse-stats', cors(corsOptions));
app.post('/parse-stats', cors(corsOptions), async (req, res) => {
  try {
    const rawPosts = Array.isArray(req.body.posts) ? req.body.posts : [];
    if (!rawPosts.length) return res.json({ results: [] });

    const posts = splitMultiDatePosts(rawPosts);
    const results = await parsePosts(posts);

    appendToFile(results);
    await appendToSheet(results);

    res.json({ results });
  } catch (err) {
    console.error('error:', err);
    res.status(500).json({ error: 'Parsing failed', details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`running on port ${port}`);
  console.log(`saved to: ${DATA_FILE}`);
});
