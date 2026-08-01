package smtp

import (
	"context"
	"errors"
	"net"
	"strconv"

	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

// Classify rozhoduje podle první číslice odpovědi, s výjimkami, které se
// v praxi vyplatí ošetřit zvlášť.
//
// 5xx na AUTH je Fatal, ne Permanent, protože špatné heslo se týká všech zpráv,
// ne jedné.
func (d *Dispatcher) Classify(err error) provider.Verdict {
	if err == nil {
		return provider.Verdict{Class: errcatalog.ClassRetryable, Code: errcatalog.NetworkError}
	}
	var pe *ProtocolError
	if errors.As(err, &pe) {
		code := strconv.Itoa(pe.Code)
		v := func(class errcatalog.ErrorClass, our string) provider.Verdict {
			return provider.Verdict{Class: class, Code: our, ProviderCode: code}
		}
		switch pe.Stage {
		case "starttls":
			return provider.Verdict{Class: errcatalog.ClassFatal, Code: errcatalog.SMTPStarttlsUnavailable, ProviderCode: code}
		case "auth_insecure":
			return provider.Verdict{Class: errcatalog.ClassFatal, Code: errcatalog.SMTPInsecureAuthRefused, ProviderCode: code}
		case "auth":
			return v(errcatalog.ClassFatal, errcatalog.ProviderAuthFailed)
		}
		switch {
		case pe.Code == 421:
			return v(errcatalog.ClassThrottled, errcatalog.RateLimited)
		case pe.Code == 454:
			return v(errcatalog.ClassRetryable, errcatalog.SMTPTLSTemporary)
		case pe.Code >= 400 && pe.Code < 500:
			return v(errcatalog.ClassRetryable, errcatalog.SMTPTemporaryFailure)
		case pe.Code == 550 && pe.Stage == "rcpt":
			return v(errcatalog.ClassPermanent, errcatalog.SMTPRecipientRejected)
		case pe.Stage == "data" && (pe.Code == 550 || pe.Code == 552 || pe.Code == 554):
			return v(errcatalog.ClassPermanent, errcatalog.SMTPMessageRejected)
		case pe.Code >= 500:
			return v(errcatalog.ClassPermanent, errcatalog.SMTPPermanentFailure)
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return provider.Verdict{Class: errcatalog.ClassRetryable, Code: errcatalog.NetworkError, ProviderCode: "timeout"}
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return provider.Verdict{Class: errcatalog.ClassRetryable, Code: errcatalog.NetworkError, ProviderCode: "net"}
	}
	return provider.Verdict{Class: errcatalog.ClassRetryable, Code: errcatalog.NetworkError, ProviderCode: "unknown"}
}
