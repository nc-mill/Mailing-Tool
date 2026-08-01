package ses

import (
	"context"
	"errors"
	"net/mail"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

type fakeAPI struct {
	last *sesv2.SendEmailInput
	out  *sesv2.SendEmailOutput
	err  error
}

func (f *fakeAPI) SendEmail(_ context.Context, in *sesv2.SendEmailInput, _ ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error) {
	f.last = in
	return f.out, f.err
}

func outgoing() *provider.OutgoingMessage {
	return &provider.OutgoingMessage{
		Key: provider.MessageKey{
			ID:        uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182"),
			CreatedAt: time.Date(2026, 7, 25, 16, 0, 0, 0, time.UTC),
		},
		WorkspaceID: uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"),
		CampaignID:  uuid.MustParse("0192f3a0-1c2d-7e44-9e5f-60718293a4b5"),
		From:        mail.Address{Name: "Jan Novák", Address: "newsletter@mail.example.cz"},
		To:          "jana@example.cz",
		Raw:         []byte("Subject: x\r\n\r\nbody\r\n"),
	}
}

// AK-9.1: volání obsahuje ConfigurationSetName a ČTYŘI message tagy.
func TestDispatchSendsFourMessageTags(t *testing.T) {
	api := &fakeAPI{out: &sesv2.SendEmailOutput{MessageId: aws.String("0100abcdef")}}
	d := NewWithAPI(api, "mlain-ws-7f3a")

	msg := outgoing()
	d.Prepare(msg)
	id, err := d.Dispatch(context.Background(), msg)
	if err != nil {
		t.Fatal(err)
	}
	if id != "0100abcdef" {
		t.Fatalf("provider_message_id = %q", id)
	}
	if aws.ToString(api.last.ConfigurationSetName) != "mlain-ws-7f3a" {
		t.Fatalf("ConfigurationSetName = %q", aws.ToString(api.last.ConfigurationSetName))
	}
	got := map[string]string{}
	for _, tag := range api.last.EmailTags {
		got[aws.ToString(tag.Name)] = aws.ToString(tag.Value)
	}
	want := map[string]string{
		"ml_msg":       "0192f3a0-1c2d-7e41-8b2c-3d4e5f607182",
		"ml_mday":      "20260725",
		"ml_campaign":  "0192f3a0-1c2d-7e44-9e5f-60718293a4b5",
		"ml_workspace": "0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071",
	}
	if len(got) != 4 {
		t.Fatalf("počet tagů = %d, chci 4", len(got))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("tag %s = %q, chci %q", k, got[k], v)
		}
	}
}

// ml_mday se bere z claimnutého řádku, NIKDY z hodin. Dopočítávat ho z now()
// je chyba, která se projeví až u zpráv ležících v outboxu přes půlnoc na konci
// měsíce: token by ukazoval do jiné partition a otevření by se tiše nezapočítalo.
func TestMessageDayComesFromCreatedAtNotFromClock(t *testing.T) {
	api := &fakeAPI{out: &sesv2.SendEmailOutput{MessageId: aws.String("x")}}
	d := NewWithAPI(api, "cs")
	msg := outgoing()
	msg.Key.CreatedAt = time.Date(2026, 1, 2, 23, 59, 59, 0, time.UTC)
	d.Prepare(msg)
	if _, err := d.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	for _, tag := range api.last.EmailTags {
		if aws.ToString(tag.Name) == "ml_mday" && aws.ToString(tag.Value) != "20260102" {
			t.Fatalf("ml_mday = %q, chci 20260102", aws.ToString(tag.Value))
		}
	}
}

// Z11: sender se nepodepisuje sám a ListManagementOptions zůstává vypnuté.
// SES podepisuje hlavičky dodané odesílatelem, takže List-Unsubscribe, které
// sender vloží do MIME, se podepíše; vlastní správa seznamů by hlavičky přepsala.
func TestSESInputHasNoListManagement(t *testing.T) {
	api := &fakeAPI{out: &sesv2.SendEmailOutput{MessageId: aws.String("x")}}
	d := NewWithAPI(api, "cs")
	msg := outgoing()
	d.Prepare(msg)
	if _, err := d.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if api.last.ListManagementOptions != nil {
		t.Fatal("ListManagementOptions musí zůstat vypnuté")
	}
	if api.last.Content.Simple != nil || api.last.Content.Template != nil {
		t.Fatal("obsah musí být Raw, jinak by vznikly dvě různé podoby téhož mailu")
	}
	if string(api.last.Content.Raw.Data) != string(msg.Raw) {
		t.Fatal("do SES jde jiná zpráva než do SMTP")
	}
}

func TestClassifySES(t *testing.T) {
	d := NewWithAPI(&fakeAPI{}, "cs")
	cases := []struct {
		err   error
		class errcatalog.ErrorClass
		code  string
	}{
		{&types.TooManyRequestsException{}, errcatalog.ClassThrottled, errcatalog.RateLimited},
		{&types.InternalServiceErrorException{}, errcatalog.ClassRetryable, errcatalog.ProviderUnavailable},
		{&types.SendingPausedException{}, errcatalog.ClassFatal, errcatalog.SendingPaused},
		{&types.AccountSuspendedException{}, errcatalog.ClassFatal, errcatalog.AccountSuspended},
		{&types.MailFromDomainNotVerifiedException{}, errcatalog.ClassFatal, errcatalog.MailFromNotVerified},
		{&types.NotFoundException{}, errcatalog.ClassFatal, errcatalog.ProviderEventConfigMissing},
		{&types.LimitExceededException{}, errcatalog.ClassFatal, errcatalog.ProviderQuotaExceeded},
		{&types.MessageRejected{}, errcatalog.ClassPermanent, errcatalog.MessageRejected},
		{&types.BadRequestException{}, errcatalog.ClassPermanent, errcatalog.InvalidRequest},
		{context.DeadlineExceeded, errcatalog.ClassRetryable, errcatalog.NetworkError},
		{errors.New("neznámá chyba"), errcatalog.ClassRetryable, errcatalog.NetworkError},
	}
	for _, c := range cases {
		v := d.Classify(c.err)
		if v.Class != c.class || v.Code != c.code {
			t.Errorf("%T: class=%v code=%s, chci %v a %s", c.err, v.Class, v.Code, c.class, c.code)
		}
	}
}
