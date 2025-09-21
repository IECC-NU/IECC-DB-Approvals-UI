const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? 
        'https://your-railway-domain.railway.app' : 
        'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL configuration
const pool = new Pool({
    host: process.env.DB_HOST || 'interchange.proxy.rlwy.net',
    port: process.env.DB_PORT || 30828,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'vCSNGeBZiJVIwCRduwnMmqlhWxblqNhU',
    database: process.env.DB_NAME || 'railway',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Custom authentication middleware with database check
const requireAuthWithDbCheck = async (req, res, next) => {
    try {
        // First, check if user is authenticated with Clerk
        await ClerkExpressRequireAuth()(req, res, async () => {
            try {
                // Get user email from Clerk
                const userEmail = req.auth.claims?.email?.toLowerCase();
                
                if (!userEmail) {
                    return res.status(403).json({ error: 'Email not found in authentication token' });
                }

                // Check if user exists in authentication table
                const client = await pool.connect();
                const result = await client.query(
                    'SELECT employee_email, employee_name, employee_nuid FROM authentication WHERE employee_email = $1',
                    [userEmail]
                );
                client.release();

                if (result.rows.length === 0) {
                    return res.status(403).json({ 
                        error: 'Access denied. Your email is not authorized for this system.',
                        email: userEmail
                    });
                }

                // Add user info to request for use in routes
                req.user = {
                    email: userEmail,
                    name: result.rows[0].employee_name,
                    nuid: result.rows[0].employee_nuid
                };

                next();
            } catch (dbError) {
                console.error('Database check error:', dbError);
                res.status(500).json({ error: 'Authentication verification failed' });
            }
        });
    } catch (authError) {
        console.error('Clerk auth error:', authError);
        res.status(401).json({ error: 'Authentication required' });
    }
};

// API Routes

// Get current user info
app.get('/api/user', requireAuthWithDbCheck, (req, res) => {
    res.json({
        authenticated: true,
        user: req.user
    });
});

// Get all WTR data with employee info and activities
app.get('/api/wtr', requireAuthWithDbCheck, async (req, res) => {
    try {
        const client = await pool.connect();
        
        const wtrResult = await client.query(`
            SELECT 
                wtr.wtr_id,
                wtr.employee_nuid,
                e.employee_name,
                e.employee_email,
                e.employee_title,
                d.department_name as department,
                wtr.wtr_month,
                wtr.wtr_year,
                wtr.coda_wtr_id,
                wtr.total_submitted_hours,
                wtr.expected_hours,
                wtr.approval_status as status
            FROM work_time_records wtr
            JOIN employee e ON wtr.employee_nuid = e.employee_nuid
            LEFT JOIN department d ON e.department_id = d.department_id
            ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
        `);

        const wtrRows = wtrResult.rows;

        for (let wtr of wtrRows) {
            const activityResult = await client.query(`
                SELECT 
                    dsl.log_id,
                    a.activity_name,
                    dsl.hours_submitted,
                    dsl.tech_report_description,
                    p.deal_name as project_name,
                    a.service_line,
                    dsl.coda_log_id
                FROM details_submission_logs dsl
                LEFT JOIN activity a ON dsl.activity_id = a.activity_id
                LEFT JOIN projects p ON dsl.project_id = p.project_id
                WHERE dsl.coda_wtr_id = $1
                ORDER BY dsl.log_id
            `, [wtr.coda_wtr_id]);
            
            wtr.activities = activityResult.rows;
        }

        client.release();
        res.json(wtrRows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database connection failed', details: error.message });
    }
});

// Update WTR status
app.put('/api/wtr/:wtrId/status', requireAuthWithDbCheck, async (req, res) => {
    try {
        const { wtrId } = req.params;
        const { status } = req.body;

        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const client = await pool.connect();
        const result = await client.query(
            'UPDATE work_time_records SET approval_status = $1 WHERE wtr_id = $2',
            [status, wtrId]
        );
        client.release();

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'WTR record not found' });
        }

        res.json({ message: 'Status updated successfully', wtrId, newStatus: status });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update status', details: error.message });
    }
});

// Get departments for filter dropdown
app.get('/api/departments', requireAuthWithDbCheck, async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT DISTINCT department_name 
            FROM department 
            ORDER BY department_name
        `);
        client.release();
        res.json(result.rows.map(row => row.department_name));
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch departments', details: error.message });
    }
});

// Test API endpoint
app.get('/api/test', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time, version() as db_version');
        client.release();
        
        res.json({
            message: 'Database connection successful',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database connection failed', details: error.message });
    }
});

// Route handlers

// Root route - serve the login/dashboard page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dashboard route - serve the same page (Clerk handles auth client-side)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('PostgreSQL connection configured');
    console.log('Clerk authentication configured');
});

// Test database connection on startup
async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT COUNT(*) as employee_count FROM employee');
        console.log('✅ PostgreSQL Database connected successfully');
        console.log(`📊 Found ${result.rows[0].employee_count} employees in database`);
        client.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
}

testConnection();