package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nc-mill/mlain/apps/sender/internal/breaker"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
	"github.com/nc-mill/mlain/apps/sender/internal/config"
	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/mimebuild"
	"github.com/nc-mill/mlain/apps/sender/internal/obs"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
	"github.com/nc-mill/mlain/apps/sender/internal/provider/ses"
	smtpprov "github.com/nc-mill/mlain/apps/sender/internal/provider/smtp"
	"github.com/nc-mill/mlain/apps/sender/internal/retry"
	"github.com/nc-mill/mlain/apps/sender/internal/throttle"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
	"github.com/nc-mill/mlain/apps/sender/internal/version"
)

// ErrProviderNotSending znamená, že provider je v databázi zablokovaný nebo
// vypnutý. Není to chyba dešifrování a nesmí se s ní tak zacházet: zprávy se
// vracejí do fronty a kampaň se pozastaví jako provider_unavailable.
var ErrProviderNotSending = errors.New("provider_not_sending")

// ErrProviderContractMismatch znamená, že typ účtu v databázi nesouhlasí
// s typem v šifrované obálce. Katalog na to má vlastní kód, tak ho zpráva
// dostane; dřív se i tohle hlásilo jako nedešifrovatelná konfigurace.
var ErrProviderContractMismatch = errors.New(errcatalog.ContractMismatch)

// providerErrorCode přiřazuje selhání načtení odesílacího účtu kód z katalogu.
//
// Existuje proto, že dřív dostalo KAŽDÉ takové selhání kód
// credentials_undecryptable, tedy „nejde dešifrovat, nesouhlasí SECRET_KEY".
// Byla to nepravda u dvou ze tří příčin a stála vyšetřování u klíčů, které byly
// celou dobu v pořádku. Kód smí tvrdit jen to, co se opravdu stalo.
func providerErrorCode(err error) string {
	switch {
	case errors.Is(err, outbox.ErrProviderRowUnreadable):
		return errcatalog.ProviderConfigUnreadable
	case errors.Is(err, ErrProviderContractMismatch):
		return errcatalog.ContractMismatch
	default:
		return errcatalog.CredentialsUndecryptable
	}
}

// App je celý běžící sender.
type App struct {
	cfg  *config.Config
	log  *slog.Logger
	pool *pgxpool.Pool

	store     *outbox.Store
	keys      *keyring.Keyring
	tokens    *token.Builder
	urls      token.URLs
	campaigns *campaign.Cache
	providers *provider.Registry
	limiters  *throttle.Registry
	breaker   *breaker.Breaker
	inflight  *Inflight
	loop      *ClaimLoop
	// nonCampaignLoop běží ve vlastní goroutině a vlastním krátkém intervalu.
	nonCampaignLoop *NonCampaignLoop
	metrics         *obs.Metrics
	httpSrv         *http.Server

	renderers chan *Renderer
	credFails sync.Map
	// providerConfigs drží dešifrovanou konfiguraci pod otiskem.
	// Sdílet ji přes Descriptor by znamenalo nést dešifrované heslo strukturou,
	// která jde do logu a do metrik.
	providerConfigs sync.Map // string (otisk) -> *credentials.ProviderConfig
}

// New sestaví aplikaci. Chyba znamená, že sender nemá startovat.
func New(ctx context.Context, cfg *config.Config, log *slog.Logger) (*App, error) {
	keys, err := keyring.Parse(cfg.SecretKey, cfg.SecretKeyPrevious)
	if err != nil {
		return nil, err
	}
	tokens, err := token.NewBuilder(keys)
	if err != nil {
		return nil, err
	}

	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	// MaxConns je souběžnost plus rezerva na claimer, reaper, heartbeat a health.
	poolCfg.MaxConns = int32(cfg.Concurrency + 4)
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		// Tiché spadnutí zpět na aplikační roli by bezpečnostní hranici zrušilo,
		// aniž by si toho kdokoliv všiml, takže sender radši nenastartuje.
		return nil, err
	}

	store := outbox.NewStore(pool, cfg.SenderID)
	if err := store.DetectCompileMeta(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if !store.HasCompileMeta() {
		log.Warn("compile_meta_column_missing",
			"detail", "campaigns.compile_meta ve schématu není, kontrola počtu značek se vypíná")
	}

	a := &App{
		cfg:      cfg,
		log:      log,
		pool:     pool,
		store:    store,
		keys:     keys,
		tokens:   tokens,
		urls:     token.URLs{TrackingDomain: cfg.TrackingDomain},
		limiters: throttle.NewRegistry(cfg.Replicas, cfg.RateSafety),
		breaker:  breaker.New(cfg.FatalThreshold, 10),
		inflight: NewInflight(),
		metrics:  obs.NewMetrics(),
	}

	a.campaigns = campaign.NewCache(func(id string) (*campaign.Raw, error) {
		cid, err := uuid.Parse(id)
		if err != nil {
			return nil, err
		}
		return store.CampaignHeader(ctx, cid)
	})

	a.providers = provider.NewRegistry(provider.RegistryOptions{
		TTL:        60 * time.Second,
		Now:        time.Now,
		PolicySES:  cfg.AmbiguousPolicySES,
		PolicySMTP: cfg.AmbiguousPolicySMTP,
		Load:       a.loadProvider,
		Build:      a.buildDispatcher,
	})

	claimOpts := ClaimOptions{
		BatchSize:            cfg.BatchSize,
		ClaimTTLSeconds:      cfg.ClaimTTLSeconds,
		NonCampaignBatchSize: cfg.NonCampaignBatchSize,
		FilterBatch:          a.filterSuppressed,
	}
	a.loop = NewClaimLoop(store, claimOpts)
	a.nonCampaignLoop = NewNonCampaignLoop(store, claimOpts)

	// Jedna sada rendererů na worker, ne na kampaň.
	a.renderers = make(chan *Renderer, cfg.Concurrency)
	for i := 0; i < cfg.Concurrency; i++ {
		a.renderers <- NewRenderer(tokens, a.urls, cfg.TestTracking)
	}

	health := obs.NewHealth(a.Ping, cfg.MetricsToken, cfg.MetricsEnabled)
	if cfg.MetricsEnabled {
		health.AttachMetrics(obs.PrometheusHandler(a.metrics))
	}
	srv, err := health.Serve(cfg.HealthPort)
	if err != nil {
		pool.Close()
		return nil, err
	}
	a.httpSrv = srv
	return a, nil
}

// Ping je readiness kontrola: databáze musí odpovědět.
func (a *App) Ping(ctx context.Context) error { return a.pool.Ping(ctx) }

// Close uklidí zdroje. Volá se i při chybě startu.
func (a *App) Close() {
	if a.httpSrv != nil {
		_ = a.httpSrv.Close()
	}
	if a.providers != nil {
		a.providers.Close()
	}
	if a.pool != nil {
		a.pool.Close()
	}
}

// filterSuppressed pouští claimnutou dávku přes dávkovou kontrolu suppression.
//
// Běží nad CELOU dávkou jedním dotazem a ještě před krokem D0, takže odhlášená
// adresa nespotřebuje povolenku throttleru. Vyloučené zprávy si na skipped
// překlopí sama kontrola.
func (a *App) filterSuppressed(ctx context.Context, msgs []outbox.Message) ([]outbox.Message, error) {
	byWorkspace := map[uuid.UUID][]outbox.Message{}
	order := make([]uuid.UUID, 0, 1)
	for _, m := range msgs {
		if _, ok := byWorkspace[m.WorkspaceID]; !ok {
			order = append(order, m.WorkspaceID)
		}
		byWorkspace[m.WorkspaceID] = append(byWorkspace[m.WorkspaceID], m)
	}
	out := make([]outbox.Message, 0, len(msgs))
	for _, ws := range order {
		kept, skipped, err := a.store.FilterSuppressed(ctx, a.keys, ws, byWorkspace[ws])
		if err != nil {
			a.metrics.DBErrors.WithLabelValues("suppression").Inc()
			return nil, err
		}
		if len(skipped) > 0 {
			a.log.Info("zprávy vyloučené suppression listem", "count", len(skipped))
		}
		out = append(out, kept...)
	}
	return out, nil
}

func (a *App) loadProvider(ctx context.Context, providerID uuid.UUID) (*provider.Descriptor, error) {
	row, err := a.store.ProviderRow(ctx, providerID)
	if err != nil {
		return nil, err
	}
	// Zablokovaný nebo vypnutý provider se pozná dřív, než se cokoliv odešle.
	// Bez téhle kontroly by sender tlačil zprávy do provideru, který je odmítá,
	// dokud se nepřepálí pojistka.
	if !row.SendingEnabled || row.Status == "blocked" || row.Status == "disabled" {
		return nil, fmt.Errorf("%w: status=%s sending_enabled=%t", ErrProviderNotSending, row.Status, row.SendingEnabled)
	}
	plain, err := credentials.Decrypt(a.keys, row.ConfigEncrypted, credentials.ContextSendingProvider, row.WorkspaceID)
	if err != nil {
		return nil, err
	}
	cfg, err := credentials.ParseProviderConfig(plain)
	if err != nil {
		return nil, err
	}
	// Křížová kontrola dvou zdrojů pravdy. Rozchod je tichá chyba: sender by
	// postavil klienta jiného typu, než jaký má provider podle databáze.
	if row.Type != "" && row.Type != string(cfg.Kind) {
		return nil, fmt.Errorf("%w: typ providera v databázi je %q, v obálce %q",
			ErrProviderContractMismatch, row.Type, cfg.Kind)
	}
	quota := cfg.MaxSendRate
	if row.QuotaMaxSendRate != nil {
		quota = *row.QuotaMaxSendRate
	}
	fp := fingerprint(plain)
	a.providerConfigs.Store(fp, cfg)
	return &provider.Descriptor{
		Kind:           string(cfg.Kind),
		Fingerprint:    fp,
		Quota:          quota,
		MaxMessageSize: cfg.EffectiveMaxMessageSize(),
	}, nil
}

// buildDispatcher postaví klienta podle typu providera.
//
// Descriptor nese jen otisk, takže se konfigurace bere z providerConfigs, kam ji
// uložil loadProvider. Sdílet ji přes Descriptor by znamenalo nést dešifrované
// heslo strukturou, která jde do logu a do metrik.
func (a *App) buildDispatcher(d *provider.Descriptor) (provider.Dispatcher, error) {
	value, ok := a.providerConfigs.Load(d.Fingerprint)
	if !ok {
		return nil, fmt.Errorf("konfigurace providera není v paměti")
	}
	cfg := value.(*credentials.ProviderConfig)
	switch cfg.Kind {
	case credentials.KindSES:
		return ses.New(context.Background(), cfg)
	case credentials.KindSMTP:
		return smtpprov.New(cfg, smtpprov.Timeouts{
			Connect: time.Duration(a.cfg.SMTPConnectTimeoutSeconds) * time.Second,
			Command: time.Duration(a.cfg.SMTPCommandTimeoutSeconds) * time.Second,
			Data:    time.Duration(a.cfg.SMTPDataTimeoutSeconds) * time.Second,
		})
	default:
		return nil, fmt.Errorf("neznámý typ providera %q", cfg.Kind)
	}
}

// fingerprint je otisk dešifrované konfigurace. Slouží jen k rozpoznání změny,
// nikdy se neloguje.
func fingerprint(plain []byte) string {
	sum := sha256.Sum256(plain)
	return hex.EncodeToString(sum[:])
}

// Run odbaví životní cyklus procesu a vrátí exit kód. Ten je při řízeném
// ukončení vždycky 0.
func (a *App) Run(ctx context.Context) int {
	// Startovní řádek je POVINNÝ, ne ozdoba. Bez něj byl log běžícího senderu
	// prázdný soubor, takže z něj nešlo poznat ani to, jestli proces vůbec
	// naběhl, jestli má správnou databázi a jestli si vyzvedává zprávy. Přesně
	// tenhle stav stál čtyři dny hledání, proč neodešel jediný e-mail.
	// Do řádku jde jen konfigurace, nikdy žádné tajemství.
	a.log.Info("sender startuje",
		"version", version.Get(),
		"sender_id", a.cfg.SenderID,
		"concurrency", a.cfg.Concurrency,
		"batch_size", a.cfg.BatchSize,
		"poll_interval", a.cfg.PollInterval().String(),
		"claim_ttl_seconds", a.cfg.ClaimTTLSeconds,
		"max_attempts", a.cfg.MaxAttempts,
		"health_port", a.cfg.HealthPort,
		"tracking_domain", a.cfg.TrackingDomain,
	)

	// Recovery pass běží jednorázově při startu, PŘED spuštěním claimeru.
	// O své předchozí inkarnaci sender ví jistě, že je mrtvá.
	if n, err := a.store.RecoveryPass(ctx); err != nil {
		a.log.Error("recovery pass selhal", "error", err.Error())
	} else if n > 0 {
		a.log.Info("recovery pass vrátil zprávy do fronty", "count", n)
	}

	workCtx, cancelWork := context.WithCancel(ctx)
	jobs := make(chan Job, 2*a.cfg.Concurrency)
	// Zprávy mimo kampaň mají VLASTNÍ kanál a vlastní workery. Sdílený kanál
	// by problém nevyřešil: má kapacitu 2*Concurrency a při běžící rozesílce je
	// trvale plný, takže by se na něm reset hesla blokoval za kampaňovou dávkou.
	priority := make(chan Job, 2*a.cfg.NonCampaignConcurrency)
	var workers sync.WaitGroup

	for i := 0; i < a.cfg.Concurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobs {
				a.process(workCtx, job)
			}
		}()
	}
	for i := 0; i < a.cfg.NonCampaignConcurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range priority {
				a.process(workCtx, job)
			}
		}()
	}

	var background sync.WaitGroup
	background.Add(4)
	go func() { defer background.Done(); a.runReaper(workCtx) }()
	go func() { defer background.Done(); a.runHeartbeat(workCtx) }()
	go func() { defer background.Done(); a.runClaimer(ctx, jobs) }()
	go func() { defer background.Done(); a.runNonCampaignClaimer(ctx, priority) }()

	<-ctx.Done()
	a.log.Info("přišel signál, začíná řízené ukončení")

	// Claimer se zastavil sám s kořenovým kontextem a zavřel kanál.
	background.Wait()

	shutdown := NewShutdown(a.inflight, a.store, a.cfg.ShutdownGrace())
	shutdown.ClaimTTLSeconds = a.cfg.ClaimTTLSeconds
	shutdown.HeartbeatInterval = a.cfg.HeartbeatInterval()

	// Zprávy, které ještě nemají marker, se hromadně vrátí na pending.
	releaseCtx, cancelRelease := context.WithTimeout(context.Background(), 10*time.Second)
	if err := shutdown.Release(releaseCtx); err != nil {
		a.log.Error("uvolnění zbytku dávky selhalo", "error", err.Error())
	}
	cancelRelease()

	done := make(chan struct{})
	go func() { workers.Wait(); close(done) }()

	code := shutdown.Wait(done, cancelWork)
	if shutdown.Forced() {
		a.metrics.ShutdownForced.Inc()
		a.log.Warn("shutdown deadline vypršel, probíhající volání se přerušila")
	}
	cancelWork()
	return code
}

func (a *App) runClaimer(ctx context.Context, jobs chan<- Job) {
	defer close(jobs)
	ticker := time.NewTicker(a.cfg.PollInterval())
	defer ticker.Stop()
	for {
		if err := a.loop.Tick(ctx, func(c context.Context, job Job) {
			select {
			case jobs <- job:
			case <-c.Done():
			}
		}); err != nil && ctx.Err() == nil {
			a.log.Error("claim selhal", "error", err.Error())
			a.metrics.DBErrors.WithLabelValues("claim").Inc()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// runNonCampaignClaimer je samostatná smyčka pro zprávy mimo kampaň.
//
// Interval je vlastní a krátký. Když dávka nebyla prázdná, jde se hned znovu
// bez čekání: nakupené transakční zprávy se tím rozeberou tempem odesílání,
// ne tempem tikeru.
func (a *App) runNonCampaignClaimer(ctx context.Context, jobs chan<- Job) {
	defer close(jobs)
	ticker := time.NewTicker(a.cfg.NonCampaignPollInterval())
	defer ticker.Stop()
	for {
		claimed, err := a.nonCampaignLoop.Tick(ctx, func(c context.Context, job Job) {
			select {
			case jobs <- job:
			case <-c.Done():
			}
		})
		if err != nil && ctx.Err() == nil {
			a.log.Error("claim zpráv mimo kampaň selhal", "error", err.Error())
			a.metrics.DBErrors.WithLabelValues("claim_non_campaign").Inc()
		}
		if claimed > 0 && ctx.Err() == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *App) runReaper(ctx context.Context) {
	ticker := time.NewTicker(config.ReaperInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := a.store.ReapReleased(ctx); err != nil {
				a.metrics.DBErrors.WithLabelValues("reaper_a").Inc()
			} else if n > 0 {
				a.metrics.ReaperRequeued.Add(float64(n))
			}
			// Politika se volí podle typu providera kampaně. Reaper běží napříč
			// kampaněmi, takže když se obě konfigurační hodnoty liší, volí se
			// konzervativní fail: ta nikdy nevyrobí duplicitu.
			policy := a.cfg.AmbiguousPolicySES
			if a.cfg.AmbiguousPolicySES != a.cfg.AmbiguousPolicySMTP {
				policy = "fail"
			}
			outcomes, err := a.store.ReapAmbiguousDetailed(ctx, policy, a.cfg.ClaimTTLSeconds)
			if err != nil {
				a.metrics.DBErrors.WithLabelValues("reaper_b").Inc()
				continue
			}
			for _, o := range outcomes {
				result := "failed"
				if policy == "retry" && o.AmbiguousCount == 1 {
					result = "retried"
				}
				a.metrics.AmbiguousDispatch.WithLabelValues(result).Inc()
			}
			a.limiters.RecoverAll()
		}
	}
}

func (a *App) runHeartbeat(ctx context.Context) {
	ticker := time.NewTicker(a.cfg.HeartbeatInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			held := a.inflight.Snapshot()
			a.metrics.Inflight.Set(float64(len(held)))
			if len(held) == 0 {
				continue
			}
			if _, err := a.store.Heartbeat(ctx, held, a.cfg.ClaimTTLSeconds); err != nil {
				a.metrics.DBErrors.WithLabelValues("heartbeat").Inc()
			}
		}
	}
}

// process je celý protokol odeslání jedné zprávy.
func (a *App) process(ctx context.Context, job Job) {
	msg := job.Message
	log := obs.MessageLogger(a.log, obs.MessageFields{
		MessageID:   msg.Key.ID.String(),
		CampaignID:  msg.CampaignID.String(),
		WorkspaceID: msg.WorkspaceID.String(),
		SenderID:    a.cfg.SenderID,
		Attempt:     int(msg.Attempts) + 1,
	})
	a.inflight.Add(msg)
	defer a.inflight.Done(msg.Key)

	header, err := a.campaigns.Get(msg.CampaignID.String(), job.Revision)
	if err != nil {
		a.handleCampaignFailure(ctx, msg, err, log)
		return
	}

	// Dávková kontrola suppression proběhla nad celou dávkou před krokem D0,
	// tady se řeší jen zbytek cesty.
	resolved, err := a.resolveProvider(ctx, header, msg, log)
	if err != nil {
		return
	}

	limiter := a.limiters.For(*header.Raw.ProviderID, resolved.Quota)
	a.metrics.RateLimitCurrent.WithLabelValues(resolved.Kind).Set(limiter.Current())

	// D0: povolenka. Čeká se dřív, než se cokoliv zapíše, takže čekající zpráva
	// nezabírá stav v databázi.
	if err := limiter.Wait(ctx); err != nil {
		return
	}

	// D1: marker. Commituje se PŘED síťovým voláním.
	ok, err := a.store.MarkDispatchStarted(ctx, msg.Key)
	if err != nil {
		a.metrics.DBErrors.WithLabelValues("mark").Inc()
		return
	}
	if !ok {
		// Claim mezitím ztracen. Volání provideru se NEPROVEDE a zpráva se
		// z lokální dávky zahodí bez zápisu.
		log.Warn("claim_lost")
		return
	}
	a.inflight.MarkDispatchStarted(msg.Key)

	// D2: render, MIME, dispatch.
	renderer := <-a.renderers
	start := time.Now()
	rendered, rerr := renderer.Render(header, msg)
	a.metrics.RenderDuration.Observe(time.Since(start).Seconds())
	a.renderers <- renderer
	if rerr != nil {
		a.finishRenderFailure(ctx, msg, rerr, log)
		return
	}
	a.breaker.Render(msg.CampaignID, false)

	boundary, err := mimebuild.RandomBoundary()
	if err != nil {
		a.writeResult(ctx, msg, OutcomeRetry, errcatalog.NetworkError, err.Error(), log)
		return
	}
	raw, err := BuildMIME(header, msg, rendered, MIMEOptions{
		Boundary:       boundary,
		PrecedenceBulk: a.cfg.PrecedenceBulk,
		FeedbackID:     a.cfg.FeedbackID,
		ProviderKind:   resolved.Kind,
	})
	if err != nil {
		a.writeResult(ctx, msg, OutcomeFailed, errcatalog.RenderFailed, err.Error(), log)
		return
	}
	if err := CheckMessageSize(raw, resolved.MaxMessageSize); err != nil {
		var re *RenderError
		_ = AsRenderError(err, &re)
		a.writeResult(ctx, msg, OutcomeFailed, re.Code, re.Message, log)
		return
	}

	out := &provider.OutgoingMessage{
		Key:         provider.MessageKey{ID: msg.Key.ID, CreatedAt: msg.Key.CreatedAt},
		WorkspaceID: msg.WorkspaceID,
		CampaignID:  msg.CampaignID,
		From:        mail.Address{Name: header.Raw.FromName, Address: header.Raw.FromEmail},
		To:          msg.Email,
		Raw:         raw,
	}
	if p, okp := resolved.Dispatcher.(interface {
		Prepare(*provider.OutgoingMessage)
	}); okp {
		p.Prepare(out)
	}

	dispatchCtx, cancel := context.WithTimeout(ctx, a.cfg.DispatchTimeout())
	dispatchStart := time.Now()
	providerID, derr := resolved.Dispatcher.Dispatch(dispatchCtx, out)
	cancel()
	a.metrics.DispatchDuration.WithLabelValues(resolved.Kind).Observe(time.Since(dispatchStart).Seconds())

	// D3: zápis výsledku.
	if derr == nil {
		a.breaker.Success(msg.CampaignID)
		a.writeSent(ctx, msg, providerID, resolved.Kind, log)
		return
	}
	verdict := resolved.Dispatcher.Classify(derr)
	a.applyVerdict(ctx, msg, resolved, limiter, verdict, log)
}

// handleCampaignFailure řeší chybu při načtení nebo validaci hlavičky kampaně.
//
// Validace kompilované šablony vede na pozastavení KAMPANĚ, ne na selhání jedné
// zprávy, a to dřív, než odejde první zpráva.
func (a *App) handleCampaignFailure(ctx context.Context, msg outbox.Message, err error, log *slog.Logger) {
	var ve *campaign.ValidationError
	if errors.As(err, &ve) {
		log.Error("kampaň se pozastavuje", "code", ve.Detail, "reason", ve.Message)
		a.pause(ctx, msg.CampaignID, ve.PauseCode, ve.Detail+": "+ve.Message, log)
		a.metrics.CircuitBreakerTrip.WithLabelValues(ve.PauseCode).Inc()
	} else {
		log.Error("hlavičku kampaně nejde načíst", "error", err.Error())
		a.metrics.DBErrors.WithLabelValues("campaign_header").Inc()
	}
	// Zprávu vrátíme do fronty, aby nezůstala viset ve stavu claimed.
	if _, rerr := a.store.ReleaseRemaining(ctx, []outbox.Message{msg}); rerr != nil {
		a.metrics.DBErrors.WithLabelValues("release").Inc()
	}
}

// resolveProvider načte providera a ošetří nedešifrovatelnou konfiguraci.
//
// Selhání dešifrování je chyba KONFIGURACE INSTALACE, ne konkrétní zprávy:
// typicky někdo restartoval s jiným SECRET_KEY nebo odebral SECRET_KEY_PREVIOUS
// moc brzy. Zpráva se proto vrací na pending variantou D3d a teprve po
// SENDER_CREDENTIALS_MAX_RETURNS pokusech se pozastaví kampaň. Rozdíl proti
// označení za trvalou chybu je milion nenávratně označených zpráv proti minutě
// zpoždění.
func (a *App) resolveProvider(ctx context.Context, h *campaign.Header, msg outbox.Message, log *slog.Logger) (*provider.Resolved, error) {
	if h.Raw.ProviderID == nil {
		a.pause(ctx, msg.CampaignID, outbox.PauseProviderUnavailable, "kampaň nemá nastaveného providera", log)
		_, _ = a.store.ReleaseRemaining(ctx, []outbox.Message{msg})
		return nil, errors.New("provider chybí")
	}
	resolved, err := a.providers.Get(ctx, *h.Raw.ProviderID)
	if err == nil {
		a.credFails.Delete(msg.CampaignID)
		return resolved, nil
	}

	// Zablokovaný provider není chyba přístupových údajů. Zpráva se vrátí
	// do fronty a kampaň se pozastaví hned: opakování by nic nezměnilo.
	if errors.Is(err, ErrProviderNotSending) {
		log.Error("provider neodesílá", "error", err.Error())
		detail := outbox.FormatErrorDetail(errcatalog.ProviderUnavailable, err.Error(),
			int(msg.Attempts)+1, a.cfg.SenderID)
		if _, werr := a.store.RecordFatal(ctx, msg.Key, errcatalog.ProviderUnavailable, detail); werr != nil {
			a.metrics.DBErrors.WithLabelValues("result_fatal").Inc()
		}
		a.pause(ctx, msg.CampaignID, outbox.PauseProviderUnavailable, detail, log)
		a.metrics.CircuitBreakerTrip.WithLabelValues(outbox.PauseProviderUnavailable).Inc()
		return nil, err
	}

	count := 1
	if prev, ok := a.credFails.Load(msg.CampaignID); ok {
		count = prev.(int) + 1
	}
	a.credFails.Store(msg.CampaignID, count)

	// Kód se odvozuje z toho, co se opravdu stalo. Zacházení je u všech tří
	// příčin stejné (varianta D3d a pozastavení po vyčerpání pokusů), ale
	// POJMENOVÁNÍ ne: kdo chybu vyšetřuje, musí z kódu poznat, kam se má dívat.
	code := providerErrorCode(err)
	log.Error("odesílací účet nejde načíst",
		"code", code, "error", err.Error(), "vysvětlení", errcatalog.Explain(code))
	detail := outbox.FormatErrorDetail(err.Error(), providerFailureMessage(code),
		int(msg.Attempts)+1, a.cfg.SenderID)
	if _, werr := a.store.RecordFatal(ctx, msg.Key, code, detail); werr != nil {
		a.metrics.DBErrors.WithLabelValues("result_fatal").Inc()
	}
	if count >= a.cfg.CredentialsMaxRetries {
		pauseCode := errcatalog.PauseCode(code)
		a.pause(ctx, msg.CampaignID, pauseCode, detail, log)
		a.metrics.CircuitBreakerTrip.WithLabelValues(pauseCode).Inc()
		a.credFails.Delete(msg.CampaignID)
	}
	return nil, err
}

// providerFailureMessage je věta, která se zapisuje do messages.error_detail
// vedle technické podrobnosti. Musí odpovídat kódu: věta „konfiguraci providera
// nejde dešifrovat" u chyby čtení z databáze je nepravda, kterou si přečte
// každý, kdo se na řádek podívá.
func providerFailureMessage(code string) string {
	switch code {
	case errcatalog.ProviderConfigUnreadable:
		return "řádek odesílacího účtu nejde přečíst z databáze"
	case errcatalog.ContractMismatch:
		return "typ odesílacího účtu nesouhlasí se šifrovanou konfigurací"
	default:
		return "konfiguraci providera nejde dešifrovat"
	}
}

func (a *App) finishRenderFailure(ctx context.Context, msg outbox.Message, err error, log *slog.Logger) {
	var re *RenderError
	if !AsRenderError(err, &re) {
		re = &RenderError{Code: errcatalog.RenderFailed, Message: err.Error()}
	}
	log.Warn("render selhal", "code", re.Code, "detail", re.Message)
	a.writeResult(ctx, msg, OutcomeFailed, re.Code, re.Message, log)

	// Liquid chyba u jedné zprávy neshodí kampaň. Zastaví ji až podíl selhání
	// nad 5 procent z prvních 1000 zpráv, a to nejméně při 10 selháních.
	if a.breaker.Render(msg.CampaignID, true) {
		a.pause(ctx, msg.CampaignID, outbox.PauseRenderFailureRate,
			"podíl selhání renderu překročil práh", log)
		a.metrics.CircuitBreakerTrip.WithLabelValues(outbox.PauseRenderFailureRate).Inc()
	}
}

func (a *App) writeSent(ctx context.Context, msg outbox.Message, providerMessageID, kind string, log *slog.Logger) {
	ok, err := a.store.RecordSent(ctx, msg.Key, providerMessageID)
	if err != nil {
		a.metrics.DBErrors.WithLabelValues("result_sent").Inc()
		return
	}
	if !ok {
		// Claim ztracen během odesílání. Zpráva možná odešla, sender NEZAPISUJE
		// NIC a ani zápis nezkouší znovu. O řádku rozhodne nový vlastník.
		log.Warn("claim_lost_after_dispatch")
		return
	}
	// Úspěch se loguje na Info. Bez tohohle řádku nešlo z logu poznat rozdíl
	// mezi „sender nic nedělá" a „sender odesílá a všechno prochází".
	// Adresa příjemce se NIKDY neloguje, jen její otisk.
	log.Info("zpráva odeslána",
		"provider_kind", kind,
		"provider_message_id", providerMessageID,
		"recipient_hash", obs.HashEmail(msg.Email),
	)
	a.metrics.MessagesDispatched.WithLabelValues(kind, "sent").Inc()
}

func (a *App) writeResult(ctx context.Context, msg outbox.Message, outcome Outcome, code, detail string, log *slog.Logger) {
	detail = outbox.FormatErrorDetail(code, detail, int(msg.Attempts)+1, a.cfg.SenderID)
	var ok bool
	var err error
	switch outcome {
	case OutcomeRetry:
		delay := retry.Delay(int(msg.Attempts)+1, a.cfg.MaxBackoff(), rand.Float64)
		ok, err = a.store.RecordRetry(ctx, msg.Key, int(delay.Seconds()), code, detail)
	case OutcomeThrottled:
		delay := throttle.ThrottleDelay(nil, rand.Float64)
		ok, err = a.store.RecordThrottled(ctx, msg.Key, int(delay.Seconds()), detail)
	case OutcomeFatal:
		ok, err = a.store.RecordFatal(ctx, msg.Key, code, detail)
	default:
		ok, err = a.store.RecordFailed(ctx, msg.Key, code, detail)
	}
	if err != nil {
		a.metrics.DBErrors.WithLabelValues("result").Inc()
		return
	}
	if !ok {
		log.Warn("claim_lost_after_dispatch")
	}
}

func (a *App) applyVerdict(ctx context.Context, msg outbox.Message,
	resolved *provider.Resolved, limiter *throttle.Limiter, v provider.Verdict, log *slog.Logger) {

	outcome := OutcomeFor(v, int(msg.Attempts)+1, a.cfg.MaxAttempts)
	code := v.Code
	if outcome == OutcomeFailed && v.Class == errcatalog.ClassRetryable {
		code = errcatalog.MaxAttemptsExceeded
	}
	if outcome == OutcomeThrottled {
		limiter.Throttled()
		a.metrics.ThrottleEvents.WithLabelValues(resolved.Kind).Inc()
	}

	// Odmítnutí providerem se MUSÍ objevit v logu, ne jen ve sloupci error_code.
	// Dokud tenhle řádek chyběl, sender zamítal každou zprávu a jeho log zůstával
	// prázdný, takže jedinou stopou byl řádek v databázi, do kterého se nikdo
	// nedíval. `explain` je věta pro člověka, `provider_code` doslovná odpověď
	// provideru; podle obojího se pozná, co konkrétně opravit.
	logResult := log.Warn
	if outcome == OutcomeFatal {
		logResult = log.Error
	}
	logResult("odeslání zprávy neprošlo",
		"outcome", outcome.String(),
		"code", code,
		"class", v.Class.String(),
		"provider_kind", resolved.Kind,
		"provider_code", v.ProviderCode,
		// Věta od provideru s zamaskovanými adresami. U SES je často jediné místo,
		// kde stojí, KTERÁ identita neprošla a ve KTERÉM regionu.
		"provider_detail", v.ProviderDetail,
		"explain", errcatalog.Explain(code),
	)

	a.writeResult(ctx, msg, outcome, code, v.ProviderCode, log)
	a.metrics.MessagesDispatched.WithLabelValues(resolved.Kind, outcome.String()).Inc()

	if outcome == OutcomeFatal && a.breaker.Fatal(msg.CampaignID) {
		pauseCode := errcatalog.PauseCode(v.Code)
		a.pause(ctx, msg.CampaignID, pauseCode, pauseDetail(v.Code, v.ProviderCode, v.ProviderDetail), log)
		a.metrics.CircuitBreakerTrip.WithLabelValues(pauseCode).Inc()
	}
}

// pauseDetail složí důvod pauzy tak, aby ho přečetl ČLOVĚK.
//
// Registr pause_reason.code je schválně hrubý (viz errcatalog.PauseCode): kód
// řídí chování a konkrétní příčina patří do detailu. Jenže detail se dosud
// skládal jako "kód: odpověď provideru", tedy `provider_event_config_missing:
// NotFoundException`, a to uživateli neřekne nic. Kampaň se přitom v rozhraní
// ukáže pod hrubým kódem `provider_unavailable` s větou „odesílací služba
// neodpovídá", což je u téhle příčiny rovnou nepravda: Amazon odpověděl,
// jen v účtu chybí konfigurační sada.
//
// Pořadí je vysvětlení, pak technická stopa v závorce. Vysvětlení je to, co
// uživatel potřebuje; stopa je to, co potřebuje podpora. Neznámý kód vysvětlení
// nemá, takže zůstane původní tvar a nic se nevymýšlí.
func pauseDetail(code, providerCode, providerDetail string) string {
	explain := errcatalog.Explain(code)
	if explain == "" {
		explain = code
	}

	// Věta od provideru má PŘEDNOST před obecným vysvětlením kódu, protože mluví
	// o konkrétním případu: „identita ***@brevio.cz neprošla v regionu EU-WEST-1"
	// je něco jiného než „adresa nejspíš není ověřená". Obecné vysvětlení zůstává
	// za ní, aby si uživatel tu konkrétní větu měl podle čeho přeložit.
	parts := []string{explain}
	if providerDetail != "" {
		parts = []string{explain, "Provider odpověděl: " + providerDetail}
	}

	stopa := code
	if providerCode != "" {
		stopa = code + ", " + providerCode
	}
	return strings.Join(parts, " ") + " (" + stopa + ")"
}

// pause pozastaví kampaň a zapomene ji v cache i v pojistce.
func (a *App) pause(ctx context.Context, campaignID uuid.UUID, code, detail string, log *slog.Logger) {
	ok, err := a.store.PauseCampaign(ctx, campaignID, outbox.PauseReason{
		Code:     code,
		Detail:   detail,
		SenderID: a.cfg.SenderID,
		At:       time.Now().UTC(),
	})
	if err != nil {
		log.Error("pozastavení kampaně selhalo", "error", err.Error())
		a.metrics.DBErrors.WithLabelValues("pause").Inc()
		return
	}
	if !ok {
		// Nula ovlivněných řádků NENÍ chyba: kampaň už není v odesílacím stavu.
		log.Info("kampaň už není v odesílacím stavu, pozastavení se neprovedlo")
	}
	a.campaigns.Forget(campaignID.String())
	a.breaker.Forget(campaignID)
}
