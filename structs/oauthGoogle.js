const axios = require("axios");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function getGoogleOAuthConfig(config) {
    const google = config?.google || {};
    const websitePort = config?.Website?.websiteport || 8080;
    return {
        clientId: String(google.clientId || "").trim(),
        clientSecret: String(google.clientSecret || "").trim(),
        redirectUriLauncher: String(
            google.redirectUriLauncher || "http://127.0.0.1:47823/callback",
        ).trim(),
        redirectUriWebsite: String(
            google.redirectUriWebsite ||
                `http://127.0.0.1:${websitePort}/oauth2/google/callback`,
        ).trim(),
        enabled: !!(
            google.clientId &&
            google.clientId !== "your-google-client-id-here" &&
            google.clientSecret &&
            google.clientSecret !== "your-google-client-secret-here"
        ),
    };
}

function buildGoogleAuthorizeUrl(clientId, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeGoogleCode(code, redirectUri, config) {
    const oauth = getGoogleOAuthConfig(config);
    if (!oauth.enabled) {
        throw new Error("Google OAuth is not configured in config.json.");
    }

    const tokenResponse = await axios.post(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({
            client_id: oauth.clientId,
            client_secret: oauth.clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = userResponse.data;
    const email = String(data.email || "")
        .trim()
        .toLowerCase();
    if (!email) {
        throw new Error("Google did not return an email for this account.");
    }

    return {
        id: String(data.id),
        email,
        name: String(data.name || data.given_name || "Player"),
        picture: data.picture || null,
        verified: !!data.verified_email,
    };
}

module.exports = {
    getGoogleOAuthConfig,
    buildGoogleAuthorizeUrl,
    exchangeGoogleCode,
};
