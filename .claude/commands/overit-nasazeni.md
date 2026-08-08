---
description: Ověřit, že běžící systém jede z aktuálního kódu
---

Pouštěj **dřív, než cokoli prohlásíš za ověřené na běžícím systému.** Tři části
produktu běží ze sestavených artefaktů, ne ze zdrojů, takže oprava ve zdroji se
v nich neprojeví, dokud se nepřeloží a nerestartuje.

```sh
ls -la apps/worker/dist/main.js          # worker
ls -la /tmp/mlain-sender                 # Go sender
cat apps/web/.next/BUILD_ID 2>/dev/null  # produkční build webu
ps -o lstart= -p $(pgrep -f 'worker/dist/main.js')
```

Porovnej stáří artefaktu s časem své změny. Když je artefakt starší, přelož
a restartuj:

```sh
pnpm --filter @mlain/worker build
cd apps/sender && go build -o /tmp/mlain-sender ./cmd/sender
```

**Před restartem si vezmi CELÉ prostředí běžícího procesu** (`ps eww <pid>`),
jinak odpadnou role jako `DATABASE_URL_MAINTENANCE` nebo `TRACKING_DOMAIN`
a půlka front začne padat. Pozor při sourcování: `ps eww` vypíše i proměnné
terminálu, například `COLORFGBG=15;0`, kde středník rozbije shell.

Restart dělá hlavní agent, ne subagent: běží pod ním práce ostatních.
