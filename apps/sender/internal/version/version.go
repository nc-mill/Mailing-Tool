// Package version nese verzi vloženou linkerem přes -X.
package version

// Version vkládá Dockerfile přes -ldflags "-X main.version=${IMAGE_VERSION}".
// Nikdy nesmí být prázdná: akceptační kritérium 7e vyžaduje, aby
// `ml-sender --version` vracel neprázdnou hodnotu shodnou s tagem image.
var Version = "0.0.0-dev"

func Get() string {
	if Version == "" {
		return "0.0.0-dev"
	}
	return Version
}
