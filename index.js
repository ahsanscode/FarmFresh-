import express from "express";
import bodyParser from "body-parser";
import 'dotenv/config.js';
import { initializeDatabase } from './config/schema.js';
//import axios from "axios";

const app = express();
const port = process.env.PORT || 3000;

// Set up view engine
app.set("view engine", "ejs");
app.set("views", "views");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));


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
app.get("/become-seller", (req, res) => {
    res.render("become-seller.ejs");
});

// Initialize database and start server
initializeDatabase().catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


