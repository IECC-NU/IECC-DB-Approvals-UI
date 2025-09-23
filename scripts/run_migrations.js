const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL environment variable. On Railway this is provided automatically.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      try {
        await client.query(sql);
        console.log(`✔ Applied ${file}`);
      } catch (err) {
        console.error(`✖ Failed to apply ${file}:`, err.message);
        throw err;
      }
    }

    console.log('All migrations applied successfully.');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
