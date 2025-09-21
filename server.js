const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// API Routes

// Get all WTR data with employee info and activities
app.get('/api/wtr', async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Updated query to match your PostgreSQL schema
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

        // For each WTR record, get the associated activity details
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
app.put('/api/wtr/:wtrId/status', async (req, res) => {
    try {
        const { wtrId } = req.params;
        const { status } = req.body;

        // Validate status
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const client = await pool.connect();
        
        // Updated to use approval_status column name from your schema
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
app.get('/api/departments', async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Updated to use the department table
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

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('PostgreSQL connection configured');
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