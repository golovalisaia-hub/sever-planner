// Evidence: the exact fragment of the user's own words that justifies a value.
//
// A future AI extractor must return, for every non-empty date/time (and later
// amount or duration), the substring of the original phrase it relied on. The
// server never trusts that claim as-is: the span must really exist in the
// source text, and a deterministic lexicon must read the same value from it.
// This is the code-level fix for TAVRO audit finding T7 ("no invented time"
// was enforced by the prompt only).
//
// Offsets are UTF-16 code-unit indices into the source exactly as stored
// (inputs are NFC-normalised once at ingestion, before offsets are produced).

import { fail } from './errors.ts';
import { integer, strictObject } from './validation.ts';
import type { DateRef, DateRole, DateSpec, TimeSpec } from './datetime/semantics.ts';
import { resolveDateRef } from './datetime/semantics.ts';
import type { TemporalLexicon } from './datetime/lexicon.ts';

export type Evidence = { text: string; start: number; end: number };

/** A value extracted from user input together with its justification. */
export type Extracted<T> = { value: T; evidence: Evidence | null };

export const MAX_EVIDENCE_CHARS = 160;

export type EvidenceFailure =
  | 'MISSING' | 'EMPTY' | 'TOO_LONG' | 'OUT_OF_RANGE' | 'MISMATCH' | 'NOT_FOUND' | 'AMBIGUOUS_LOCATION'
  | 'UNRECOGNIZED' | 'VALUE_MISMATCH' | 'VALUE_AMBIGUOUS';

export type EvidenceCheck<T = Evidence> = { ok: true; value: T; evidence: Evidence } | { ok: false; reason: EvidenceFailure };

/** Shape validation for an evidence object coming from an untrusted producer. */
export function parseEvidence(raw: unknown): { text: string; start: number | null; end: number | null } {
  const value = strictObject(raw, ['text', 'start', 'end'], 'evidence');
  if (typeof value.text !== 'string') fail('VALIDATION', 'evidence');
  const start = value.start === undefined || value.start === null ? null : integer(value.start, 0, 100000, 'evidence');
  const end = value.end === undefined || value.end === null ? null : integer(value.end, 0, 100000, 'evidence');
  if ((start === null) !== (end === null)) fail('VALIDATION', 'evidence');
  return { text: value.text as string, start, end };
}

/** Confirms the span literally exists in the source and pins its location. */
export function verifySpan(source: string, claimed: { text: string; start: number | null; end: number | null }): EvidenceCheck {
  const text = claimed.text;
  if (!text.trim()) return { ok: false, reason: 'EMPTY' };
  if (text.length > MAX_EVIDENCE_CHARS) return { ok: false, reason: 'TOO_LONG' };
  if (claimed.start !== null && claimed.end !== null) {
    const { start, end } = claimed;
    if (start < 0 || end > source.length || end <= start) return { ok: false, reason: 'OUT_OF_RANGE' };
    if (end - start !== text.length || source.slice(start, end) !== text) return { ok: false, reason: 'MISMATCH' };
    return { ok: true, value: { text, start, end }, evidence: { text, start, end } };
  }
  const first = source.indexOf(text);
  if (first < 0) return { ok: false, reason: 'NOT_FOUND' };
  if (source.indexOf(text, first + 1) >= 0) return { ok: false, reason: 'AMBIGUOUS_LOCATION' };
  const evidence = { text, start: first, end: first + text.length };
  return { ok: true, value: evidence, evidence };
}

const sameTime = (a: TimeSpec, b: TimeSpec): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'exact' && b.kind === 'exact') return a.time === b.time;
  if (a.kind === 'part_of_day' && b.kind === 'part_of_day') return a.partOfDay === b.partOfDay;
  if (a.kind === 'ambiguous' && b.kind === 'ambiguous') return a.candidates.join() === b.candidates.join();
  return a.kind === 'none';
};

/**
 * Verifies a claimed time against the user's words. The server's own reading
 * of the evidence is returned, so an accepted claim can never be more precise
 * than what the user actually said.
 */
export function verifyTimeClaim(
  source: string,
  claim: { value: TimeSpec; evidence: { text: string; start: number | null; end: number | null } | null },
  lexicon: TemporalLexicon,
): EvidenceCheck<TimeSpec> {
  if (claim.value.kind === 'none') return { ok: true, value: claim.value, evidence: { text: '', start: 0, end: 0 } };
  if (!claim.evidence) return { ok: false, reason: 'MISSING' };
  const span = verifySpan(source, claim.evidence);
  if (!span.ok) return span;
  const readings = lexicon.recognizeTimes(span.evidence.text);
  if (readings.length === 0) return { ok: false, reason: 'UNRECOGNIZED' };
  if (readings.length > 1) return { ok: false, reason: 'VALUE_AMBIGUOUS' };
  const reading = readings[0]!.spec;
  if (reading.kind === 'ambiguous' && claim.value.kind !== 'ambiguous') return { ok: false, reason: 'VALUE_AMBIGUOUS' };
  if (!sameTime(reading, claim.value)) return { ok: false, reason: 'VALUE_MISMATCH' };
  return { ok: true, value: reading, evidence: span.evidence };
}

const sameDate = (a: DateSpec, b: DateSpec): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Verifies a claimed date (and its role: planned vs deadline) against the user's words. */
export function verifyDateClaim(
  source: string,
  claim: { value: { role: DateRole; ref: DateRef }; evidence: { text: string; start: number | null; end: number | null } | null },
  lexicon: TemporalLexicon,
  today: string,
): EvidenceCheck<{ role: DateRole; spec: DateSpec }> {
  if (!claim.evidence) return { ok: false, reason: 'MISSING' };
  const span = verifySpan(source, claim.evidence);
  if (!span.ok) return span;
  const readings = lexicon.recognizeDates(span.evidence.text);
  if (readings.length === 0) return { ok: false, reason: 'UNRECOGNIZED' };
  if (readings.length > 1) return { ok: false, reason: 'VALUE_AMBIGUOUS' };
  const reading = readings[0]!;
  if (reading.role !== claim.value.role) return { ok: false, reason: 'VALUE_MISMATCH' };
  const readSpec = resolveDateRef(reading.ref, today);
  if (!sameDate(readSpec, resolveDateRef(claim.value.ref, today))) return { ok: false, reason: 'VALUE_MISMATCH' };
  return { ok: true, value: { role: reading.role, spec: readSpec }, evidence: span.evidence };
}
