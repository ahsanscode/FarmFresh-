# PostgreSQL Database Setup Complete ✅

## Files Created

1. **config/database.js** - Database connection pool configuration
2. **config/schema.js** - Database schema definition and initialization
3. **db-init.js** - Script to initialize database on first run
4. **.env.example** - Template for environment variables
5. **DATABASE_SETUP.md** - Detailed setup and troubleshooting guide

## Quick Start

### 1. Install PostgreSQL

Download from: https://www.postgresql.org/download/windows/

During installation, remember the password you set for the `postgres` user.

### 2. Create Database

```bash
psql -U postgres
CREATE DATABASE farmfresh;
\q
```

### 3. Create .env File

Copy `.env.example` to `.env` and update with your PostgreSQL password:

```
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=farmfresh
```

### 4. Initialize Database Schema

Run one of these commands:

```bash
# Option 1: Using the dedicated script
node db-init.js

# Option 2: Direct initialization
node -e "require('dotenv').config(); const { initializeDatabase } = require('./config/schema'); initializeDatabase().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });"
```

### 5. Update index.js

Add this at the top of your `index.js`:

```javascript
require('dotenv').config();
const { initializeDatabase } = require('./config/schema');

// Initialize database on startup
initializeDatabase().catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});
```

## Database Tables

The schema includes:

**User Management:**
- users
- farmers

**Products & Marketplace:**
- products
- auctions
- bids

**Orders & Cart:**
- orders
- order_items
- cart
- wishlist

**Reviews:**
- reviews

## Packages Installed

- `pg` - PostgreSQL client
- `dotenv` - Environment variable management

## Testing Connection

```bash
node -e "require('dotenv').config(); const pool = require('./config/database'); pool.query('SELECT NOW()', (err, res) => { if (err) console.error('Error:', err); else console.log('✅ Connected to database'); pool.end(); });"
```

## Next Steps

1. Update your Express routes to use the database connection
2. Import `pool` from `config/database` in your route handlers
3. Use SQL queries to fetch/insert data
4. Implement user authentication with database
5. Add product management features

Example query in a route:

```javascript
const pool = require('./config/database');

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

For detailed troubleshooting, see **DATABASE_SETUP.md**
