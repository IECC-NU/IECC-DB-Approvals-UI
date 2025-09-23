// // server.js - Updated email extraction and auth handling
// const express = require('express');
// const { Pool } = require('pg');
// const cors = require('cors');
// const path = require('path');
// const fs = require('fs');
// const { clerkMiddleware, requireAuth } = require('@clerk/express');

// const app = express();
// const PORT = process.env.PORT || 3000;

// /* ------------------------- Middleware ------------------------- */
// app.use(cors({
//   origin: process.env.NODE_ENV === 'production'
//     ? ['https://iecc-db-approvals-ui-production-74a7.up.railway.app']
//     : ['http://localhost:3000', 'http://127.0.0.1:3000'],
//   credentials: true
// }));
// app.use(express.json());
// app.use(clerkMiddleware());

// /* ---------------------------- PostgreSQL ---------------------------- */
// const must = (name) => {
//   const v = process.env[name];
//   if (!v) throw new Error(`Missing required env var: ${name}`);
//   return v;
// };

// // PostgreSQL connection with Railway-specific configuration
// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL || `postgresql://${must('PGUSER')}:${must('PGPASSWORD')}@${must('PGHOST')}:${process.env.PGPORT || 5432}/${must('PGDATABASE')}`,
//   ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
//   connectionTimeoutMillis: 30000,
//   idleTimeoutMillis: 30000,
//   max: 20,
//   min: 5,
// });

// // Test database connection on startup with retry logic
// async function connectWithRetry(retries = 5) {
//   for (let i = 0; i < retries; i++) {
//     try {
//       const client = await pool.connect();
//       console.log('✅ Database connected successfully');

//       // Test basic query
//       const result = await client.query('SELECT NOW()');
//       console.log('✅ Database query test passed:', result.rows[0].now);

//       client.release();
//       return;
//     } catch (err) {
//       console.error(`❌ Database connection attempt ${i + 1} failed:`, err.message);
//       if (i === retries - 1) {
//         console.error('❌ All database connection attempts failed');
//         throw err;
//       }
//       await new Promise(resolve => setTimeout(resolve, 2000));
//     }
//   }
// }

// // Initialize database connection
// connectWithRetry().catch(err => {
//   console.error('❌ Fatal: Could not connect to database:', err);
//   process.exit(1);
// });

// /* ------------------------- Auth Helpers ------------------------- */
// function getEmailFromClaims(claims = {}) {
//   console.log('🔍 Full claims object:', JSON.stringify(claims, null, 2));

//   // Enhanced email extraction with more debugging
//   const possibleEmails = [
//     claims.email,
//     claims.email_address,
//     claims.primary_email_address,
//     claims.primaryEmailAddress?.emailAddress,
//     Array.isArray(claims.email_addresses) ? claims.email_addresses[0] : null,
//     Array.isArray(claims.emailAddresses) ? claims.emailAddresses[0]?.emailAddress : null,
//     // Additional paths that might exist
//     claims['https://clerk.dev/email'],
//     claims['clerk/email'],
//     claims.sub && claims.sub.includes('@') ? claims.sub : null // Sometimes sub contains email
//   ];

//   console.log('🔍 Possible email values:', possibleEmails);

//   const foundEmail = possibleEmails.find(email => email && typeof email === 'string' && email.includes('@'));
//   console.log('📧 Found email:', foundEmail);

//   return foundEmail || null;
// }

// async function getUserFromClerk(userId) {
//   try {
//     // Try to fetch user data from Clerk API
//     const response = await fetch(`https://api.clerk.dev/v1/users/${userId}`, {
//       headers: {
//         'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
//         'Content-Type': 'application/json',
//       },
//     });

//     if (response.ok) {
//       const userData = await response.json();
//       console.log('📧 Fetched user from Clerk API:', userData.email_addresses?.[0]?.email_address);
//       return userData.email_addresses?.[0]?.email_address;
//     }
//   } catch (err) {
//     console.error('❌ Failed to fetch user from Clerk API:', err.message);
//   }
//   return null;
// }

// function requireAuthWithDbCheck(req, res, next) {
//   return requireAuth()(req, res, async () => {
//     try {
//       console.log('🔐 Auth check starting...');
//       console.log('Auth object keys:', Object.keys(req.auth || {}));
//       console.log('Session claims:', req.auth?.sessionClaims);

//       let email = getEmailFromClaims(req.auth?.sessionClaims) || getEmailFromClaims(req.auth?.claims);

//       // If no email in claims, try fetching from Clerk API using the user ID
//       if (!email && req.auth?.sessionClaims?.sub) {
//         console.log('🔍 No email in claims, trying Clerk API...');
//         email = await getUserFromClerk(req.auth.sessionClaims.sub);
//       }

//       if (!email) {
//         console.log('❌ No email found in session claims or Clerk API');
//         console.log('Available claims:', JSON.stringify(req.auth, null, 2));
//         return res.status(403).json({
//           error: 'Email not found in session',
//           debug: {
//             hasAuth: !!req.auth,
//             hasSessionClaims: !!req.auth?.sessionClaims,
//             claimsKeys: req.auth?.sessionClaims ? Object.keys(req.auth.sessionClaims) : [],
//             userId: req.auth?.sessionClaims?.sub,
//             suggestion: 'Check JWT template configuration in Clerk Dashboard'
//           }
//         });
//       }

//       const userEmail = String(email).toLowerCase().trim();
//       console.log('🔍 Looking for user with email:', userEmail);

//       const client = await pool.connect();
//       try {
//         // First, let's see what's in the authentication table
//         const { rows: allAuth } = await client.query('SELECT employee_email FROM authentication LIMIT 10');
//         console.log('📋 Sample authentication records:', allAuth.map(r => r.employee_email));

//         const { rows } = await client.query(
//           `SELECT employee_email, employee_name, employee_nuid
//            FROM authentication
//            WHERE LOWER(TRIM(employee_email)) = $1`,
//           [userEmail]
//         );

//         console.log(`📊 Found ${rows.length} matching users in database`);

//         if (rows.length === 0) {
//           console.log('❌ User not found in authentication table');
//           return res.status(403).json({
//             error: 'Access denied - user not authorized',
//             email: userEmail,
//             hint: 'Contact administrator to add your email to the system'
//           });
//         }

//         req.user = rows[0];
//         console.log('✅ User authenticated:', req.user.employee_name);
//         next();
//       } finally {
//         client.release();
//       }
//     } catch (err) {
//       console.error('❌ Auth/DB check error:', err);
//       res.status(500).json({
//         error: 'Authentication verification failed',
//         details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
//       });
//     }
//   });
// }

// /* ----------------------------- API ----------------------------- */

// // Health check endpoint
// app.get('/api/health', async (req, res) => {
//   try {
//     const client = await pool.connect();
//     try {
//       await client.query('SELECT 1');
//       res.json({
//         status: 'healthy',
//         database: 'connected',
//         timestamp: new Date().toISOString(),
//         environment: process.env.NODE_ENV || 'development'
//       });
//     } finally {
//       client.release();
//     }
//   } catch (err) {
//     console.error('Health check failed:', err);
//     res.status(500).json({
//       status: 'unhealthy',
//       database: 'disconnected',
//       error: err.message
//     });
//   }
// });

// app.get('/api/debug/dbinfo', async (req, res) => {
//   try {
//     const client = await pool.connect();
//     try {
//       // Check if tables exist
//       const { rows: tables } = await client.query(`
//         SELECT table_name 
//         FROM information_schema.tables 
//         WHERE table_schema = 'public' 
//         AND table_name IN ('work_time_records', 'authentication', 'employee', 'department')
//       `);

//       const tableNames = tables.map(t => t.table_name);

//       let counts = {};
//       let samples = {};

//       for (const tableName of tableNames) {
//         try {
//           const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
//           counts[tableName] = countRows[0].n;

//           // Get sample data
//           const { rows: sampleRows } = await client.query(`SELECT * FROM ${tableName} LIMIT 3`);
//           samples[tableName] = sampleRows;
//         } catch (err) {
//           counts[tableName] = `Error: ${err.message}`;
//           samples[tableName] = [];
//         }
//       }

//       res.json({
//         tables_found: tableNames,
//         counts,
//         samples: process.env.NODE_ENV === 'development' ? samples : 'Hidden in production'
//       });
//     } finally {
//       client.release();
//     }
//   } catch (err) {
//     console.error('Database info error:', err);
//     res.status(500).json({
//       error: 'Database connection failed',
//       details: err.message,
//       stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
//     });
//   }
// });

// app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
//   res.json({
//     authenticated: true,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });
// });

// app.get('/api/departments', requireAuthWithDbCheck, async (req, res) => {
//   const client = await pool.connect();
//   try {
//     const { rows } = await client.query(`
//       SELECT department_id, department_name
//       FROM department
//       ORDER BY department_name
//     `);
//     console.log(`📋 Fetched ${rows.length} departments`);
//     res.json(rows);
//   } catch (err) {
//     console.error('❌ Departments query error:', err);
//     res.status(500).json({
//       error: 'Failed to fetch departments',
//       details: process.env.NODE_ENV === 'development' ? err.message : 'Database error'
//     });
//   } finally {
//     client.release();
//   }
// });

// app.get('/api/wtr', requireAuthWithDbCheck, async (req, res) => {
//   const client = await pool.connect();
//   try {
//     console.log('📊 Fetching work time records...');

//     const { rows } = await client.query(`
//       SELECT 
//         wtr.wtr_id,
//         wtr.wtr_month,
//         wtr.wtr_year,
//         wtr.approval_status AS status,
//         wtr.total_submitted_hours,
//         wtr.expected_hours,
//         e.employee_nuid,
//         e.employee_name,
//         e.employee_email,
//         e.employee_title,
//         COALESCE(d.department_name, 'Unassigned') as department_name
//       FROM work_time_records wtr
//       JOIN employee e ON wtr.employee_nuid = e.employee_nuid
//       LEFT JOIN department d ON e.department_id = d.department_id
//       ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
//     `);

//     console.log(`✅ Fetched ${rows.length} work time records`);
//     res.json(rows);
//   } catch (err) {
//     console.error('❌ WTR query error:', err);
//     res.status(500).json({
//       error: 'Failed to fetch work time records',
//       details: process.env.NODE_ENV === 'development' ? err.message : 'Database error'
//     });
//   } finally {
//     client.release();
//   }
// });

// app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
//   const id = Number(req.params.id);
//   const { status } = req.body || {};

//   if (!Number.isInteger(id) || id <= 0) {
//     return res.status(400).json({ error: 'Invalid WTR ID' });
//   }

//   const allowed = new Set(['pending', 'approved', 'rejected']);
//   const normalizedStatus = String(status).toLowerCase();

//   if (!allowed.has(normalizedStatus)) {
//     return res.status(400).json({
//       error: 'Invalid status',
//       allowed: Array.from(allowed)
//     });
//   }

//   const client = await pool.connect();
//   try {
//     console.log(`🔄 Updating WTR ${id} status to ${normalizedStatus}`);

//     const { rowCount } = await client.query(
//       `UPDATE work_time_records 
//        SET approval_status = $1, updated_at = CURRENT_TIMESTAMP 
//        WHERE wtr_id = $2`,
//       [normalizedStatus, id]
//     );

//     if (rowCount === 0) {
//       return res.status(404).json({ error: 'Work time record not found' });
//     }

//     console.log(`✅ Successfully updated WTR ${id}`);
//     res.json({ success: true, updated: rowCount });
//   } catch (err) {
//     console.error('❌ Status update error:', err);
//     res.status(500).json({
//       error: 'Failed to update status',
//       details: process.env.NODE_ENV === 'development' ? err.message : 'Database error'
//     });
//   } finally {
//     client.release();
//   }
// });

// /* ------------------------ HTML / Static ------------------------ */
// function serveHtml(fileName) {
//   return (req, res) => {
//     const filePath = path.join(__dirname, fileName);
//     fs.readFile(filePath, 'utf8', (err, html) => {
//       if (err) {
//         console.error(`❌ Error reading ${fileName}:`, err);
//         return res.status(500).send(`
//           <h1>Server Error</h1>
//           <p>Could not load ${fileName}</p>
//           <p>Make sure the file exists in the project root.</p>
//         `);
//       }

//       const injected = html.replace(
//         /\$\{CLERK_PUBLISHABLE_KEY\}/g,
//         process.env.CLERK_PUBLISHABLE_KEY || ''
//       );

//       res.setHeader('Content-Type', 'text/html; charset=utf-8');
//       res.send(injected);
//     });
//   };
// }

// // Routes
// app.get('/', serveHtml('Sign in.html'));
// app.get('/sign-in', serveHtml('Sign in.html'));
// app.get('/dashboard', serveHtml('index.html'));

// // Serve static files (images, etc.)
// app.use(express.static(path.join(__dirname), {
//   setHeaders: (res, path) => {
//     if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) {
//       res.setHeader('Cache-Control', 'public, max-age=31536000');
//     }
//   }
// }));

// // 404 handler
// app.use('*', (req, res) => {
//   console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
//   res.status(404).json({
//     error: 'Not found',
//     path: req.originalUrl,
//     method: req.method
//   });
// });

// // Error handler
// app.use((err, req, res, next) => {
//   console.error('❌ Unhandled error:', err);
//   res.status(500).json({
//     error: 'Internal server error',
//     details: process.env.NODE_ENV === 'development' ? err.message : undefined
//   });
// });

// // Handle graceful shutdown
// const gracefulShutdown = () => {
//   console.log('🛑 SIGTERM received, shutting down gracefully');
//   pool.end(() => {
//     console.log('📊 Database pool closed');
//     process.exit(0);
//   });
// };

// process.on('SIGTERM', gracefulShutdown);
// process.on('SIGINT', gracefulShutdown);

// // Start server
// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${PORT}`);
//   console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
//   console.log(`🔐 Sign in: http://localhost:${PORT}/sign-in`);
//   console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
// });
// server.js - Complete updated file with aggregated WTR queries
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { clerkMiddleware, requireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------- Middleware ------------------------- */
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://iecc-db-approvals-ui-production-74a7.up.railway.app']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());
app.use(clerkMiddleware());

/* ---------------------------- PostgreSQL ---------------------------- */
const must = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

// PostgreSQL connection with Railway-specific configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${must('PGUSER')}:${must('PGPASSWORD')}@${must('PGHOST')}:${process.env.PGPORT || 5432}/${must('PGDATABASE')}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 20,
  min: 5,
});

// Test database connection on startup with retry logic
async function connectWithRetry(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('✅ Database connected successfully');

      // Test basic query
      const result = await client.query('SELECT NOW()');
      console.log('✅ Database query test passed:', result.rows[0].now);

      client.release();
      return;
    } catch (err) {
      console.error(`❌ Database connection attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) {
        console.error('❌ All database connection attempts failed');
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Initialize database connection
connectWithRetry().catch(err => {
  console.error('❌ Fatal: Could not connect to database:', err);
  process.exit(1);
});

/* ------------------------- Auth Helpers ------------------------- */
function getEmailFromClaims(claims = {}) {
  console.log('🔍 Full claims object:', JSON.stringify(claims, null, 2));

  // Enhanced email extraction with more debugging
  const possibleEmails = [
    claims.email,
    claims.email_address,
    claims.primary_email_address,
    claims.primaryEmailAddress?.emailAddress,
    Array.isArray(claims.email_addresses) ? claims.email_addresses[0] : null,
    Array.isArray(claims.emailAddresses) ? claims.emailAddresses[0]?.emailAddress : null,
    // Additional paths that might exist
    claims['https://clerk.dev/email'],
    claims['clerk/email'],
    claims.sub && claims.sub.includes('@') ? claims.sub : null // Sometimes sub contains email
  ];

  console.log('🔍 Possible email values:', possibleEmails);

  const foundEmail = possibleEmails.find(email => email && typeof email === 'string' && email.includes('@'));
  console.log('📧 Found email:', foundEmail);

  return foundEmail || null;
}

async function getUserFromClerk(userId) {
  try {
    // Try to fetch user data from Clerk API
    const response = await fetch(`https://api.clerk.dev/v1/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const userData = await response.json();
      console.log('📧 Fetched user from Clerk API:', userData.email_addresses?.[0]?.email_address);
      return userData.email_addresses?.[0]?.email_address;
    }
  } catch (err) {
    console.error('❌ Failed to fetch user from Clerk API:', err.message);
  }
  return null;
}

function requireAuthWithDbCheck(req, res, next) {
  return requireAuth()(req, res, async () => {
    try {
      console.log('🔍 Auth check starting...');
      console.log('Auth object keys:', Object.keys(req.auth || {}));
      console.log('Session claims:', req.auth?.sessionClaims);

      let email = getEmailFromClaims(req.auth?.sessionClaims) || getEmailFromClaims(req.auth?.claims);

      // If no email in claims, try fetching from Clerk API using the user ID
      if (!email && req.auth?.sessionClaims?.sub) {
        console.log('🔍 No email in claims, trying Clerk API...');
        email = await getUserFromClerk(req.auth.sessionClaims.sub);
      }

      if (!email) {
        console.log('❌ No email found in session claims or Clerk API');
        console.log('Available claims:', JSON.stringify(req.auth, null, 2));
        return res.status(403).json({
          error: 'Email not found in session',
          debug: {
            hasAuth: !!req.auth,
            hasSessionClaims: !!req.auth?.sessionClaims,
            claimsKeys: req.auth?.sessionClaims ? Object.keys(req.auth.sessionClaims) : [],
            userId: req.auth?.sessionClaims?.sub,
            suggestion: 'Check JWT template configuration in Clerk Dashboard'
          }
        });
      }

      const userEmail = String(email).toLowerCase().trim();
      console.log('🔍 Looking for user with email:', userEmail);

      const client = await pool.connect();
      try {
        // First, let's see what's in the authentication table
        const { rows: allAuth } = await client.query('SELECT employee_email FROM authentication LIMIT 10');
        console.log('📋 Sample authentication records:', allAuth.map(r => r.employee_email));

        const { rows } = await client.query(
          `SELECT employee_email, employee_name, employee_nuid
           FROM authentication
           WHERE LOWER(TRIM(employee_email)) = $1`,
          [userEmail]
        );

        console.log(`📊 Found ${rows.length} matching users in database`);

        if (rows.length === 0) {
          console.log('❌ User not found in authentication table');
          return res.status(403).json({
            error: 'Access denied - user not authorized',
            email: userEmail,
            hint: 'Contact administrator to add your email to the system'
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
      res.status(500).json({
        error: 'Authentication verification failed',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
      });
    }
  });
}

/* ----------------------------- API ----------------------------- */

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      res.json({
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

app.get('/api/debug/dbinfo', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Check if tables exist
      const { rows: tables } = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('work_time_records', 'authentication', 'employee', 'department', 'details_submission_logs', 'projects', 'activity')
      `);

      const tableNames = tables.map(t => t.table_name);

      let counts = {};
      let samples = {};

      for (const tableName of tableNames) {
        try {
          const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
          counts[tableName] = countRows[0].n;

          // Get sample data
          const { rows: sampleRows } = await client.query(`SELECT * FROM ${tableName} LIMIT 3`);
          samples[tableName] = sampleRows;
        } catch (err) {
          counts[tableName] = `Error: ${err.message}`;
          samples[tableName] = [];
        }
      }

      res.json({
        tables_found: tableNames,
        counts,
        samples: process.env.NODE_ENV === 'development' ? samples : 'Hidden in production'
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Database info error:', err);
    res.status(500).json({
      error: 'Database connection failed',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/departments', requireAuthWithDbCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT department_id, department_name
      FROM department
      ORDER BY department_name
    `);
    console.log(`📋 Fetched ${rows.length} departments`);
    res.json(rows);
  } catch (err) {
    console.error('❌ Departments query error:', err);
    res.status(500).json({
      error: 'Failed to fetch departments',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Database error'
    });
  } finally {
    client.release();
  }
});

// Updated WTR endpoint with aggregated activities
app.get('/api/wtr', requireAuthWithDbCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('📊 Fetching work time records with aggregated activities...');

    // First, get the basic WTR data with employee info
    const wtrQuery = `
      SELECT 
        wtr.coda_wtr_id,
        wtr.wtr_id,
        wtr.wtr_month,
        wtr.wtr_year,
        wtr.approval_status,
        wtr.total_submitted_hours,
        wtr.expected_hours,
        e.employee_nuid,
        e.employee_name,
        e.employee_email,
        e.employee_title,
        COALESCE(d.department_name, 'Unassigned') as department_name
      FROM work_time_records AS wtr
      JOIN employee AS e ON e.employee_nuid = wtr.employee_nuid
      LEFT JOIN department AS d ON d.department_id = e.department_id
      ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
    `;

    const { rows: wtrRows } = await client.query(wtrQuery);

    // Then get all activities for each WTR
    const activitiesQuery = `
      SELECT 
        dsl.coda_wtr_id,
        dsl.coda_log_id,
        dsl.activity_id,
        dsl.project_id,
        dsl.hours_submitted,
        dsl.tech_report_description,
        a.activity_name,
        p.deal_name AS project_name,
        p.service_line
      FROM details_submission_logs dsl
      LEFT JOIN activity a ON a.activity_id = dsl.activity_id
      LEFT JOIN projects p ON p.project_id = dsl.project_id
      WHERE dsl.coda_wtr_id = ANY($1)
      ORDER BY dsl.coda_wtr_id, dsl.coda_log_id
    `;

    const wtrIds = wtrRows.map(row => row.coda_wtr_id);
    const { rows: activityRows } = wtrIds.length > 0 ? await client.query(activitiesQuery, [wtrIds]) : { rows: [] };

    // Group activities by WTR ID
    const activitiesByWtr = {};
    activityRows.forEach(activity => {
      if (!activitiesByWtr[activity.coda_wtr_id]) {
        activitiesByWtr[activity.coda_wtr_id] = [];
      }
      activitiesByWtr[activity.coda_wtr_id].push({
        coda_log_id: activity.coda_log_id,
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        project_id: activity.project_id,
        project_name: activity.project_name,
        service_line: activity.service_line,
        hours_submitted: parseFloat(activity.hours_submitted) || 0,
        tech_report_description: activity.tech_report_description
      });
    });

    // Combine WTR data with activities
    const combinedData = wtrRows.map(wtr => ({
      ...wtr,
      activities: activitiesByWtr[wtr.coda_wtr_id] || [],
      // Ensure hours are numbers
      total_submitted_hours: parseFloat(wtr.total_submitted_hours) || 0,
      expected_hours: parseFloat(wtr.expected_hours) || 0
    }));

    console.log(`✅ Fetched ${combinedData.length} work time records with activities`);
    
    // Log sample for debugging
    if (combinedData.length > 0) {
      console.log('Sample record:', {
        id: combinedData[0].coda_wtr_id,
        activities_count: combinedData[0].activities.length,
        total_hours: combinedData[0].total_submitted_hours
      });
    }

    res.json(combinedData);
  } catch (err) {
    console.error('❌ WTR query error:', err);
    res.status(500).json({
      error: 'Failed to fetch work time records',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Database error'
    });
  } finally {
    client.release();
  }
});

// Updated status update endpoint - use coda_wtr_id
app.put('/api/wtr/:id/status', requireAuthWithDbCheck, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userEmail = req.user.employee_email;
  
  console.log(`ℹ️ User ${userEmail} is attempting to update WTR ${id} to status: ${status}`);

  if (!id || !status) {
    return res.status(400).json({ error: 'Missing ID or status' });
  }

  const allowed = new Set(['pending', 'approved', 'rejected']);
  const normalizedStatus = String(status).toLowerCase();

  if (!allowed.has(normalizedStatus)) {
    return res.status(400).json({
      error: 'Invalid status',
      allowed: Array.from(allowed)
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update using coda_wtr_id
    const updateQuery = `
      UPDATE work_time_records 
      SET approval_status = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE coda_wtr_id = $2 
      RETURNING *
    `;
    
    const result = await client.query(updateQuery, [normalizedStatus, id]);

    if (result.rowCount > 0) {
      await client.query('COMMIT');
      console.log(`✅ Successfully updated WTR ${id} to status: ${normalizedStatus}`);
      res.json({ success: true, updated: result.rowCount, record: result.rows[0] });
    } else {
      await client.query('ROLLBACK');
      console.log(`⚠️ WTR ${id} not found.`);
      res.status(404).json({ error: 'Record not found' });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating record:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: process.env.NODE_ENV === 'development' ? err.message : 'Database error' 
    });
  } finally {
    client.release();
  }
});

/* ------------------------ HTML / Static ------------------------ */
// Serve HTML files
const serveHtml = (fileName) => {
  return (req, res) => {
    try {
      let content = fs.readFileSync(path.join(__dirname, fileName), 'utf-8');
      content = content.replace('${CLERK_PUBLISHABLE_KEY}', process.env.CLERK_PUBLISHABLE_KEY || '');
      res.setHeader('Content-Type', 'text/html');
      res.send(content);
    } catch (err) {
      console.error(`❌ Error serving ${fileName}:`, err);
      res.status(500).send(`
        <h1>Server Error</h1>
        <p>Could not load ${fileName}</p>
        <p>Make sure the file exists in the project root.</p>
      `);
    }
  };
};

// Routes
app.get('/', serveHtml('Sign in.html'));
app.get('/sign-in', serveHtml('Sign in.html'));
app.get('/dashboard', serveHtml('index.html'));

// Serve static files (images, etc.)
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, path) => {
    if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// 404 handler
app.use('*', (req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  pool.end(() => {
    console.log('📊 Database pool closed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`🔐 Sign in: http://localhost:${PORT}/sign-in`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});