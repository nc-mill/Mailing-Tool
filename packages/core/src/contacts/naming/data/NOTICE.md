# Licenční poznámka k datovým souborům modulu oslovení

## `given-names.json`

Vlastní sestavená datová sada. Není odvozená z žádného cizího zdroje a nenese cizí licenci.
Obsahuje nejčastější česká a slovenská křestní jména a všech třináct obourodých jmen
vyjmenovaných v kapitole 4.4.4 části 2, tedy právě ta, která rozhodují o frontě ke kontrole
oslovení.

**Podmínka pro rozšíření (kapitola 10.4 části 2).** Cílový rozsah je 4 000 až 6 000 položek.
Když se sada rozšíří z externího zdroje, musí se **předem ověřit a tady uvést licence toho
zdroje**. Je to jediné místo, kde do domény kontaktů může vstoupit cizí licence, a je
to jediný důvod, proč tenhle soubor existuje.

## `vietnamese-surnames.json`

Vlastní seznam šestnácti nejčastějších vietnamských příjmení v Česku. Veřejně známá fakta,
bez licenčního zatížení.

## `titles.json`

Vlastní seznam českých akademických a vojenských titulů. Veřejně známá fakta, bez licenčního
zatížení.

## Knihovna, na které modul stojí

`czech-vocative` 2.1.0 je pod licencí **MIT**. Je to jediná knihovna, kterou tenhle plán
do repozitáře přidává.

**Zakázané alternativy.** `czech-inflection` je LGPL-2.1 a použít se nesmí: v JavaScriptu
se knihovna bundluje, takže argument o dynamickém linkování neobstojí. Totéž platí pro
`jschardet` (LGPL-2.1+), který se nesmí použít ani na detekci kódování. Zákaz platí
i pro pozdější „jen na vyzkoušení".

> Kořenový soubor `NOTICE` v tomhle repozitáři zatím není. Až vznikne, patří do něj
> odstavec o `given-names.json` a odkaz sem.
