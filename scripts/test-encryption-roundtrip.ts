import crypto from "crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.APP_ENC_KEY;
  if (!keyHex) {
    throw new Error("APP_ENC_KEY environment variable is not set");
  }
  
  const keyBuffer = Buffer.from(keyHex, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(`APP_ENC_KEY must be 32 bytes (64 hex chars), got ${keyBuffer.length} bytes`);
  }
  return keyBuffer;
}

function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  const result = Buffer.concat([iv, authTag, encrypted]);
  return result.toString("base64");
}

function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64");
  
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString("utf8");
}

console.log("=== AES-256-GCM Encryption Round-Trip Test ===\n");

const testSecret = "JBSWY3DPEHPK3PXP";
console.log("Test TOTP secret (base32):", testSecret);
console.log("Length:", testSecret.length, "chars\n");

const encrypted = encryptSecret(testSecret);
console.log("Encrypted (base64):", encrypted);
console.log("Encrypted length:", encrypted.length, "chars\n");

const data = Buffer.from(encrypted, "base64");
console.log("Structure analysis:");
console.log("  - IV (12 bytes):", data.subarray(0, 12).toString("hex"));
console.log("  - Auth Tag (16 bytes):", data.subarray(12, 28).toString("hex"));
console.log("  - Ciphertext:", data.subarray(28).toString("hex"), "\n");

const decrypted = decryptSecret(encrypted);
console.log("Decrypted:", decrypted);
console.log("Match:", decrypted === testSecret ? "PASS" : "FAIL");
