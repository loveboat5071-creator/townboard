const blob = require('@vercel/blob');
console.log('Keys in @vercel/blob:', Object.keys(blob));
if (blob.client) console.log('Keys in @vercel/blob/client:', Object.keys(blob.client));
