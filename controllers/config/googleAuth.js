const { OAuth2Client } = require("google-auth-library");

// Inisialisasi client dengan Client ID yang benar
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID, // Harus sama dengan Client ID aplikasi Anda
    });
    return { payload: ticket.getPayload() };
  } catch (error) {
    console.error("Google token verification error:", error);
    return { error: "Invalid token" };
  }
}

module.exports = { verifyGoogleToken };
