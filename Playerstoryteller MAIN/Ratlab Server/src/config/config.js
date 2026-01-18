const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://ratlab.online',
    'https://www.ratlab.online'
];
  
// Allow environment variable override for custom domains
if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
}

const PORT = process.env.PORT || 3000;
const MOD_PORT = 3001;

module.exports = {
    allowedOrigins,
    PORT,
    MOD_PORT
};
