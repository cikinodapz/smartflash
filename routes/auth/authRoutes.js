const express = require('express');
const { login, logout, register, googleAuth } = require('../../controllers/authController/auth'); 

const router = express.Router();

// Rute login
router.post('/login', login);
router.post('/logout', logout);
router.post('/register', register);
router.post('/google-auth', googleAuth);

module.exports = router;
