import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import 'dotenv/config.js';
import { initializeDatabase, pool } from './config/schema.js';
//import axios from "axios";

const app = express();
const port = process.env.PORT || 3000;

// Set up view engine
app.set("view engine", "ejs");
app.set("views", "views");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Expose logged-in user to EJS templates
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Check if logged-in seller already has a shop (farmer profile)
app.use(async (req, res, next) => {
    try {
        if (req.session.user && req.session.user.role === 'seller') {
            const check = await pool.query('SELECT 1 FROM farmers WHERE user_id = $1 LIMIT 1', [req.session.user.id]);
            res.locals.hasShop = check.rowCount > 0;
        } else {
            res.locals.hasShop = false;
        }
    } catch (e) {
        console.error('Shop check middleware error', e);
        res.locals.hasShop = false;
    }
    next();
});

// Passport serialize/deserialize
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
        if (!rows.length) return done(null, false);
        done(null, rows[0]);
    } catch (err) {
        done(err);
    }
});

const googleConfigured = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

if (googleConfigured) {
  // Google OAuth strategy
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      passReqToCallback: false
    }, async (accessToken, refreshToken, profile, done) => {
      try {
          const email = profile?.emails?.[0]?.value;
          const name = profile?.displayName || [profile?.name?.givenName, profile?.name?.familyName].filter(Boolean).join(' ').trim();
          if (!email) return done(new Error('No email returned from Google'));

          const existing = await pool.query('SELECT id, name, email, role FROM users WHERE email = $1', [email]);
          if (existing.rowCount) {
              return done(null, existing.rows[0]);
          }

          // Create buyer by default with a random password hash
          const randomPwd = Math.random().toString(36).slice(-12);
          const hashedPassword = await bcrypt.hash(randomPwd, 10);
          const insert = await pool.query(
              `INSERT INTO users (name, email, password, role, is_verified)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, name, email, role`,
              [name || email, email, hashedPassword, 'buyer', true]
          );
          return done(null, insert.rows[0]);
      } catch (err) {
          return done(err);
      }
  }));
} else {
  console.warn('Google OAuth not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable');
}


// Step 1: Render the home page "/" index.ejs
app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/register", (req, res) => {
    res.render("register.ejs");
});
app.get("/cart", (req, res) => {
    res.render("cart.ejs");
});
app.get("/auction", (req, res) => {
    res.render("auction.ejs");
});
app.get("/auction/:id", (req, res) => {
    res.render("auction-detail.ejs");
});app.get("/auction/:id", (req, res) => {
    res.render("auction-detail.ejs");
});
app.get("/login", (req, res) => {
    res.render("login.ejs");
});
app.get("/farmers", (req, res) => {
    res.render("farmers.ejs");
});
app.get("/track", (req, res) => {
    res.render("track.ejs");
});
app.get("/products", (req, res) => {
    res.render("products.ejs");
});
app.get("/product/:id", (req, res) => {
    res.render("product-detail.ejs");
});
app.get("/create-shop", async (req, res) => {
    // If not logged in or not a seller, route to registration with seller selected
    if (!req.session.user || req.session.user.role !== 'seller') {
        return res.redirect('/register?userType=seller');
    }
    // If logged-in seller, render create shop form
    res.render("create-shop.ejs");
});

// Google OAuth routes (only if configured)
if (googleConfigured) {
    app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

        app.get('/auth/google/farmfresh',
            passport.authenticate('google', { failureRedirect: '/login' }),
            async (req, res) => {
                // Sync passport user into our session shape used by templates
                if (req.user) {
                    req.session.user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role };
                    // If seller and no farmer profile yet, send to create shop
                    if (req.user.role === 'seller') {
                    try {
                        const farmerRes = await pool.query('SELECT id FROM farmers WHERE user_id = $1', [req.user.id]);
                        if (farmerRes.rowCount === 0) {
                        return res.redirect('/create-shop');
                        }
                    } catch (e) {
                        console.error('Post-Google farmer check failed', e);
                    }
                    }
                }
                res.redirect('/');
            }
        );
} else {
    app.get('/auth/google', (req, res) => {
        res.status(503).send('Google login not configured');
    });
}

// Profile page (requires login)
app.get("/profile", async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const userRes = await pool.query(
            'SELECT id, name, email, phone, role, is_verified, created_at FROM users WHERE id = $1',
            [req.session.user.id]
        );
        const fullUser = userRes.rows[0];

        let farmer = null;
        if (fullUser && fullUser.role === 'seller') {
            const farmerRes = await pool.query(
                'SELECT farm_name, district, address, farm_size, is_verified, rating, total_reviews, updated_at FROM farmers WHERE user_id = $1',
                [fullUser.id]
            );
            farmer = farmerRes.rowCount ? farmerRes.rows[0] : null;
        }

        res.render('profile.ejs', { user: req.session.user, fullUser, farmer });
    } catch (err) {
        console.error('Profile fetch error', err);
        res.status(500).send('Failed to load profile');
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Edit profile (GET)
app.get('/profile/edit', requireAuth, async (req, res) => {
    try {
        const userRes = await pool.query(
            'SELECT id, name, email, phone, role FROM users WHERE id = $1',
            [req.session.user.id]
        );
        const userData = userRes.rows[0];
        let farmer = null;
        if (userData.role === 'seller') {
            const farmerRes = await pool.query(
                'SELECT farm_name, district, address, farm_size FROM farmers WHERE user_id = $1',
                [userData.id]
            );
            farmer = farmerRes.rowCount ? farmerRes.rows[0] : null;
        }
        res.render('edit-profile.ejs', { user: req.session.user, userData, farmer });
    } catch (err) {
        console.error('Edit profile load error', err);
        res.status(500).send('Failed to load edit profile');
    }
});

// Edit profile (POST)
app.post('/profile/edit', requireAuth, async (req, res) => {
    const { name, phone, farm_name, district, address, farm_size } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'UPDATE users SET name = $1, phone = $2, updated_at = NOW() WHERE id = $3',
            [name, phone || null, req.session.user.id]
        );

        // If seller, update farmer profile as well
        if (req.session.user.role === 'seller') {
            await client.query(
                'UPDATE farmers SET farm_name = $1, district = $2, address = $3, farm_size = $4, updated_at = NOW() WHERE user_id = $5',
                [farm_name || null, district || null, address || null, farm_size ? parseFloat(farm_size) : null, req.session.user.id]
            );
        }

        await client.query('COMMIT');
        // Update session name for header
        req.session.user.name = name;
        res.redirect('/profile');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Edit profile save error', err);
        res.status(500).send('Failed to save profile');
    } finally {
        client.release();
    }
});

// Register buyer
app.post("/register", async (req, res) => {
    const { firstName, lastName, email, phone, password, confirmPassword, userType } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).send("Passwords do not match");
    }

    const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
    const role = userType === 'seller' ? 'seller' : 'buyer';

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, email, password, phone, role, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [name, email, hashedPassword, phone, role, false]
        );
        res.redirect("/login");
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).send("Email already registered");
        }
        console.error("Registration error", error);
        res.status(500).send("Registration failed");
    }
});

// Register seller & create farmer profile
app.post("/create-shop", requireSeller, async (req, res) => {
    const {
        farmName,
        address,
        district,
        farmSize,
        products,
        experience,
        bankName,
        accountNumber,
        accountName,
        mobileBanking,
        mobileNumber
    } = req.body;
    const sizeNumber = farmSize ? parseFloat(farmSize) : null;
    
    // Handle multiple product selections (checkboxes use products[])
    const productValues = products ?? req.body['products[]'];
    const productsString = Array.isArray(productValues) ? productValues.join(', ') : productValues || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = req.session.user.id;

        // Prevent duplicate shop creation for the same seller
        const exists = await client.query('SELECT 1 FROM farmers WHERE user_id = $1 LIMIT 1', [userId]);
        if (exists.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.redirect('/');
        }

        await client.query(
            `INSERT INTO farmers (user_id, farm_name, location, district, address, farm_size, products, experience, bank_name, account_number, account_holder_name, mobile_banking_provider, mobile_banking_number, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [userId, farmName, district, district, address, sizeNumber, productsString, experience, bankName, accountNumber, accountName, mobileBanking, mobileNumber, false]
        );

        await client.query('COMMIT');
        res.redirect("/profile");
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Create shop error", error);
        res.status(500).send("Create shop failed");
    } finally {
        client.release();
    }
});

// Login handler (buyers and sellers)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT id, name, email, password, role FROM users WHERE email = $1', [email]);
        if (result.rowCount === 0) {
            return res.status(401).send('Invalid email or password');
        }
        const user = result.rows[0];
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            return res.status(401).send('Invalid email or password');
        }
        // Save minimal user in session
        req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
        // If seller and no farmer profile yet, send to create shop
        if (user.role === 'seller') {
            const farmerRes = await pool.query('SELECT id FROM farmers WHERE user_id = $1', [user.id]);
            if (farmerRes.rowCount === 0) {
                return res.redirect('/create-shop');
            }
        }
        res.redirect('/');
    } catch (err) {
        console.error('Login error', err);
        res.status(500).send('Login failed');
    }
});

// Auth middlewares
function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

function requireSeller(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role !== 'seller') return res.status(403).send('Forbidden: seller access only');
    next();
}

// Seller: Add Product
app.get('/add-product', requireSeller, (req, res) => {
    res.render('add-product.ejs');
});

app.post('/add-product', requireSeller, async (req, res) => {
    const { name, description, category, unit, price, stock_quantity, image_url } = req.body;
    const userId = req.session.user.id;
    try {
        const farmerRes = await pool.query('SELECT id FROM farmers WHERE user_id = $1', [userId]);
        if (farmerRes.rowCount === 0) {
            return res.status(400).send('No farmer profile found');
        }
        const farmerId = farmerRes.rows[0].id;
        await pool.query(
            `INSERT INTO products (farmer_id, name, description, category, price, market_price, stock_quantity, unit, image_url, is_organic, is_verified)
             VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, FALSE, FALSE)`,
            [farmerId, name, description || null, category || null, parseFloat(price), parseInt(stock_quantity, 10), unit, image_url || null]
        );
        res.redirect('/products');
    } catch (err) {
        console.error('Add product error', err);
        res.status(500).send('Failed to add product');
    }
});

// My Orders (buyers and sellers as customers)
app.get('/my-orders', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const ordersRes = await pool.query(
      `SELECT id, order_date, delivery_date, total_price, delivery_address, status
       FROM orders
       WHERE user_id = $1
       ORDER BY order_date DESC`,
      [userId]
    );

    const orders = ordersRes.rows;
    let itemsByOrder = {};
    if (orders.length) {
      const orderIds = orders.map(o => o.id);
      const itemsRes = await pool.query(
        `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, oi.subtotal, p.name as product_name, p.unit
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ANY($1::int[])`,
        [orderIds]
      );
      for (const row of itemsRes.rows) {
        if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
        itemsByOrder[row.order_id].push(row);
      }
    }

    res.render('my-orders.ejs', { orders, itemsByOrder });
  } catch (err) {
    console.error('My orders error', err);
    res.status(500).send('Failed to load orders');
  }
});

// Initialize database and start server
(async () => {
  try {
    await initializeDatabase();
    console.log('✓ Database initialized');
    
    app.listen(port, () => {
      console.log(`✓ Server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('❌ Startup failed:', err.message || err);
    console.error('Make sure PostgreSQL is running and .env credentials are correct');
    process.exit(1);
  }
})();
