export type EmbedScriptInput = {
  ref: string;
  action: string;
  /** Adresa, ze které si skript vyžádá nonce. Bez něj se odeslání tiše zahodí. */
  nonceUrl: string;
  submitLabel: string;
  successMessage: string;
  honeypot: string;
  /** Text u zaškrtávátka souhlasu. Prázdný řetězec znamená, že souhlas není. */
  consentText: string;
  consentRequired: boolean;
  fields: {
    name: string;
    label: string;
    /** Značka vstupu: `text`, `email`, `date`, `number`, `textarea`, `select`, `checkbox`. */
    type: string;
    required: boolean;
    /** Jen u `select`. Hodnoty se berou z vlastního pole kontaktu, aby se nerozešly. */
    options?: { value: string; label: string }[];
  }[];
};

/**
 * ÚCHYTY PRO CSS. Od téhle chvíle je to VEŘEJNÝ KONTRAKT.
 *
 * Kdo si podle nich nastyluje formulář na svém webu, tomu ho přejmenování rozbije,
 * a my se o tom nedozvíme: jeho web nespadne, jen bude formulář vypadat jinak.
 * Jména se proto nemění a hlídá je `apps/web/test/public/embed-script.test.ts`.
 *
 * Stavy nejsou třídy, ale `data-` atributy: třída by se musela přidávat a odebírat
 * a snadno by zůstala viset, kdežto atribut má vždy právě jednu hodnotu.
 */
export const EMBED_CLASSES = {
  form: 'ml-form',
  field: 'ml-field',
  label: 'ml-label',
  input: 'ml-input',
  error: 'ml-error',
  consent: 'ml-consent',
  button: 'ml-button',
  success: 'ml-success',
} as const;

/**
 * Stavy formuláře na kořenové značce: `data-ml-state="idle|sending|done|error"`.
 * Chybné pole nese `data-ml-invalid="true"` na svém obalu `.ml-field`.
 */
export const EMBED_STATE_ATTRIBUTE = 'data-ml-state';
export const EMBED_INVALID_ATTRIBUTE = 'data-ml-invalid';

/**
 * Skript k vložení na cizí web.
 *
 * NENESE ANI JEDEN STYL, a je to rozhodnutí zadavatele: „Formuláře nesmí mít žádné
 * css, musí být stylovatelný až po vložení na web formou embed kódu." Znamená to
 * tři konkrétní věci:
 *
 *   1. ŽÁDNÝ ZAPOUZDŘENÝ STROM (shadow DOM). Ten dřív formulář schválně izoloval,
 *      aby ho styly hostitelské stránky nemohly rozbít. Jenže tatáž izolace znamená,
 *      že ho nemohou ani ostylovat: CSS webu se dovnitř nedostane. Formulář se proto
 *      vykresluje přímo do `<div data-ml-form>`, tedy do světa hostitelské stránky.
 *   2. ŽÁDNÁ ZNAČKA `<style>` a žádné vlastní CSS z nastavení formuláře. Sloupec
 *      `forms.custom_css` se sem NEPŘEDÁVÁ; platí jen pro naši hostovanou stránku
 *      `/f/{ref}`, která je naše a vypadat nějak musí.
 *   3. ŽÁDNÝ ATRIBUT `style`, s jedinou výjimkou níž.
 *
 * Místo stylů nese skript ÚCHYTY z `EMBED_CLASSES` a stavy v `data-` atributech.
 * Bez nich by „stylovatelný" znamenalo „vyberte si to selektorem na značky a doufejte".
 *
 * JEDINÁ VÝJIMKA je časová past (honeypot), která se skrývá inline stylem. Není to
 * vzhled, je to funkce: viditelné pole by lidé vyplňovali a ochrana by jejich odeslání
 * zahazovala jako od robota. Skrýt ho třídou nejde, protože ke třídě by musel web
 * dodat pravidlo, a než ho dodá, sbírá formulář prázdno.
 *
 * FORMULÁŘ MUSÍ BÝT POUŽITELNÝ I BEZ JEDINÉHO PRAVIDLA STYLU. Proto je to obyčejný
 * `<form>` s popisky svázanými přes `for`/`id`, povinnost nese `required` a chyba
 * se píše textem, ne barvou.
 *
 * Limit dvanáct kilobajtů po kompresi. Skript SÁM O SOBĚ NIC NESLEDUJE a je oddělený
 * od trackovacího SDK: vkládá se na cizí weby a nesmí z nich odesílat nic, co si
 * jejich provozovatel nezvolil.
 *
 * Značky se skládají přes `createElement` a `textContent`, ne přes přiřazení do
 * `innerHTML`. Do formuláře jdou popisky z databáze, tedy hodnoty, které zadal uživatel
 * nástroje, a ty nesmí skončit jako spustitelný obsah na cizí stránce.
 *
 * Definice se do skriptu vkládá jako DATA přes `JSON.stringify`. Sekvence `</` se
 * rozděluje, protože jinak by popisek s textem `</script>` ukončil značku na hostitelské
 * stránce a zbytek definice by se stal HTML.
 */
export function buildEmbedScript(input: EmbedScriptInput): string {
  const definition = JSON.stringify({
    slug: input.ref,
    action: input.action,
    submitLabel: input.submitLabel,
    successMessage: input.successMessage,
    honeypot: input.honeypot,
    nonceUrl: input.nonceUrl,
    consentText: input.consentText,
    consentRequired: input.consentRequired,
    fields: input.fields,
    cls: EMBED_CLASSES,
  }).replaceAll('</', '<\\/');

  return `(function () {
  var def = ${definition};
  var host = document.querySelector('[data-ml-form="' + def.slug + '"]');
  if (!host) return;

  var form = document.createElement('form');
  form.className = def.cls.form;
  form.setAttribute('method', 'post');
  form.setAttribute('action', def.action);
  form.setAttribute('${EMBED_STATE_ATTRIBUTE}', 'idle');

  def.fields.forEach(function (field) {
    var wrapper = document.createElement('div');
    wrapper.className = def.cls.field;
    wrapper.setAttribute('data-ml-field', field.name);

    var id = 'ml-' + def.slug.slice(0, 8) + '-' + field.name;
    var label = document.createElement('label');
    label.className = def.cls.label;
    label.setAttribute('for', id);
    label.textContent = field.label;
    wrapper.appendChild(label);

    var control;
    if (field.type === 'textarea') {
      control = document.createElement('textarea');
    } else if (field.type === 'select') {
      control = document.createElement('select');
      (field.options || []).forEach(function (option) {
        var item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        control.appendChild(item);
      });
    } else {
      control = document.createElement('input');
      control.type = field.type;
    }
    control.className = def.cls.input;
    control.id = id;
    control.name = field.name;
    if (field.required) control.required = true;
    wrapper.appendChild(control);
    form.appendChild(wrapper);
  });

  if (def.consentText) {
    var consentWrap = document.createElement('div');
    consentWrap.className = def.cls.consent;
    var consentId = 'ml-' + def.slug.slice(0, 8) + '-consent';
    var consentBox = document.createElement('input');
    consentBox.type = 'checkbox';
    consentBox.id = consentId;
    consentBox.name = 'consent';
    consentBox.value = 'yes';
    if (def.consentRequired) consentBox.required = true;
    var consentLabel = document.createElement('label');
    consentLabel.setAttribute('for', consentId);
    consentLabel.textContent = def.consentText;
    consentWrap.appendChild(consentBox);
    consentWrap.appendChild(consentLabel);
    form.appendChild(consentWrap);
  }

  // Časová past. Jediné inline styly v celém skriptu, viz hlavička.
  var trap = document.createElement('div');
  trap.setAttribute('aria-hidden', 'true');
  trap.style.position = 'absolute';
  trap.style.left = '-9999px';
  var trapInput = document.createElement('input');
  trapInput.type = 'text';
  trapInput.name = def.honeypot;
  trapInput.tabIndex = -1;
  trapInput.autocomplete = 'off';
  trap.appendChild(trapInput);
  form.appendChild(trap);

  var error = document.createElement('p');
  error.className = def.cls.error;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.appendChild(error);

  var submit = document.createElement('button');
  submit.className = def.cls.button;
  submit.type = 'submit';
  submit.textContent = def.submitLabel;
  form.appendChild(submit);
  host.appendChild(form);

  // Nonce se bere HNED při vykreslení, ne až při odeslání: druhá vrstva ochrany
  // z něj počítá i dobu vyplňování, takže vyžádaný až u odeslání by znamenal
  // nulový čas a časová past by odeslání zahodila jako od robota.
  var nonce = '';
  fetch(def.nonceUrl, { credentials: 'omit' })
    .then(function (response) { return response.json(); })
    .then(function (data) { nonce = data && data.nonce ? data.nonce : ''; })
    .catch(function () { nonce = ''; });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    form.setAttribute('${EMBED_STATE_ATTRIBUTE}', 'sending');

    var data = { ml_nonce: nonce };
    new FormData(form).forEach(function (value, key) { data[key] = value; });

    fetch(def.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      // Chyba u konkrétního pole se ohlásí TEXTEM a označí atributem, ne barvou:
      // web nemusí mít pro chybu žádné pravidlo a člověk to i tak musí poznat.
      if (result.body && result.body.ok === false) {
        var details = result.body.details || [];
        details.forEach(function (detail) {
          var target = form.querySelector('[data-ml-field="' + detail.field + '"]');
          if (target) target.setAttribute('${EMBED_INVALID_ATTRIBUTE}', 'true');
        });
        error.textContent = details.length > 0 && details[0].field
          ? details[0].field + ': ' + details[0].code
          : 'error';
        error.hidden = false;
        form.setAttribute('${EMBED_STATE_ATTRIBUTE}', 'error');
        submit.disabled = false;
        return;
      }
      var done = document.createElement('p');
      done.className = def.cls.success;
      done.setAttribute('${EMBED_STATE_ATTRIBUTE}', 'done');
      done.textContent = def.successMessage;
      host.replaceChildren(done);
    }).catch(function () {
      // Když odeslání selže, formulář zůstane vyplněný, aby o data nikdo nepřišel.
      form.setAttribute('${EMBED_STATE_ATTRIBUTE}', 'error');
      submit.disabled = false;
    });
  });
})();`;
}
