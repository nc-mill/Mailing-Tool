export type EmbedScriptInput = {
  ref: string;
  action: string;
  submitLabel: string;
  successMessage: string;
  honeypot: string;
  css: string;
  fields: { name: string; label: string; type: 'text' | 'email'; required: boolean }[];
};

/**
 * Skript k vložení na cizí web. Vykresluje formulář do zapouzdřeného stromu (shadow DOM),
 * takže styly hostitelské stránky nemohou rozbít vzhled a naopak.
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
    fields: input.fields,
    css: input.css,
  }).replaceAll('</', '<\\/');

  return `(function () {
  var def = ${definition};
  var host = document.querySelector('[data-ml-form="' + def.slug + '"]');
  if (!host) return;

  var root = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = def.css;
  root.appendChild(style);

  var form = document.createElement('form');
  form.setAttribute('method', 'post');
  form.setAttribute('action', def.action);

  def.fields.forEach(function (field) {
    var wrapper = document.createElement('div');
    var label = document.createElement('label');
    label.setAttribute('for', 'ml-' + field.name);
    label.textContent = field.label;
    var input = document.createElement('input');
    input.id = 'ml-' + field.name;
    input.type = field.type;
    input.name = field.name;
    if (field.required) input.required = true;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

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

  var submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = def.submitLabel;
  form.appendChild(submit);
  root.appendChild(form);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit.disabled = true;
    var data = {};
    new FormData(form).forEach(function (value, key) { data[key] = value; });
    fetch(def.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function () {
      var done = document.createElement('p');
      done.textContent = def.successMessage;
      root.replaceChildren(style, done);
    }).catch(function () {
      // Když odeslání selže, formulář zůstane vyplněný, aby o data nikdo nepřišel.
      submit.disabled = false;
    });
  });
})();`;
}
