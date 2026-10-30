const crypto = require("crypto");

const ENC_KEY = Buffer.from([
  0x9c, 0xfe, 0xeb, 0x1d, 0x0c, 0x89, 0xc1, 0x99, 0xa3, 0x62, 0x8a, 0x1c, 0x3f, 0x3d, 0xb4, 0x8f,
  0x81, 0x42, 0xd9, 0xcd, 0x27, 0x50, 0x44, 0x7a, 0x93, 0xc2, 0x04, 0x04, 0xf3, 0xad, 0x5f, 0x59,
]);

function encryptMessage(message, signingKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-ctr", ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
  const sig = crypto.createHmac("sha256", signingKey).update(message).digest();
  return Buffer.concat([encrypted, iv, sig]);
}

function decryptMessage(data, signingKey) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 48) return null;

  const payloadLen = data.length - 48;
  const encrypted = data.subarray(0, payloadLen);
  const iv = data.subarray(payloadLen, payloadLen + 16);
  const sig = data.subarray(payloadLen + 16);

  const decipher = crypto.createDecipheriv("aes-256-ctr", ENC_KEY, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");

  const expected = crypto.createHmac("sha256", signingKey).update(decrypted).digest();
  if (!crypto.timingSafeEqual(expected, sig)) return null;

  return decrypted;
}

function handleChallenge(challengeHex) {
  const vec = Buffer.from(challengeHex, "hex");
  if (vec.length === 0) return "";

  vec[0] ^= 0xaf;
  vec[0] &= 0xfa;
  vec[0] |= 0x09;
  vec[vec.length - 1] &= 0xf5;
  vec[vec.length - 1] ^= ~vec[0];

  for (let i = 1; i < vec.length - 1; i++) {
    vec[i] ^= vec[i - 1];
    vec[i] ^= vec[i + 1];
  }

  return vec.toString("hex");
}

module.exports = {
  encryptMessage,
  decryptMessage,
  handleChallenge,
};
