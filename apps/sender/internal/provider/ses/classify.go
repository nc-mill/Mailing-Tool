package ses

import (
	"context"
	"errors"
	"net"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/aws/smithy-go"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

// Classify rozhodne o osudu chyby.
//
// Rozdíl mezi Retryable a Fatal je zásadní: při špatných přístupových údajích
// by každá z padesáti tisíc zpráv selhala pětkrát a nadělala čtvrt milionu
// zbytečných volání. Fatal tomu zabrání pozastavením kampaně.
func (d *Dispatcher) Classify(err error) provider.Verdict {
	if err == nil {
		return provider.Verdict{Class: errcatalog.ClassRetryable, Code: errcatalog.NetworkError}
	}
	verdict := func(class errcatalog.ErrorClass, code string) provider.Verdict {
		return provider.Verdict{Class: class, Code: code, ProviderCode: providerCode(err)}
	}

	var tooMany *types.TooManyRequestsException
	if errors.As(err, &tooMany) {
		return verdict(errcatalog.ClassThrottled, errcatalog.RateLimited)
	}
	var internal *types.InternalServiceErrorException
	if errors.As(err, &internal) {
		return verdict(errcatalog.ClassRetryable, errcatalog.ProviderUnavailable)
	}
	var paused *types.SendingPausedException
	if errors.As(err, &paused) {
		return verdict(errcatalog.ClassFatal, errcatalog.SendingPaused)
	}
	var suspended *types.AccountSuspendedException
	if errors.As(err, &suspended) {
		return verdict(errcatalog.ClassFatal, errcatalog.AccountSuspended)
	}
	var mailFrom *types.MailFromDomainNotVerifiedException
	if errors.As(err, &mailFrom) {
		return verdict(errcatalog.ClassFatal, errcatalog.MailFromNotVerified)
	}
	var notFound *types.NotFoundException
	if errors.As(err, &notFound) {
		// U SendEmail je jediná věc, kterou lze nenajít, Configuration Set.
		return verdict(errcatalog.ClassFatal, errcatalog.ProviderEventConfigMissing)
	}
	var limit *types.LimitExceededException
	if errors.As(err, &limit) {
		// Předpoklad k ověření v sandboxu: LimitExceededException je DENNÍ kvóta,
		// TooManyRequestsException je sekundová. Kdyby to tak nebylo, sender by
		// denní kvótu považoval za throttling, donekonečna zpomaloval a kampaň
		// by nikdy nepozastavil.
		return verdict(errcatalog.ClassFatal, errcatalog.ProviderQuotaExceeded)
	}
	var rejected *types.MessageRejected
	if errors.As(err, &rejected) {
		return verdict(errcatalog.ClassPermanent, errcatalog.MessageRejected)
	}
	var badRequest *types.BadRequestException
	if errors.As(err, &badRequest) {
		return verdict(errcatalog.ClassPermanent, errcatalog.InvalidRequest)
	}

	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "AccessDenied", "AccessDeniedException", "InvalidClientTokenId",
			"SignatureDoesNotMatch", "UnrecognizedClientException":
			return verdict(errcatalog.ClassFatal, errcatalog.ProviderAuthFailed)
		}
	}

	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return verdict(errcatalog.ClassRetryable, errcatalog.NetworkError)
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return verdict(errcatalog.ClassRetryable, errcatalog.NetworkError)
	}
	if strings.Contains(err.Error(), "no such host") || strings.Contains(err.Error(), "connection reset") {
		return verdict(errcatalog.ClassRetryable, errcatalog.NetworkError)
	}
	// Neznámá chyba se bere jako opakovatelná. Označit ji za trvalou by znamenalo
	// zahodit zprávu kvůli něčemu, co jsme nepochopili.
	return verdict(errcatalog.ClassRetryable, errcatalog.NetworkError)
}

func providerCode(err error) string {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		return apiErr.ErrorCode()
	}
	return "unknown"
}
