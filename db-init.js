#!/usr/bin/env node

/**
 * FarmFresh Database Initialization Script
 * Run this after PostgreSQL is installed and the farmfresh database is created
 */

import 'dotenv/config.js';
import { initializeDatabase } from './config/schema.js';

console.log('🚀 Starting FarmFresh Database Initialization...\n');
console.log('Database Configuration:');
console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
console.log(`  Port: ${process.env.DB_PORT || 5432}`);
console.log(`  Database: ${process.env.DB_NAME || 'farmfresh'}`);
console.log(`  User: ${process.env.DB_USER || 'postgres'}\n`);

initializeDatabase()
    .then(() => {
        console.log('\n✅ Database initialization completed successfully!');
        console.log('\nYou can now start your server with: npm start');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Database initialization failed:');
        console.error(error.message);
        console.error('\nPlease ensure:');
        console.error('  1. PostgreSQL is installed and running');
        console.error('  2. The farmfresh database has been created');
        console.error('  3. Your .env file has correct database credentials');
        process.exit(1);
    });
