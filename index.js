import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import session from "express-session";
import multer from "multer";
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
app.use(express.json()); // Parse JSON bodies for API routes (e.g., cart add/update)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false
}));

// Simple disk storage for product images
const upload = multer({ dest: 'public/uploads/' });
app.use(passport.initialize());
app.use(passport.session());

// Expose logged-in user to EJS templates
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Check if logged-in seller already has a shop (farmer profile) and set cart count
app.use(async (req, res, next) => {
    try {
        if (req.session.user && req.session.user.role === 'seller') {
            const check = await pool.query('SELECT 1 FROM farmers WHERE user_id = $1 LIMIT 1', [req.session.user.id]);
            res.locals.hasShop = check.rowCount > 0;
        } else {
            res.locals.hasShop = false;
        }

        // Cart count for logged-in users
        if (req.session.user) {
            const cartCountRes = await pool.query('SELECT COUNT(*) FROM cart WHERE user_id = $1', [req.session.user.id]);
            res.locals.cartCount = parseInt(cartCountRes.rows[0].count, 10) || 0;
        } else {
            res.locals.cartCount = 0;
        }
    } catch (e) {
        console.error('Middleware error', e);
        res.locals.hasShop = res.locals.hasShop || false;
        res.locals.cartCount = res.locals.cartCount || 0;
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
app.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.id, p.name, p.price, p.market_price, p.unit, p.image_url, p.is_verified,
                            p.total_reviews, p.rating,
                            p.category,
                            f.farm_name, f.id AS farmer_id
             FROM products p
             LEFT JOIN farmers f ON p.farmer_id = f.id
             ORDER BY p.created_at DESC
             LIMIT 8`
        );

        res.render("index.ejs", { products: result.rows });
    } catch (err) {
        console.error('Home products fetch error', err);
        res.render("index.ejs", { products: [] });
    }
});

app.get("/register", (req, res) => {
    res.render("register.ejs");
});
// View cart
app.get("/cart", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect("/login");
        }
        
        const cartRes = await pool.query(
            `SELECT c.id, c.quantity, p.id as product_id, p.name, p.price, p.unit, p.image_url, 
                    f.farm_name, f.id as farmer_id
             FROM cart c
             JOIN products p ON c.product_id = p.id
             JOIN farmers f ON p.farmer_id = f.id
             WHERE c.user_id = $1
             ORDER BY c.added_at DESC`,
            [req.session.user.id]
        );
        
        const cartItems = cartRes.rows;
        let totalPrice = 0;
        
        cartItems.forEach(item => {
            item.subtotal = item.price * item.quantity;
            totalPrice += item.subtotal;
        });
        
        res.render("cart.ejs", { cartItems, totalPrice, cartCount: cartItems.length });
    } catch (err) {
        console.error('Cart view error', err);
        res.status(500).send('Failed to load cart');
    }
});

// Add to cart
app.post("/cart/add", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: "Please login first" });
        }
        
        const { productId, quantity } = req.body;
        const userId = req.session.user.id;
        const qty = parseInt(quantity) || 1;
        
        // Check if product exists and has stock
        const productRes = await pool.query(
            'SELECT id, stock_quantity FROM products WHERE id = $1',
            [productId]
        );
        
        if (productRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        
        if (productRes.rows[0].stock_quantity < qty) {
            return res.status(400).json({ success: false, message: "Insufficient stock" });
        }
        
        // Check if item already in cart
        const existingRes = await pool.query(
            'SELECT id, quantity FROM cart WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );
        
        if (existingRes.rowCount > 0) {
            // Update quantity
            const newQty = existingRes.rows[0].quantity + qty;
            if (newQty > productRes.rows[0].stock_quantity) {
                return res.status(400).json({ success: false, message: "Quantity exceeds available stock" });
            }
            await pool.query(
                'UPDATE cart SET quantity = $1 WHERE id = $2',
                [newQty, existingRes.rows[0].id]
            );
        } else {
            // Insert new cart item
            await pool.query(
                'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3)',
                [userId, productId, qty]
            );
        }
        
        res.json({ success: true, message: "Product added to cart" });
    } catch (err) {
        console.error('Add to cart error', err);
        res.status(500).json({ success: false, message: "Failed to add to cart" });
    }
});

// Update cart item quantity
app.post("/cart/update", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: "Please login first" });
        }
        
        const { cartId, quantity } = req.body;
        const userId = req.session.user.id;
        const qty = parseInt(quantity) || 1;
        
        if (qty <= 0) {
            return res.status(400).json({ success: false, message: "Quantity must be greater than 0" });
        }
        
        // Verify cart item belongs to user
        const cartRes = await pool.query(
            'SELECT product_id FROM cart WHERE id = $1 AND user_id = $2',
            [cartId, userId]
        );
        
        if (cartRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Cart item not found" });
        }
        
        // Check stock
        const productRes = await pool.query(
            'SELECT stock_quantity FROM products WHERE id = $1',
            [cartRes.rows[0].product_id]
        );
        
        if (qty > productRes.rows[0].stock_quantity) {
            return res.status(400).json({ success: false, message: "Quantity exceeds available stock" });
        }
        
        await pool.query(
            'UPDATE cart SET quantity = $1 WHERE id = $2',
            [qty, cartId]
        );
        
        res.json({ success: true, message: "Cart updated" });
    } catch (err) {
        console.error('Update cart error', err);
        res.status(500).json({ success: false, message: "Failed to update cart" });
    }
});

// Remove from cart
app.delete("/cart/remove/:cartId", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: "Please login first" });
        }
        
        const { cartId } = req.params;
        const userId = req.session.user.id;
        
        // Verify cart item belongs to user
        const cartRes = await pool.query(
            'DELETE FROM cart WHERE id = $1 AND user_id = $2',
            [cartId, userId]
        );
        
        if (cartRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Cart item not found" });
        }
        
        res.json({ success: true, message: "Item removed from cart" });
    } catch (err) {
        console.error('Remove from cart error', err);
        res.status(500).json({ success: false, message: "Failed to remove from cart" });
    }
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
app.get("/farmers", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT f.id, f.farm_name, f.location, f.district, f.address, f.rating, f.total_reviews, 
                    f.is_verified, f.created_at,
                    COUNT(p.id) as product_count
             FROM farmers f
             LEFT JOIN products p ON f.id = p.farmer_id
             GROUP BY f.id, f.farm_name, f.location, f.district, f.address, f.rating, f.total_reviews, 
                      f.is_verified, f.created_at
             ORDER BY f.is_verified DESC, f.rating DESC`
        );
        const farmers = result.rows;
        
        // Fetch products for each farmer
        for (let farmer of farmers) {
            const prodRes = await pool.query(
                `SELECT id, name, category, price, market_price, stock_quantity, unit, image_url, is_verified
                 FROM products
                 WHERE farmer_id = $1
                 LIMIT 6`,
                [farmer.id]
            );
            farmer.products = prodRes.rows;
        }
        
        res.render("farmers.ejs", { farmers });
    } catch (err) {
        console.error("Farmers fetch error:", err);
        res.status(500).send("Failed to load farmers");
    }
});

app.get("/farmer/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get farmer details
        const farmerRes = await pool.query(
            `SELECT id, farm_name, location, district, address, rating, total_reviews, 
                    is_verified, created_at, products
             FROM farmers
             WHERE id = $1`,
            [id]
        );
        
        if (farmerRes.rows.length === 0) {
            return res.status(404).send("Farmer not found");
        }
        
        const farmer = farmerRes.rows[0];
        
        // Get all products from this farmer
        const productsRes = await pool.query(
            `SELECT id, name, description, category, price, market_price, stock_quantity, unit, image_url, is_verified, created_at
             FROM products
             WHERE farmer_id = $1
             ORDER BY created_at DESC`,
            [id]
        );
        
        const products = productsRes.rows;
        res.render("farmer-products.ejs", { farmer, products });
    } catch (err) {
        console.error("Farmer products fetch error:", err);
        res.status(500).send("Failed to load farmer products");
    }
});

app.get("/farmer/:id/contact", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get farmer details with user contact information
        const farmerRes = await pool.query(
            `SELECT f.id, f.farm_name, f.location, f.district, f.address, f.farm_size, 
                    f.products, f.experience, f.rating, f.total_reviews, f.is_verified, 
                    f.created_at, f.mobile_banking_provider, f.mobile_banking_number,
                    u.name as owner_name, u.email, u.phone
             FROM farmers f
             JOIN users u ON f.user_id = u.id
             WHERE f.id = $1`,
            [id]
        );
        
        if (farmerRes.rows.length === 0) {
            return res.status(404).send("Farmer not found");
        }
        
        const farmer = farmerRes.rows[0];
        res.render("farmer-contact.ejs", { farmer });
    } catch (err) {
        console.error("Farmer contact fetch error:", err);
        res.status(500).send("Failed to load contact details");
    }
});

app.get("/track", (req, res) => {
    res.render("track.ejs");
});

app.get("/search", async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        
        if (!query) {
            return res.render("search-results.ejs", { query: '', products: [], farmers: [], totalResults: 0 });
        }
        
        const searchTerm = `%${query}%`;
        
        // Search products by name, category, or farmer name
        const productsRes = await pool.query(
            `SELECT p.id, p.name, p.description, p.category, p.price, p.market_price, p.stock_quantity, p.unit, p.image_url, p.is_verified, p.created_at,
                    p.rating, p.total_reviews,
                    f.farm_name, f.district, f.id as farmer_id
             FROM products p
             LEFT JOIN farmers f ON p.farmer_id = f.id
             WHERE LOWER(p.name) LIKE LOWER($1) 
                OR LOWER(p.category) LIKE LOWER($1)
                OR LOWER(f.farm_name) LIKE LOWER($1)
                OR LOWER(p.description) LIKE LOWER($1)
             ORDER BY p.created_at DESC
             LIMIT 50`,
            [searchTerm]
        );
        
        // Search farmers by farm name or location
        const farmersRes = await pool.query(
            `SELECT f.id, f.farm_name, f.location, f.district, f.address, f.rating, f.total_reviews, 
                    f.is_verified, f.created_at, f.products,
                    COUNT(p.id) as product_count
             FROM farmers f
             LEFT JOIN products p ON f.id = p.farmer_id
             WHERE LOWER(f.farm_name) LIKE LOWER($1) 
                OR LOWER(f.district) LIKE LOWER($1)
                OR LOWER(f.address) LIKE LOWER($1)
             GROUP BY f.id, f.farm_name, f.location, f.district, f.address, f.rating, f.total_reviews, f.is_verified, f.created_at, f.products
             ORDER BY f.is_verified DESC, f.rating DESC
             LIMIT 20`,
            [searchTerm]
        );
        
        const products = productsRes.rows;
        const farmers = farmersRes.rows;
        const totalResults = products.length + farmers.length;
        
        res.render("search-results.ejs", { query, products, farmers, totalResults });
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).send("Failed to perform search");
    }
});

app.get("/products", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.id, p.name, p.description, p.category, p.price, p.market_price, p.stock_quantity, p.unit, p.image_url, p.is_verified, p.created_at,
                    p.rating, p.total_reviews,
                    f.farm_name, f.district, f.id as farmer_id
             FROM products p
             LEFT JOIN farmers f ON p.farmer_id = f.id
             ORDER BY p.created_at DESC`
        );

        res.render("products.ejs", { products: result.rows });
    } catch (err) {
        console.error("Products fetch error:", err);
        res.status(500).send("Failed to load products");
    }
});
app.get("/product/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT p.id, p.name, p.description, p.category, p.price, p.market_price, p.stock_quantity, p.unit, p.image_url, p.is_verified, p.created_at,
                    p.rating, p.total_reviews,
                    f.id as farmer_id, f.farm_name, f.district, f.rating as farmer_rating, f.total_reviews as farmer_total_reviews
             FROM products p
             LEFT JOIN farmers f ON p.farmer_id = f.id
             WHERE p.id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).send("Product not found");
        }
        
        const product = result.rows[0];
        
        // Check if logged-in user has already rated this product
        let userRating = null;
        if (req.session.user) {
            const ratingRes = await pool.query(
                'SELECT id, rating, comment FROM reviews WHERE user_id = $1 AND product_id = $2',
                [req.session.user.id, id]
            );
            if (ratingRes.rowCount > 0) {
                userRating = ratingRes.rows[0];
            }
        }
        
        // Fetch all reviews for this product (visible to everyone)
        const allReviewsRes = await pool.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
                    u.name as user_name, u.email as user_email
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             WHERE r.product_id = $1
             ORDER BY r.created_at DESC`,
            [id]
        );
        const allReviews = allReviewsRes.rows;
        
        res.render("product-detail.ejs", { product, userRating, allReviews });
    } catch (err) {
        console.error("Product detail fetch error:", err);
        res.status(500).send("Failed to load product details");
    }
});

// Product rating submission
app.post("/product/:id/rate", async (req, res) => {
    try {
        const userId = req.session.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Please login to rate products" });
        }

        const productId = parseInt(req.params.id, 10);
        const rating = Number(req.body.rating);

        if (!productId || isNaN(productId)) {
            return res.status(400).json({ success: false, message: "Invalid product" });
        }
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
        }

        // Ensure product exists and get farmer id
        const prodRes = await pool.query('SELECT id, farmer_id FROM products WHERE id = $1', [productId]);
        if (prodRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        const farmerId = prodRes.rows[0].farmer_id;

        // Upsert review (one per user per product)
        const existingRes = await pool.query(
            'SELECT id FROM reviews WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );

        if (existingRes.rowCount > 0) {
            await pool.query(
                'UPDATE reviews SET rating = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [rating, existingRes.rows[0].id]
            );
        } else {
            await pool.query(
                'INSERT INTO reviews (user_id, product_id, farmer_id, rating, comment) VALUES ($1, $2, $3, $4, NULL)',
                [userId, productId, farmerId, rating]
            );
        }

        // Recompute product rating
        const aggProd = await pool.query(
            'SELECT AVG(rating)::numeric(3,2) AS avg_rating, COUNT(*) AS total_reviews FROM reviews WHERE product_id = $1',
            [productId]
        );
        const prodAvg = parseFloat(aggProd.rows[0].avg_rating) || 0;
        const prodCount = parseInt(aggProd.rows[0].total_reviews, 10) || 0;

        await pool.query(
            'UPDATE products SET rating = $1, total_reviews = $2 WHERE id = $3',
            [prodAvg, prodCount, productId]
        );

        // Recompute farmer rating (across all reviews tied to farmer)
        const aggFarmer = await pool.query(
            'SELECT AVG(rating)::numeric(3,2) AS avg_rating, COUNT(*) AS total_reviews FROM reviews WHERE farmer_id = $1',
            [farmerId]
        );
        const farmerAvg = parseFloat(aggFarmer.rows[0].avg_rating) || 0;
        const farmerCount = parseInt(aggFarmer.rows[0].total_reviews, 10) || 0;
        await pool.query(
            'UPDATE farmers SET rating = $1, total_reviews = $2 WHERE id = $3',
            [farmerAvg, farmerCount, farmerId]
        );

        return res.json({ success: true, rating: prodAvg, totalReviews: prodCount });
    } catch (err) {
        console.error('Rate product error', err);
        return res.status(500).json({ success: false, message: "Failed to save rating" });
    }
});

// Comment on a product (requires existing rating by the same user)
app.post("/product/:id/comment", async (req, res) => {
    try {
        const userId = req.session.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Please login to comment" });
        }

        const productId = parseInt(req.params.id, 10);
        const comment = (req.body.comment || '').trim();

        if (!productId || isNaN(productId)) {
            return res.status(400).json({ success: false, message: "Invalid product" });
        }
        if (!comment) {
            return res.status(400).json({ success: false, message: "Comment cannot be empty" });
        }

        // Ensure product exists and get farmer id (not strictly needed for comment, but keeps parity)
        const prodRes = await pool.query('SELECT id, farmer_id FROM products WHERE id = $1', [productId]);
        if (prodRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        // Require an existing review (rating) by this user
        const existingRes = await pool.query(
            'SELECT id FROM reviews WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );

        if (existingRes.rowCount === 0) {
            return res.status(400).json({ success: false, message: "Please rate this product before commenting" });
        }

        await pool.query(
            'UPDATE reviews SET comment = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [comment, existingRes.rows[0].id]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('Comment product error', err);
        return res.status(500).json({ success: false, message: "Failed to save comment" });
    }
});

// Delete comment from a product (requires existing rating by the same user)
app.delete("/product/:id/comment", async (req, res) => {
    try {
        const userId = req.session.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Please login to delete comment" });
        }

        const productId = parseInt(req.params.id, 10);

        if (!productId || isNaN(productId)) {
            return res.status(400).json({ success: false, message: "Invalid product" });
        }

        // Find the user's review for this product
        const existingRes = await pool.query(
            'SELECT id FROM reviews WHERE user_id = $1 AND product_id = $2',
            [userId, productId]
        );

        if (existingRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: "No review found" });
        }

        // Delete only the comment, keep the rating
        await pool.query(
            'UPDATE reviews SET comment = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [existingRes.rows[0].id]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('Delete comment error', err);
        return res.status(500).json({ success: false, message: "Failed to delete comment" });
    }
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

// Seller: My Farm details
app.get('/my-farm', requireSeller, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const farmerRes = await pool.query(
            `SELECT id, farm_name, location, district, address, farm_size, products, experience,
                    bank_name, account_number, account_holder_name, mobile_banking_provider,
                    mobile_banking_number, is_verified, rating, total_reviews, updated_at
             FROM farmers
             WHERE user_id = $1`,
            [userId]
        );
        const farm = farmerRes.rowCount ? farmerRes.rows[0] : null;
        let products = [];
        if (farm) {
            const prodRes = await pool.query(
                `SELECT id, name, category, price, stock_quantity, unit, image_url, is_verified, created_at
                 FROM products
                 WHERE farmer_id = $1
                 ORDER BY created_at DESC`,
                [farm.id]
            );
            products = prodRes.rows;
        }
        res.render('my-farm.ejs', { farm, products });
    } catch (err) {
        console.error('My farm load error', err);
        res.status(500).send('Failed to load farm details');
    }
});

// Seller: Edit Farm details
app.get('/edit-farm', requireSeller, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const farmerRes = await pool.query(
            `SELECT farm_name, location, district, address, farm_size, products, experience,
                    bank_name, account_number, account_holder_name, mobile_banking_provider,
                    mobile_banking_number
             FROM farmers
             WHERE user_id = $1`,
            [userId]
        );
        if (farmerRes.rowCount === 0) {
            return res.redirect('/create-shop');
        }
        const farm = farmerRes.rows[0];
        res.render('edit-farm.ejs', { farm });
    } catch (err) {
        console.error('Edit farm load error', err);
        res.status(500).send('Failed to load farm edit page');
    }
});

app.post('/edit-farm', requireSeller, async (req, res) => {
    const {
        farmName,
        location,
        district,
        address,
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
    const productValues = products ?? req.body['products[]'];
    const productsString = Array.isArray(productValues) ? productValues.join(', ') : productValues || null;

    try {
        const userId = req.session.user.id;
        const exists = await pool.query('SELECT id FROM farmers WHERE user_id = $1', [userId]);
        if (exists.rowCount === 0) {
            return res.redirect('/create-shop');
        }

        await pool.query(
            `UPDATE farmers
             SET farm_name = $1,
                 location = $2,
                 district = $3,
                 address = $4,
                 farm_size = $5,
                 products = $6,
                 experience = $7,
                 bank_name = $8,
                 account_number = $9,
                 account_holder_name = $10,
                 mobile_banking_provider = $11,
                 mobile_banking_number = $12,
                 updated_at = NOW()
             WHERE user_id = $13`,
            [farmName, location, district, address, sizeNumber, productsString, experience, bankName, accountNumber, accountName, mobileBanking, mobileNumber, userId]
        );

        res.redirect('/my-farm');
    } catch (err) {
        console.error('Edit farm save error', err);
        res.status(500).send('Failed to update farm');
    }
});

app.post('/add-product', requireSeller, upload.single('image_file'), async (req, res) => {
    const { name, description, category, unit, price, stock_quantity, image_url } = req.body;
    const userId = req.session.user.id;
    try {
        const farmerRes = await pool.query('SELECT id FROM farmers WHERE user_id = $1', [userId]);
        if (farmerRes.rowCount === 0) {
            return res.status(400).send('No farmer profile found');
        }
        const farmerId = farmerRes.rows[0].id;

        // Prefer uploaded file path if provided
        let imagePath = image_url || null;
        if (req.file) {
            imagePath = `/uploads/${req.file.filename}`;
        }

        await pool.query(
            `INSERT INTO products (farmer_id, name, description, category, price, market_price, stock_quantity, unit, image_url, is_organic, is_verified)
             VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, FALSE, FALSE)`,
            [farmerId, name, description || null, category || null, parseFloat(price), parseInt(stock_quantity, 10), unit, imagePath]
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
