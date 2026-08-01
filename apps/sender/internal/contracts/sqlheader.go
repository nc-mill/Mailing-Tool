// Package contracts drží Go stranu golden fixtures pěti zmrazených kontraktů.
// Je to balíček TESTOVACÍ PODPORY: čte fixtures, počítá jejich otisk, zapisuje
// report parity a nabízí runnery. IMPLEMENTACI KONTRAKTŮ NEOBSAHUJE, tu vlastní
// P09 v produkčních balíčcích a runnery ji dostávají jako parametr (rozhodnutí D8).
package contracts

import (
	"fmt"
	"regexp"
	"strings"
)

// ParamList a ArgList píšou prázdný seznam BEZ ZÁVOREK. `PREPARE jméno ()` i
// `EXECUTE jméno()` jsou v PostgreSQL syntaktická chyba `syntax error at or near ")"`.
// Ověřeno na PostgreSQL 18.4.
func ParamList(types []string) string {
	if len(types) == 0 {
		return ""
	}
	return " (" + strings.Join(types, ", ") + ")"
}

func ArgList(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return "(" + strings.Join(args, ", ") + ")"
}

// ContractStatement je jeden normativní dotaz kontraktu 4.10.1 i s hlavičkou,
// která říká, pod jakou rolí se spouští a jaké typy mají jeho parametry.
type ContractStatement struct {
	SQL        string
	Role       string
	ParamTypes []string
	Args       []string
}

var commentLine = regexp.MustCompile(`(?m)^--.*$`)

func directive(file, raw, name string) (string, error) {
	// [^\S\n] je "bílý znak kromě konce řádku". Se \s by se výraz protáhl přes
	// konec řádku a u direktivy s prázdnou hodnotou by sebral NÁSLEDUJÍCÍ řádek:
	// `-- params:` by vrátilo "-- args:" a vzniklo by neplatné SQL.
	re := regexp.MustCompile(`(?m)^--[^\S\n]*` + name + `:[^\S\n]*(.*)$`)
	m := re.FindStringSubmatch(raw)
	if m == nil {
		return "", fmt.Errorf("%s: chybí direktiva -- %s:", file, name)
	}
	return strings.TrimSpace(m[1]), nil
}

func parseContractStatement(file, raw string) (ContractStatement, error) {
	role, err := directive(file, raw, "role")
	if err != nil {
		return ContractStatement{}, err
	}
	if role != "sender" && role != "app" {
		return ContractStatement{}, fmt.Errorf("%s: role musí být sender nebo app, je %q", file, role)
	}
	params, err := directive(file, raw, "params")
	if err != nil {
		return ContractStatement{}, err
	}
	args, err := directive(file, raw, "args")
	if err != nil {
		return ContractStatement{}, err
	}
	paramTypes := splitTopLevel(params)
	argValues := splitTopLevel(args)
	if len(paramTypes) != len(argValues) {
		return ContractStatement{}, fmt.Errorf(
			"%s: params má %d položek, args %d", file, len(paramTypes), len(argValues))
	}
	sql := strings.TrimRight(strings.TrimSpace(commentLine.ReplaceAllString(raw, "")), ";")
	return ContractStatement{
		SQL:        strings.TrimSpace(sql),
		Role:       role,
		ParamTypes: paramTypes,
		Args:       argValues,
	}, nil
}

// splitTopLevel dělí seznam čárkami mimo závorky, hranaté závorky a apostrofy.
func splitTopLevel(input string) []string {
	if strings.TrimSpace(input) == "" {
		return nil
	}
	out := []string{}
	depth := 0
	quoted := false
	current := strings.Builder{}
	for _, ch := range input {
		switch {
		case ch == '\'':
			quoted = !quoted
		case !quoted && (ch == '(' || ch == '['):
			depth++
		case !quoted && (ch == ')' || ch == ']'):
			depth--
		case ch == ',' && depth == 0 && !quoted:
			out = append(out, strings.TrimSpace(current.String()))
			current.Reset()
			continue
		}
		current.WriteRune(ch)
	}
	if strings.TrimSpace(current.String()) != "" {
		out = append(out, strings.TrimSpace(current.String()))
	}
	return out
}
