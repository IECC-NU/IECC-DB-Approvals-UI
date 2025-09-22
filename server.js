// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Clerk: correct middlewares
const { clerkMiddleware, requireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------- Core middleware ------------------------- */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// VERY IMPORTANT: attach Clerk to every request
app.use(clerkMiddleware());

/* ---------------------------- PostgreSQL ---------------------------- */
const must = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const pool = new Pool({
  host: must('PGHOST'),
  port: Number(process.env.PGPORT || 5432),
  user: must('PGUSER'),
  password: must('PGPASSWORD'),
  database: must('PGDATABASE'),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/* ------------------------- Auth helpers ------------------------- */
function getEmailFromClaims(claims = {}) {
  return (
    (claims.email && String(claims.email)) ||
    (claims.email_address && String(claims.email_address)) ||
    (claims.primary_email_address && String(claims.primary_email_address)) ||
    (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
    null
  );
}

// Clerk session + allow-list check in authentication table
function requireAuthWithDbCheck(req, res, next) {
  return requireAuth()(req, res, async () => {
    try {
      const email =
        getEmailFromClaims(req.auth?.sessionClaims) ||
        getEmailFromClaims(req.auth?.claims);

      if (!email) return res.status(403).json({ error: 'Email not found in session' });

      const userEmail = String(email).toLowerCase();
      const client = await pool.connect();
      const { rows } = await client.query(
        `SELECT employee_email, employee_name, employee_nuid
           FROM authentication
          WHERE LOWER(employee_email) = $1`,
        [userEmail]
      );
      client.release();

      if (rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied. Your email is not authorized for this system.',
          email: userEmail,
        });
      }

      req.user = {
        email: rows[0].employee_email,
        name: rows[0].employee_name,
        nuid: rows[0].employee_nuid,
      };
      next();
    } catch (err) {
      console.error('Auth/DB check error:', err);
      res.status(500).json({ error: 'Authentication verification failed' });
    }
  });
}

/* ----------------------------- API ----------------------------- */

// Quick DB info (not protected) – helps verify DB rows from the browser
app.get('/api/debug/dbinfo', async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows: w } = await client.query(`SELECT COUNT(*)::int AS n FROM work_time_records`);
    const { rows: a } = await client.query(`SELECT COUNT(*)::int AS n FROM authentication`);
    const { rows: e } = await client.query(`SELECT COUNT(*)::int AS n FROM employee`);
    res.json({ work_time_records: w[0].n, authentication: a[0].n, employee: e[0].n });
  } catch (e) {
    console.error('DB info error:', e);
    res.status(500).json({ error: 'Failed to fetch DB info' });
  } finally {
    client.release();
  }
});

// Current user (used by top-right chip)
app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

// Departments
app.get('/api/departments', requireAuthWithDbCheck, async (_req, res) => {
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

// Work Time Records (matches your SQL schema: work_time_records + approval_status)
app.get('/api/wtr', requireAuthWithDbCheck, async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT 
        wtr.wtr_id, wtr.wtr_month, wtr.wtr_year, wtr.approval_status,
        wtr.total_submitted_hours, wtr.expected_hours,
        e.employee_nuid, e.employee_name, e.employee_email, e.employee_title,
        d.department_name
      FROM work_time_records wtr
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

// Update status
app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = new Set(['pending', 'approved', 'rejected']);
  if (!allowed.has(String(status || '').toLowerCase())) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE work_time_records SET approval_status = $1 WHERE wtr_id = $2`,
      [status, id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Update status error:', e);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    client.release();
  }
});

/* ------------------------ HTML / Static ------------------------ */
function serveHtml(fileName) {
  return (req, res) => {
    const p1 = path.join(__dirname, 'public', fileName);
    const p2 = path.join(__dirname, fileName);
    const filePath = fs.existsSync(p1) ? p1 : p2;
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return res.status(500).send('Server error');
      const injected = html.replace(/\$\{CLERK_PUBLISHABLE_KEY\}/g, process.env.CLERK_PUBLISHABLE_KEY || '');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(injected);
    });
  };
}

app.get('/', serveHtml('Sign in.html'));
app.get('/sign-in', serveHtml('Sign in.html'));
app.get('/dashboard', serveHtml('index.html'));
app.use(express.static(path.join(__dirname, 'public')));

/* --------------------------- Start --------------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔑 PUBLISHABLE key present: ${!!process.env.CLERK_PUBLISHABLE_KEY}`);
  console.log(`🔐 SECRET key present: ${!!process.env.CLERK_SECRET_KEY}`);
});


// EOF