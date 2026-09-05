# SEVER security

## Threat model

SEVER protects against accidental plaintext persistence, malformed backups, cross-account database access through RLS, authenticated-encryption tampering, common DOM injection, clickjacking (on hosts that apply `_headers`) and accidental repository secrets. It cannot protect a secret typed on a compromised device, a malicious browser extension, malware, or an attacker controlling the JavaScript origin.

## Protected notes

Protected note content (title, body and checklist) exists in plaintext only in the current browser tab while unlocked. Persistence contains an encrypted envelope only. Version 2 uses Web Crypto PBKDF2-SHA-256 (600,000 iterations), a new random 128-bit salt per encryption, AES-GCM-256 and a new random 96-bit IV per encryption. Legacy v1 envelopes remain decryptable. A successful edit/re-save writes v2.

Passwords and derived key material are never written to planner state, backup, sync queue or Supabase. The browser performs best-effort RAM/DOM cleanup on close, timeout, background timeout, logout and account change. JavaScript garbage collection means guaranteed memory wiping is not possible.

The default auto-lock is five minutes. Users can select 1, 5, 15 or 30 minutes, enable background locking and manually lock all protected notes. There is no password recovery for protected notes.

## Cloud and RLS

The browser contains only a Supabase publishable key. Every table uses RLS. Migration `002_security_hardening.sql` adds same-owner relational constraints and validates encrypted note envelopes. Never place a service-role key, database password or JWT secret in frontend files.

## Backups

Full backups use `{ "format": "sever-backup", "version": 2 }`, validate structure before restore and preserve protected notes as ciphertext. A separate vault export contains protected encrypted notes only. Backup files still reveal non-protected planner data and metadata; store them accordingly.

## Reporting a vulnerability

Do not publish exploitable details or user data in a public issue. Contact the repository owner privately with reproduction steps and affected versions.
