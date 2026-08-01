// Package mimebuild sestavuje MIME zprávu.
//
// Buduje se vlastním kódem nad standardní knihovnou, ne knihovnou třetí strany.
// Důvody jsou v plánu, kapitola 1.5: potřebujeme bajtovou determinističnost kvůli
// golden fixtures, injektovatelný generátor boundary a libovolné vlastní hlavičky.
package mimebuild

import (
	"encoding/base64"
	"strings"
	"unicode/utf8"
)

const (
	encodedWordPrefix = "=?utf-8?B?"
	encodedWordSuffix = "?="
	// maxEncodedWord je limit z RFC 2047: jeden encoded-word má nejvýš 75 znaků
	// VČETNĚ obálky.
	maxEncodedWord = 75
	// maxChunkBytes je největší počet bajtů UTF-8, jehož base64 se vejde do obálky.
	// 75 - 10 - 2 = 63 znaků base64, tedy 15 čtveřic, tedy 45 bajtů.
	maxChunkBytes = 45
)

func isASCIIPrintable(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 32 || s[i] > 126 {
			return false
		}
	}
	return true
}

// EncodeHeaderValue zapíše hodnotu doslova, když je čistě ASCII, jinak ji zakóduje
// jako jeden nebo víc encoded-words.
//
// Kódování je B (base64), protože český text má hodně znaků mimo ASCII a Q by byl
// delší. Dělí se JEN na hranici celého znaku UTF-8: rozdělení vícebajtového znaku
// uprostřed je nejčastější chyba a projeví se jako rozsypaná diakritika v předmětu.
func EncodeHeaderValue(s string) string {
	if isASCIIPrintable(s) {
		return s
	}
	var words []string
	rest := s
	for len(rest) > 0 {
		cut := len(rest)
		if cut > maxChunkBytes {
			cut = maxChunkBytes
			// Posuň hranici zpět na začátek celého znaku.
			for cut > 0 && !utf8.RuneStart(rest[cut]) {
				cut--
			}
			if cut == 0 {
				// Jediný znak je delší než limit, což u UTF-8 nenastane,
				// ale nekonečnou smyčku tím vyloučíme.
				_, size := utf8.DecodeRuneInString(rest)
				cut = size
			}
		}
		chunk := rest[:cut]
		rest = rest[cut:]
		words = append(words, encodedWordPrefix+base64.StdEncoding.EncodeToString([]byte(chunk))+encodedWordSuffix)
	}
	// Folding: encoded-words se oddělují CRLF a mezerou.
	return strings.Join(words, "\r\n ")
}

// EncodeAddress sestaví adresní hlavičku. Kóduje se JEN display name, nikdy
// adresa: ta musí zůstat čistě ASCII, u mezinárodních domén v Punycode.
func EncodeAddress(displayName, address string) string {
	if strings.TrimSpace(displayName) == "" {
		return "<" + address + ">"
	}
	return EncodeHeaderValue(displayName) + " <" + address + ">"
}
