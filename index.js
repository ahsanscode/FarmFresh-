import express from "express";
import bodyParser from "body-parser";
//import axios from "axios";

const app = express();
const port = 3000;



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
app.get("/become-seller", (req, res) => {
    res.render("become-seller.ejs");
});




app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});