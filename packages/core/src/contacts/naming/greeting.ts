import type { Confidence, Gender } from './types';

/**
 * SKLADATEL OSLOVENÍ SE PŘESTĚHOVAL do `@mlain/emails/greeting` a odsud se jen
 * reexportuje. Chování je nezměněné, včetně textů a pádů.
 *
 * DŮVOD STĚHOVÁNÍ: tutéž větu potřebuje složit editor v prohlížeči, aby uživateli
 * ukázal, co značka „Oslovení" vyrobí. Nález z provozu zněl „Když tam vložím
 * Oslovení, tak vlastně nevím, jak vypadá." `@mlain/core` sahá na databázi a do
 * prohlížeče se importovat nesmí, `@mlain/emails` ano, a jádro na něm už závisí,
 * takže kruh nevzniká.
 *
 * Cesta zůstala kvůli volajícím (přepočet oslovení, kontrola pátého pádu, zápis
 * kontaktu i jejich testy), aby se stěhování neprojevilo nikde jinde než tady.
 */
export { buildGreeting, type GreetingResult } from '@mlain/emails/greeting';

/**
 * Vstup se dopisuje ZDEJŠÍMI typy `Gender` a `Confidence`, ne těmi z `@mlain/emails`.
 * Jsou tvarově totožné, takže je překladač bere jako tentýž typ, ale volající
 * v jádře je předávají odsud a hlásit jim cizí jméno typu by je nutilo importovat
 * z balíčku, se kterým jinak nemají co do činění.
 */
export type GreetingInput = {
  locale: string;
  /** Ze sloupce workspaces.address_form, který vlastní část 1. */
  addressForm: 'formal' | 'informal';
  /** Ze settings.contacts.salutation_by. */
  salutationBy: 'first_name' | 'surname';
  /** Ze settings.contacts.vocative_policy. Výchozí je 'strict'. */
  vocativePolicy: 'strict' | 'balanced';
  firstName: string | null;
  lastName: string | null;
  gender: Gender;
  firstNameVocative: string | null;
  lastNameVocative: string | null;
  vocativeConfidence: Confidence;
};
