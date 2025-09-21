// const express = require('express');
// const { Pool } = require('pg');
// const cors = require('cors');
// const path = require('path');
// const fs = require('fs');

// // ✅ Clerk (API compatible with your environment)
// const { ClerkExpressRequireAuth } = require('@clerk/express');

// const app = express();
// const PORT = process.env.PORT || 3000;

// /* ------------------------- CORS (Railway) ------------------------- */
// const allowedOrigins = [process.env.FRONTEND_URL].filter(Boolean);
// app.use(cors({
//   origin: (origin, cb) => {
//     if (!origin) return cb(null, true); // same-origin / curl
//     try {
//       const host = new URL(origin).host;
//       const railwayOK = /\.up\.railway\.app$/.test(host);
//       if (railwayOK) return cb(null, true);
//       if (allowedOrigins.includes(origin)) return cb(null, true);
//       return cb(new Error('Not allowed by CORS: ' + origin));
//     } catch {
//       return cb(new Error('Invalid Origin'));
//     }
//   },
//   credentials: true
// }));
// app.use(express.json());

// /* ---------------------------- Postgres ---------------------------- */
// const pool = new Pool({
//   host: process.env.PGHOST || process.env.DB_HOST,
//   port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
//   user: process.env.PGUSER || process.env.DB_USER,
//   password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
//   database: process.env.PGDATABASE || process.env.DB_NAME,
//   ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
// });

// /* ------------------------- Auth utilities ------------------------- */
// function getEmailFromClaims(claims = {}) {
//   // Try common Clerk claim shapes
//   return (
//     (claims.email && String(claims.email)) ||
//     (claims.email_address && String(claims.email_address)) ||
//     (claims.primary_email_address && String(claims.primary_email_address)) ||
//     (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
//     null
//   );
// }

// function requireAuthWithDbCheck(req, res, next) {
//   // First enforce a valid session, then run our DB allow-list
//   return ClerkExpressRequireAuth()(req, res, async () => {
//     try {
//       const email =
//         getEmailFromClaims(req.auth?.sessionClaims) ||
//         getEmailFromClaims(req.auth?.claims);

//       if (!email) {
//         return res.status(403).json({ error: 'Email not found in session' });
//       }

//       const userEmail = String(email).toLowerCase();
//       const client = await pool.connect();
//       const q = `
//         SELECT employee_email, employee_name, employee_nuid
//         FROM authentication
//         WHERE LOWER(employee_email) = $1
//       `;
//       const { rows } = await client.query(q, [userEmail]);
//       client.release();

//       if (rows.length === 0) {
//         return res.status(403).json({
//           error: 'Access denied. Your email is not authorized for this system.',
//           email: userEmail
//         });
//       }

//       req.user = {
//         email: rows[0].employee_email,
//         name: rows[0].employee_name,
//         nuid: rows[0].employee_nuid
//       };
//       next();
//     } catch (err) {
//       console.error('Auth/DB check error:', err);
//       res.status(500).json({ error: 'Authentication verification failed' });
//     }
//   });
// }

// /* ----------------------------- API ----------------------------- */

// // Current user (used by header chip in the UI)
// app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
//   res.json({ authenticated: true, user: req.user });
// });

// // Departments
// app.get('/api/departments', requireAuthWithDbCheck, async (_req, res) => {
//   const client = await pool.connect();
//   try {
//     const { rows } = await client.query(`
//       SELECT department_id, department_name
//       FROM department
//       ORDER BY department_name
//     `);
//     res.json(rows);
//   } catch (e) {
//     console.error('Departments error:', e);
//     res.status(500).json({ error: 'Failed to fetch departments' });
//   } finally {
//     client.release();
//   }
// });

// // WTR list
// app.get('/api/wtr', requireAuthWithDbCheck, async (_req, res) => {
//   const client = await pool.connect();
//   try {
//     const { rows } = await client.query(`
//       SELECT 
//         wtr.wtr_id, wtr.wtr_month, wtr.wtr_year, wtr.status,
//         wtr.total_submitted_hours, wtr.expected_hours,
//         e.employee_nuid, e.employee_name, e.employee_email, e.employee_title,
//         d.department_name
//       FROM wtr
//       JOIN employee e ON wtr.employee_nuid = e.employee_nuid
//       LEFT JOIN department d ON e.department_id = d.department_id
//       ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
//     `);
//     res.json(rows);
//   } catch (e) {
//     console.error('WTR error:', e);
//     res.status(500).json({ error: 'Failed to fetch WTR data' });
//   } finally {
//     client.release();
//   }
// });

// // Update WTR status
// app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
//   const id = Number(req.params.id);
//   const { status } = req.body || {};
//   const allowed = new Set(['pending', 'approved', 'rejected']);
//   if (!allowed.has(String(status || '').toLowerCase())) {
//     return res.status(400).json({ error: 'Invalid status' });
//   }
//   const client = await pool.connect();
//   try {
//     await client.query(`UPDATE wtr SET status = $1 WHERE wtr_id = $2`, [status, id]);
//     res.json({ ok: true });
//   } catch (e) {
//     console.error('Update status error:', e);
//     res.status(500).json({ error: 'Failed to update status' });
//   } finally {
//     client.release();
//   }
// });

// /* ------------------------ HTML / Static ------------------------ */

// // Helper: serve HTML and inject ${CLERK_PUBLISHABLE_KEY}
// function serveHtml(fileName) {
//   return (req, res) => {
//     const p1 = path.join(__dirname, 'public', fileName);
//     const p2 = path.join(__dirname, fileName);
//     const filePath = fs.existsSync(p1) ? p1 : p2;
//     fs.readFile(filePath, 'utf8', (err, html) => {
//       if (err) return res.status(500).send('Server error');
//       const injected = html.replace(/\$\{CLERK_PUBLISHABLE_KEY\}/g, process.env.CLERK_PUBLISHABLE_KEY || '');
//       res.setHeader('Content-Type', 'text/html; charset=utf-8');
//       res.send(injected);
//     });
//   };
// }

// // Default route → Sign-in page
// app.get('/', serveHtml('Sign in.html'));
// // Pretty routes:
// app.get('/sign-in', serveHtml('Sign in.html'));
// app.get('/dashboard', serveHtml('index.html'));

// // Static assets (optional /public)
// app.use(express.static(path.join(__dirname, 'public')));

// /* --------------------------- Start --------------------------- */
// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${PORT}`);
//   console.log(`🔑 Clerk publishable key present: ${!!process.env.CLERK_PUBLISHABLE_KEY}`);
//   console.log(`🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || '(not set)'}`);
// });



const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ClerkExpressRequireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------- CORS (Railway) ------------------------- */
const allowedOrigins = [process.env.FRONTEND_URL].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    try {
      const host = new URL(origin).host;
      const railwayOK = /\.up\.railway\.app$/.test(host);
      if (railwayOK) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS: ' + origin));
    } catch {
      return cb(new Error('Invalid Origin'));
    }
  },
  credentials: true
}));
app.use(express.json());

/* ---------------------------- PostgreSQL ---------------------------- */
/* Uses Railway env vars if set; otherwise falls back to the values you shared */
const pool = new Pool({
  host: process.env.PGHOST || 'interchange.proxy.rlwy.net',
  port: Number(process.env.PGPORT || 30828),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'vCSNGeBZiJVIwCRduwnMmqlhWxblqNhU',
  database: process.env.PGDATABASE || 'railway',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/* ------------------------- Auth utilities ------------------------- */
function getEmailFromClaims(claims = {}) {
  return (
    (claims.email && String(claims.email)) ||
    (claims.email_address && String(claims.email_address)) ||
    (claims.primary_email_address && String(claims.primary_email_address)) ||
    (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
    null
  );
}

/* require Clerk session + allowlist check in your DB's `authentication` table */
function requireAuthWithDbCheck(req, res, next) {
  return ClerkExpressRequireAuth()(req, res, async () => {
    try {
      const email =
        getEmailFromClaims(req.auth?.sessionClaims) ||
        getEmailFromClaims(req.auth?.claims);

      if (!email) return res.status(403).json({ error: 'Email not found in session' });

      const userEmail = String(email).toLowerCase();
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

/* ----------------------------- API ----------------------------- */

/* Current user (UI header chip) */
app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

/* Departments (matches your `department` table) */
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

/* WTR list (joins your schema, aliases approval_status → status for the UI)
   Includes aggregated activities from details_submission_logs + activity + projects */
app.get('/api/wtr', requireAuthWithDbCheck, async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT
        w.wtr_id,
        w.wtr_month,
        w.wtr_year,
        w.total_submitted_hours,
        w.expected_hours,
        -- Alias approval_status to "status" for the frontend
        w.approval_status AS status,

        e.employee_nuid,
        e.employee_name,
        e.employee_email,
        e.employee_title,
        d.department_name,

        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'coda_log_id', dsl.coda_log_id,
              'project_name', p.deal_name,
              'service_line', a.service_line,
              'activity_name', a.activity_name,
              'hours_submitted', dsl.hours_submitted,
              'tech_report_description', dsl.tech_report_description
            )
          ) FILTER (WHERE dsl.log_id IS NOT NULL),
          '[]'
        ) AS activities
      FROM work_time_records w
      JOIN employee e ON e.employee_nuid = w.employee_nuid
      LEFT JOIN department d ON d.department_id = e.department_id
      LEFT JOIN details_submission_logs dsl ON dsl.coda_wtr_id = w.coda_wtr_id
      LEFT JOIN activity a ON a.activity_id = dsl.activity_id
      LEFT JOIN projects p ON p.project_id = dsl.project_id
      GROUP BY
        w.wtr_id, w.wtr_month, w.wtr_year, w.total_submitted_hours, w.expected_hours, w.approval_status,
        e.employee_nuid, e.employee_name, e.employee_email, e.employee_title, d.department_name
      ORDER BY w.wtr_year DESC, w.wtr_month DESC, e.employee_name
    `);

    res.json(rows);
  } catch (e) {
    console.error('WTR error:', e);
    res.status(500).json({ error: 'Failed to fetch WTR data' });
  } finally {
    client.release();
  }
});

/* Update WTR status (maps to `approval_status`) */
app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  const allowed = new Set(['pending', 'approved', 'rejected', 'Pending', 'Approved', 'Rejected']);
  if (!allowed.has(String(status || '').trim())) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const normalized = String(status).toLowerCase();
  const dbValue =
    normalized === 'approved' ? 'Approved' :
    normalized === 'rejected' ? 'Rejected' :
    'Pending';

  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE work_time_records
          SET approval_status = $1
        WHERE wtr_id = $2`,
      [dbValue, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'WTR record not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Update status error:', e);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    client.release();
  }
});

/* ------------------------ HTML / Static ------------------------ */
/* Helper: serve HTML and inject ${CLERK_PUBLISHABLE_KEY} into your pages */
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

/* Keep your flow exactly the same */
app.get('/', serveHtml('Sign in.html'));
app.get('/sign-in', serveHtml('Sign in.html'));
app.get('/dashboard', serveHtml('index.html'));

/* Static assets */
app.use(express.static(path.join(__dirname, 'public')));

/* --------------------------- Start --------------------------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔑 Clerk publishable key present: ${!!process.env.CLERK_PUBLISHABLE_KEY}`);
  console.log(`🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || '(not set)'}`);
});
