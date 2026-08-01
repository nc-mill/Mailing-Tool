/*
 * Odešle potvrzovací formulář za uživatele, takže mu stačí jedno kliknutí,
 * a to na odkaz v e-mailu.
 *
 * Skript je STATICKÝ SOUBOR, ne vložený kód ve stránce. Má to tři důvody: nese
 * ho cache prohlížeče, projde přísnou politikou obsahu bez povolení vloženého
 * skriptu, a hlavně v něm nikdy nemůže skončit hodnota z požadavku.
 *
 * Načítá se JEN v režimu one_step. Bezpečnostní skener, který odkaz proklikne,
 * JavaScript nespustí a nic nepotvrdí. Bez JavaScriptu zůstane tlačítko ve stránce
 * plně funkční, jen s druhým kliknutím.
 */
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('ml-confirm-form');
  if (form !== null) form.submit();
});
