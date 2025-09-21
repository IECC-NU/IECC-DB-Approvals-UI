const express = require('express');
const { Pool } = require('pg'); // Changed from mysql2 to pg
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public folder

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
        
        // Get work time records with employee information
        const wtrResult = await client.query(`
            SELECT 
                wtr.wtr_id,
                wtr.employee_nuid,
                e.employee_name,
                e.employee_email,
                e.employee_title,
                e.department,
                wtr.wtr_month,
                wtr.wtr_year,
                wtr.coda_wtr_id,
                wtr.total_submitted_hours,
                wtr.expected_hours,
                wtr.status
            FROM work_time_records wtr
            JOIN employee e ON wtr.employee_nuid = e.employee_nuid
            ORDER BY wtr.wtr_year DESC, wtr.wtr_month DESC, e.employee_name
        `);

        const wtrRows = wtrResult.rows;

        // For each WTR record, get the associated activity details
        for (let wtr of wtrRows) {
            const activityResult = await client.query(`
                SELECT 
                    log_id,
                    activity_name,
                    hours_submitted,
                    tech_report_description,
                    project_name,
                    service_line,
                    coda_log_id
                FROM details_submission_logs
                WHERE coda_wtr_id = $1
                ORDER BY log_id
            `, [wtr.coda_wtr_id]);
            
            wtr.activities = activityResult.rows;
        }

        client.release();
        res.json(wtrRows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database connection failed' });
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
        
        const result = await client.query(
            'UPDATE work_time_records SET status = $1 WHERE wtr_id = $2',
            [status, wtrId]
        );

        client.release();

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'WTR record not found' });
        }

        res.json({ message: 'Status updated successfully', wtrId, newStatus: status });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Get departments for filter dropdown
app.get('/api/departments', async (req, res) => {
    try {
        const client = await pool.connect();
        
        const result = await client.query(`
            SELECT DISTINCT department 
            FROM employee 
            WHERE department IS NOT NULL 
            ORDER BY department
        `);

        client.release();
        res.json(result.rows.map(row => row.department));
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch departments' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Make sure your PostgreSQL server is running and the database exists');
});

// Test database connection on startup
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQL Database connected successfully');
        client.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
}

testConnection();