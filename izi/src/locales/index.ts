// Locale registry. MVP ships Russian only (D6); adding a language means adding
// a directory here, not touching core or module logic.

import type { TemporalLexicon } from '../core/datetime/lexicon.ts';
import type { ErrorCode } from '../core/errors.ts';
import { ruErrors } from './ru/messages.ts';
import { ruTemporal } from './ru/temporal.ts';

export const LOCALES = ['ru'] as const;
export type Locale = typeof LOCALES[number];

type Catalogue = { temporal: TemporalLexicon; errors: Record<ErrorCode, string> };

const CATALOGUES: Record<Locale, Catalogue> = {
  ru: { temporal: ruTemporal, errors: ruErrors },
};

export function catalogue(locale: Locale): Catalogue {
  return CATALOGUES[locale];
}
