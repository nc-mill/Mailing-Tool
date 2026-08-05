package ses

import (
	"context"
	"errors"
	"net"
	"regexp"
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
		return provider.Verdict{
			Class:          class,
			Code:           code,
			ProviderCode:   providerCode(err),
			ProviderDetail: providerDetail(err),
		}
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

// providerDetailMaxLen drží větu v rozumné délce. Amazon do ní u některých chyb
// vypíše seznam identit a ten může být dlouhý; `pause_reason.detail` má strop
// 2000 znaků na celý řetězec, do kterého se tohle jen vkládá.
const providerDetailMaxLen = 400

// emailPattern hledá e-mailovou adresu v textu odpovědi provideru.
var emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)

// providerDetail vrátí větu od Amazonu s ZAMASKOVANÝMI adresami.
//
// Věta je u SES často jediné místo, kde stojí, co se má opravit: u
// `MessageRejected` třeba „Email address is not verified. The following
// identities failed the check in region EU-WEST-1: ahoj@brevio.cz". Kód
// `MessageRejected` sám o sobě neřekne ani to, jestli neprošel odesílatel,
// nebo příjemce.
//
// MASKOVÁNÍ NENÍ VOLITELNÉ. Věta končí v logu a v `pause_reason`, a do obojího
// podle kapitoly 4.4 části 4b adresa příjemce nesmí. Maskuje se ale JEN místní
// část, doména zůstává: bez ní by údaj ztratil smysl, protože právě podle domény
// se pozná, jestli neprošla odesílací identita, nebo adresa příjemce.
func providerDetail(err error) string {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return ""
	}
	msg := strings.TrimSpace(apiErr.ErrorMessage())
	if msg == "" {
		return ""
	}
	msg = emailPattern.ReplaceAllStringFunc(msg, maskAddress)
	msg = strings.Join(strings.Fields(msg), " ")
	if len(msg) > providerDetailMaxLen {
		msg = msg[:providerDetailMaxLen] + "…"
	}
	return msg
}

// maskAddress nahradí místní část adresy hvězdičkami a nechá doménu.
func maskAddress(addr string) string {
	at := strings.LastIndex(addr, "@")
	if at <= 0 {
		return "***"
	}
	return "***" + addr[at:]
}
