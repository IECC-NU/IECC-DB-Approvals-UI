// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { clerkMiddleware, requireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------- Middleware ------------------------- */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(clerkMiddleware());

/* ---------------------------- PostgreSQL ---------------------------- */
const must = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

// Add connection retry logic and better error handling
const pool = new Pool({
  host: must('PGHOST'),
  port: Number(process.env.PGPORT || 5432),
  user: must('PGUSER'),
  password: must('PGPASSWORD'),
  database: must('PGDATABASE'),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Test database connection on startup
pool.connect()
  .then(client => {
    console.log('✅ Database connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

/* ------------------------- Auth Helpers ------------------------- */
function getEmailFromClaims(claims = {}) {
  return (
    claims.email ||
    claims.email_address ||
    claims.primary_email_address ||
    (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
    null
  );
}

function requireAuthWithDbCheck(req, res, next) {
  return requireAuth()(req, res, async () => {
    try {
      const email =
        getEmailFromClaims(req.auth?.sessionClaims) ||
        getEmailFromClaims(req.auth?.claims);
      
      console.log('Auth check - Email from claims:', email);
      console.log('Auth object:', JSON.stringify(req.auth, null, 2));
      
      if (!email) {
        console.log('❌ No email found in session claims');
        return res.status(403).json({ error: 'Email not found in session' });
      }

      const userEmail = String(email).toLowerCase();
      console.log('Looking for user with email:', userEmail);
      
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `SELECT employee_email, employee_name, employee_nuid
           FROM authentication
           WHERE LOWER(employee_email) = $1`,
          [userEmail]
        );
        
        console.log(`Found ${rows.length} matching users in database`);
        
        if (rows.length === 0) {
          console.log('❌ User not found in authentication table');
          // Let's also check what users exist
          const { rows: allUsers } = await client.query('SELECT employee_email FROM authentication');
          console.log('Available users in DB:', allUsers.map(u => u.employee_email));
          return res.status(403).json({ 
            error: 'Access denied - user not authorized', 
            email: userEmail,
            availableUsers: allUsers.map(u => u.employee_email)
          });
        }

        req.user = rows[0];
        console.log('✅ User authenticated:', req.user.employee_name);
        next();
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('❌ Auth/DB check error:', err);
      res.status(500).json({ error: 'Authentication verification failed', details: err.message });
    }
  });
}

/* ----------------------------- API ----------------------------- */
app.get('/api/debug/dbinfo', async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows: w } = await client.query(`SELECT COUNT(*)::int AS n FROM work_time_records`);
      const { rows: a } = await client.query(`SELECT COUNT(*)::int AS n FROM authentication`);
      const { rows: e } = await client.query(`SELECT COUNT(*)::int AS n FROM employee`);
      const { rows: authUsers } = await client.query(`SELECT employee_email, employee_name FROM authentication`);
      
      res.json({ 
        work_time_records: w[0].n, 
        authentication: a[0].n, 
        employee: e[0].n,
        auth_users: authUsers
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Database info error:', err);
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

app.get('/api/departments', requireAuthWithDbCheck, async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT department_id, department_name
      FROM department
      ORDER BY department_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Departments query error:', err);
    res.status(500).json({ error: 'Failed to fetch departments', details: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/wtr', requireAuthWithDbCheck, async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT 
        wtr.wtr_id,
        wtr.wtr_month,
        wtr.wtr_year,
        wtr.approval_status AS status,
        wtr.total_submitted_hours,
        wtr.expected_hours,
        e.employee_nuid,
        e.employee_name,
        e.employee_email,
        e.employee_title,
        d.department_name
      FROM work_time_records wtr
      JOIN employee e ON wtr.employee_nuid = e.employee_nuid
      LEFT JOIN department d ON e.department_id = d.department_id
      ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('WTR query error:', err);
    res.status(500).json({ error: 'Failed to fetch work time records', details: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = new Set(['pending', 'approved', 'rejected']);
  if (!allowed.has(String(status).toLowerCase())) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE work_time_records SET approval_status = $1 WHERE wtr_id = $2`,
      [status, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Failed to update status', details: err.message });
  } finally {
    client.release();
  }
});

/* ------------------------ HTML / Static ------------------------ */
function serveHtml(fileName) {
  return (req, res) => {
    const filePath = path.join(__dirname, fileName);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) {
        console.error(`Error reading ${fileName}:`, err);
        return res.status(500).send('Server error');
      }
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

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`🔐 Sign in: http://localhost:${PORT}/sign-in`);
});