# FarmFresh Database Setup Guide

## Prerequisites
- PostgreSQL 12 or higher
- Node.js with pg package (already installed)

## Installation Instructions

### Step 1: Install PostgreSQL

**On Windows:**
1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run the installer and follow the installation wizard
3. Set a password for the `postgres` user (remember this for later)
4. Keep the default port 5432
5. Complete the installation

**On macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**On Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create the Database

After PostgreSQL is installed, create the database:

```bash
# Connect to PostgreSQL with default user
psql -U postgres

# Create the farmfresh database
CREATE DATABASE farmfresh;

# Exit psql
\q
```

Alternatively, using command line:
```bash
createdb -U postgres farmfresh
```

### Step 3: Environment Configuration

Create a `.env` file in your project root:

```env
# Database Configuration
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=farmfresh

# Server Configuration
NODE_ENV=development
PORT=3000
```

**Important:** Replace `your_postgres_password` with the password you set during PostgreSQL installation.

### Step 4: Initialize Database Schema

Run the schema initialization script:

```bash
node -e "const { initializeDatabase } = require('./config/schema'); initializeDatabase().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });"
```

Or add a script to package.json:

```json
{
  "scripts": {
    "db:init": "node -e \"const { initializeDatabase } = require('./config/schema'); initializeDatabase().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });\""
  }
}
```

Then run:
```bash
npm run db:init
```

## Database Schema Overview

The FarmFresh database includes the following tables:

### Core Tables
- **users** - User accounts (buyers and farmers)
- **farmers** - Farmer profile information
- **products** - Farm products available for sale

### Auction System
- **auctions** - Auction listings
- **bids** - Individual bid records

### E-commerce
- **orders** - Customer orders
- **order_items** - Items in each order
- **cart** - Shopping cart items
- **wishlist** - User's saved products

### Reviews & Ratings
- **reviews** - Product and farmer reviews

## Usage in Your Express App

Add this to your `index.js` to initialize the database on startup:

```javascript
const { initializeDatabase, pool } = require('./config/schema');

// Initialize database on server start
initializeDatabase().catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});

// Your existing Express setup...
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

## Verify Installation

Test the connection:

```bash
node -e "const pool = require('./config/database'); pool.query('SELECT NOW()', (err, res) => { if (err) console.error(err); else console.log('Connected:', res.rows[0]); pool.end(); });"
```

## Troubleshooting

**Error: "role 'postgres' does not exist"**
- Create the user: `sudo -u postgres createuser -P postgres`

**Error: "FATAL: Ident authentication failed"**
- Check your `.env` credentials match PostgreSQL setup
- On Linux, you may need to use `sudo -u postgres psql`

**Error: "connect ECONNREFUSED 127.0.0.1:5432"**
- Ensure PostgreSQL service is running:
  - Windows: Check Services > PostgreSQL
  - macOS: `brew services list`
  - Linux: `sudo systemctl status postgresql`

**Error: "database 'farmfresh' does not exist"**
- Create it: `createdb -U postgres farmfresh`

## Useful PostgreSQL Commands

```bash
# Connect to database
psql -U postgres -d farmfresh

# List all databases
\l

# Connect to specific database
\c farmfresh

# List all tables
\dt

# Describe table structure
\d table_name

# View table data
SELECT * FROM table_name;

# Exit psql
\q
```

## Next Steps

1. Update your Express routes to use the database connection
2. Create models/repositories for database operations
3. Implement user authentication with database
4. Add product management features
5. Implement order and auction systems

For more information, see PostgreSQL documentation: https://www.postgresql.org/docs/
