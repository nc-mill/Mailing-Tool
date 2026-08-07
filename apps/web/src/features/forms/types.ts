/**
 * Tvary z `GET /api/v1/forms**`. Bydlí zvlášť, protože je čtou serverové stránky
 * i klientské komponenty a `actions.ts` má direktivu `'use server'`, ze které
 * jde exportovat jedině asynchronní funkce.
 */

export type FormFieldView = {
  target: string | { attribute: string };
  label: Record<string, string>;
  required: boolean;
  type: string;
  options?: { value: string; label: Record<string, string> }[];
};

/** Vlastní pole kontaktu z `GET /api/v1/contact-fields`. */
export type ContactFieldOption = {
  id: string;
  key: string;
  label: Record<string, string>;
  type: string;
  options: Record<string, unknown>;
  required: boolean;
  archived_at: string | null;
};

export type FormView = {
  id: string;
  name: string;
  /** VEŘEJNÝ identifikátor pro `/f/{slug}`, ne holý slug z databáze. */
  slug: string;
  hosted_url: string;
  fields: FormFieldView[];
  list_ids: string[];
  double_opt_in: boolean;
  consent_text: string | null;
  /**
   * Musí návštěvník políčko zaškrtnout, aby se formulář odeslal? Nepovinný souhlas
   * dává smysl u přihlášení do seznamu, kde souhlas nese už samo přihlášení a tohle
   * políčko je navíc (třeba potvrzení obchodních podmínek webu).
   */
  consent_required: boolean;
  active: boolean;
  /** Šablona e-mailu, který přijde po vyplnění. `null` = formulář nic neposílá. */
  delivery_template_id: string | null;
  /**
   * Kam po odeslání a co se místo toho napíše. Obojí je v API i ve schématu od
   * začátku, jen to do 5. 8. 2026 nebylo v editoru, takže se to nedalo nastavit.
   * `redirect_url = null` znamená „zůstane naše stránka s poděkováním".
   */
  redirect_url: string | null;
  /**
   * Veřejné stránky formuláře: návrhy druhu `page` místo vestavěné věty.
   * `null` znamená vestavěný text, tedy dnešní chování.
   *
   * Odkaz je u KAŽDÉHO formuláře zvlášť, i když šablona je sdílená: dva
   * formuláře smějí ukazovat na tutéž stránku i na dvě různé.
   */
  thanks_template_id: string | null;
  confirmed_template_id: string | null;
  already_subscribed_template_id: string | null;
  success_message: Record<string, string>;
  submission_count: number;
  accepted_30d: number;
  /**
   * Odeslání, která ochrana zahodila, za 30 dní po důvodech. Nejde o přihlášení,
   * takže se do počtu přihlášení NEPŘIČÍTÁ; ukazuje se vedle něj jako varování.
   */
  dropped_30d: Record<string, number>;
  created_at: string;
};

export type FormEmbedView = {
  slug: string;
  hosted_url: string;
  script: string;
  iframe: string;
  first_submission_at: string | null;
};

export type ListOption = { id: string; name: string };
export type TemplateOption = { id: string; name: string };
