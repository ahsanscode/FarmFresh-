import pool from './database.js';

// SQL schema for FarmFresh database
const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL DEFAULT 'buyer',
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Farmers table
CREATE TABLE IF NOT EXISTS farmers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    farm_name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    district VARCHAR(100),
    address TEXT,
    farm_size DECIMAL(10, 2),
    certification VARCHAR(255),
    products VARCHAR(255),
    experience VARCHAR(50),
    bank_name VARCHAR(255),
    account_number VARCHAR(100),
    account_holder_name VARCHAR(255),
    mobile_banking_provider VARCHAR(50),
    mobile_banking_number VARCHAR(20),
    is_verified BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3, 2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    price DECIMAL(10, 2) NOT NULL,
    market_price DECIMAL(10, 2),
    stock_quantity INTEGER DEFAULT 0,
    unit VARCHAR(50),
    image_url VARCHAR(500),
    is_organic BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3, 2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auctions table
CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    starting_price DECIMAL(10, 2) NOT NULL,
    current_bid DECIMAL(10, 2) DEFAULT 0,
    highest_bidder_id INTEGER REFERENCES users(id),
    total_bids INTEGER DEFAULT 0,
    quantity INTEGER NOT NULL,
    unit VARCHAR(50),
    image_url VARCHAR(500),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bids table
CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bid_amount DECIMAL(10, 2) NOT NULL,
    bid_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivery_date TIMESTAMP,
    total_price DECIMAL(10, 2) NOT NULL,
    delivery_address TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_method VARCHAR(50),
    is_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order Items table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL
);

-- Cart table
CREATE TABLE IF NOT EXISTS cart (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

-- Wishlist table
CREATE TABLE IF NOT EXISTS wishlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    farmer_id INTEGER REFERENCES farmers(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_products_farmer_id ON products(farmer_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_auctions_farmer_id ON auctions(farmer_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_cart_user_id ON cart(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);
`;

// Function to initialize database
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        console.log('Initializing FarmFresh database schema...');
        
        // Split the schema into individual statements
        const statements = schema
            .split(';')
            .map(statement => statement.trim())
            .filter(statement => statement.length > 0);
        
        for (const statement of statements) {
            await client.query(statement);
        }
        
        console.log('✓ Database schema initialized successfully!');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    } finally {
        client.release();
    }
}

export { initializeDatabase, pool };
