import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure nonce for CSP inline scripts.
 * Uses Node.js crypto module for secure random generation.
 */
export function getNonce(): string {
  return randomBytes(16).toString('base64url');
}
