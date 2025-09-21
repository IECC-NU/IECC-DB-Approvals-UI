const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ✅ Latest Clerk express middleware
const { ClerkExpressWithAuth, requireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- CORS (allow your Railway URL + optional custom FRONTEND_URL) ----------
const allowedOrigins = [
  process.env.FRONTEND_URL,      // e.g. https://iecc-db-approvals-ui.up.railway.app
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin/non-browser
    // allow *.up.railway.app
    const railwayOk = /\.up\.railway\.app$/.test(new URL(origin).host);
    if (railwayOk) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));

app.use(express.json());

// ---------- Clerk (global) ----------
app.use(ClerkExpressWithAuth({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY
}));

// ---------- Postgres ----------
const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST,
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  user: process.env.PGUSER || process.env.DB_USER,
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
  database: process.env.PGDATABASE || process.env.DB_NAME,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function getEmailFromClaims(claims = {}) {
  return (
    (claims.email && String(claims.email)) ||
    (claims.email_address && String(claims.email_address)) ||
    (claims.primary_email_address && String(claims.primary_email_address)) ||
    (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
    null
  );
}

// ---------- Auth + DB allow-list ----------
async function requireAuthWithDbCheck(req, res, next) {
  return requireAuth()(req, res, async () => {
    try {
      const emailRaw =
        getEmailFromClaims(req.auth?.sessionClaims) ||
        getEmailFromClaims(req.auth?.claims);
      if (!emailRaw) {
        return res.status(403).json({ error: 'Email not found in session' });
      }

      const userEmail = emailRaw.toLowerCase();
      const client = await pool.connect();
      const q = `
        SELECT employee_email, employee_name, employee_nuid
        FROM authentication
        WHERE LOWER(employee_email) = $1
      `;
      const { rows } = await client.query(q, [userEmail]);
      client.release();

      if (rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied. Your email is not authorized for this system.',
          email: userEmail
        });
      }

      req.user = {
        email: rows[0].employee_email,
        name: rows[0].employee_name,
        nuid: rows[0].employee_nuid
      };
      next();
    } catch (err) {
      console.error('Auth/DB check error:', err);
      res.status(500).json({ error: 'Authentication verification failed' });
    }
  });
}

// ===================== API ROUTES =====================

// Current user
app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

// Example: Departments
app.get('/api/departments', requireAuthWithDbCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT department_id, department_name
      FROM department
      ORDER BY department_name
    `);
    res.json(rows);
  } catch (e) {
    console.error('Departments error:', e);
    res.status(500).json({ error: 'Failed to fetch departments' });
  } finally {
    client.release();
  }
});

// Example: WTR combined view
app.get('/api/wtr', requireAuthWithDbCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT 
        wtr.wtr_id, wtr.wtr_month, wtr.wtr_year, wtr.status,
        e.employee_nuid, e.employee_name, e.employee_email,
        d.department_name
      FROM wtr
      JOIN employee e ON wtr.employee_nuid = e.employee_nuid
      LEFT JOIN department d ON e.department_id = d.department_id
      ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
    `);
    res.json(rows);
  } catch (e) {
    console.error('WTR error:', e);
    res.status(500).json({ error: 'Failed to fetch WTR data' });
  } finally {
    client.release();
  }
});

// Health
app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    node: process.version,
    env: process.env.NODE_ENV || 'development'
  });
});

// ===================== STATIC / HTML =====================

// We’ll serve index.html and inject your publishable key at runtime.
function serveIndex(req, res) {
  // Support both /public/index.html and root /index.html so you don’t have to move files.
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  const filePath = fs.existsSync(publicPath) ? publicPath : rootPath;

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('Failed to read index.html:', err);
      return res.status(500).send('Server error');
    }
    const injected = html.replace(/\$\{CLERK_PUBLISHABLE_KEY\}/g, process.env.CLERK_PUBLISHABLE_KEY || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
  });
}

app.get('/', serveIndex);
app.get('/dashboard', serveIndex);

// Static files if you keep a /public folder
app.use(express.static(path.join(__dirname, 'public')));

// ===================== STARTUP =====================
async function testConnection() {
  try {
    const client = await pool.connect();
    const { rows: ec } = await client.query('SELECT COUNT(*)::int AS c FROM employee');
    const { rows: ac } = await client.query('SELECT COUNT(*)::int AS c FROM authentication');
    client.release();

    console.log('✅ PostgreSQL connected');
    console.log(`📊 Employees: ${ec[0].c} | Authorized: ${ac[0].c}`);
    console.log(`🔑 Clerk publishable key present: ${!!process.env.CLERK_PUBLISHABLE_KEY}`);
    console.log(`🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || '(not set)'} | NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  } catch (error) {
    console.error('❌ DB connection failed:', error.message);
  }
}

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM: closing DB pool');
  pool.end(() => process.exit(0));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  testConnection();
});
