// Contract for a language-specific temporal lexicon.
//
// Core logic depends only on this interface; the words themselves live in
// src/locales/<lang>/ (D6: Russian only in MVP, localisation-ready).

import type { Evidence } from '../evidence.ts';
import type { DateRef, DateRole, TimeSpec } from './semantics.ts';

export type TimeRecognition = { spec: TimeSpec; evidence: Evidence };
export type DateRecognition = { role: DateRole; ref: DateRef; evidence: Evidence };

export interface TemporalLexicon {
  readonly locale: string;
  /** Every time expression found in `text`, left to right, non-overlapping. */
  recognizeTimes(text: string): TimeRecognition[];
  /** Every date expression found in `text`, left to right, non-overlapping. */
  recognizeDates(text: string): DateRecognition[];
}
