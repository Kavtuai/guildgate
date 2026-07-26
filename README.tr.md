# GuildGate

GuildGate, Discord bot panellerinin sunucu tarafı için hazırlanmış korumalı action çekirdeği ve altyapı paketidir. Oturum, güvenli yazma işlemi, politika denetimi, realtime teslimat, veri tabanı bağlantısı, yönetici araçları, izleme ve analitik parçalarını uygulama sahibinin yönettiği sözleşmeler altında toplar.

Kütüphane panel arayüzü üretmez ve uygulama verisinin sahibi olmaz. Veri tabanını, HTTP çatısını, Discord istemcisini, telemetri sistemini ve grafiklerin nerede gösterileceğini siz seçersiniz.

Güncel paket: `@kavtuai/guildgate@1.1.0`
Gerekli çalışma ortamı: Node.js 22 veya daha yeni

`1.1.0`, kararlı sözleşme hattını transaction kesinliği, reservation sahipliği, katı yanıt süresi, cursor pagination ve realtime transport eşitliği çevresinde güçlendirir. Bakımcı incelemesi [SECURITY_AUDIT.md](SECURITY_AUDIT.md) içinde yayımlanır; paket bağımsız üçüncü taraf denetiminden geçmiş gibi sunulmaz.

## Kurulum

```bash
npm install @kavtuai/guildgate
```

İsteğe bağlı bağlantılar uygulama tarafında kurulur:

```bash
npm install pg hono discord.js ws @opentelemetry/api
```

GuildGate bu paketleri doğrudan içe aktarmaz. Adapter'lar küçük uyumlu arayüzler kabul eder. Böylece çekirdek paket hafif kalır ve uygulama kendi sürümlerini sabitleyebilir.

## Pakette bulunanlar

### Güvenli yazma işlemleri

- sunucu taraflı oturum ve oturum yenileme
- exact-origin ve CSRF denetimi
- idempotency tekrar oynatma ve farklı gövde çakışması
- optimistic revision denetimi
- transaction adapter'ı ile commit/rollback hook'ları
- etiket tabanlı cache temizleme
- yenilenen dağıtık lease ve fencing token
- timeout, retry ve circuit breaker
- audit kaydı ve bot sahibi politikaları

### Realtime

- yetkili kanal aboneliği
- WebSocket, Socket.IO ve Server-Sent Events bağlantıları
- heartbeat ve periyodik oturum doğrulama
- yerel veya broadcast oturum iptalinde bağlantı kesme
- buffered byte ve event kuyruğu sınırı
- kanal sequence değeri ve resume cursor
- çoklu worker için claim kullanan outbox

### Ekosistem

- Fastify, Express ve Hono action handler'ları
- PostgreSQL store paketi ve migration SQL'i
- paylaşımlı oturum, limit, cache, idempotency ve lock için Redis store'ları
- discord.js uyumlu sunucu yetki adapter'ı
- altyapıdan bağımsız OpenTelemetry hook'ları
- memory test harness ve store sözleşme testleri
- doctor, writing-check ve migration CLI komutları

### Yönetim ve analitik

- yalnızca bot sahibinin kullanabildiği bakım ve erişim engeli kontrolleri
- sayfalı oturum, audit ve politika servisleri
- rate policy kayıt defteri ve güvenli sıfırlama
- sunucu process ve Discord bot ölçümleri
- uygulamaya özel health probe'ları
- zaman serisi saklama ve bucket özetleri
- line, bar ve donut SVG grafikleri
- panel tabloları için sütun/satır modeli

## 1.1.0 güvenilirlik modeli

GuildGate, domain yazımı commit edildikten sonra cache, audit, realtime veya gözlemci callback'i hata verse bile commit'i kesin kabul eder. Commit sonrasındaki sorunlar response metadata ve telemetriye yazılır; sahte rollback oluşturmaz ve domain işlemini tekrar çalıştırmaz. İç içe PostgreSQL işlemleri savepoint kullanır; iç transaction callback'leri yalnızca savepoint başarıyla tamamlanınca dış transaction'a aktarılır.

Idempotency kayıtlarında reservation kimliği bulunur. Tamamlama ve temizleme işlemleri compare-and-set ile yapılır; süresi dolan eski worker, yeni reservation kaydını ezemez veya silemez. Action timeout'u, uygulama kodu `AbortSignal` değerini dinlemese bile ayarlanan sınırda `504` döndürür. Süresi dolmuş idempotent işlem daha sonra tamamlanırsa lease sonuç alınana kadar tutulur ve commit edilmiş sonuç güvenli replay için kaydedilir. Fiziksel işlemin erken durması gereken yerlerde uygulama kodu verilen sinyali dinlemelidir.

WebSocket ve Socket.IO mesajları aynı payload, rate, activity, subscription ve backpressure kontrollerinden geçer. Audit sayfalaması opak `(createdAt, id)` cursor kullanır. Redis cache retag ve tag temizliği atomiktir, tag indekslerine TTL uygulanır; resmi memory, Redis ve PostgreSQL session store'ları kullanıcı başına oturum sınırını store işlemi içinde uygular.

Transactional outbox tasarım gereği at-least-once teslimat yapar. Claim lease, batch ve concurrency değerleri sınırlıdır; publisher hata metinleri temizlenip kısaltılır. Harici yan etki oluşturan consumer, event ID üzerinden deduplication uygulamalıdır. PostgreSQL rate-limit güncellemeleri bucket başına transaction advisory lock ile sıralanır; Discord OAuth token refresh işlemi dağıtık single-flight lease kullanır.

## En küçük kurulum

```ts
import {
  createGuildGate,
  createMemoryStoreBundle,
  createMemoryTransactionAdapter,
} from "@kavtuai/guildgate";

const stores = createMemoryStoreBundle();

const gate = createGuildGate({
  app: {
    name: "Discord Panelim",
    environment: "development",
    baseUrl: "http://localhost:3000",
  },
  owners: ["DISCORD_KULLANICI_ID"],
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: {
      ttlMs: 7 * 24 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  },
  stores,
  transactions: createMemoryTransactionAdapter(),
  reliability: {
    maximumLateSettlementMs: 5 * 60_000,
  },
});
```

Memory adapter test ve yerel araçlar içindir. Process kapandığında veriler silinir.

## Korumalı bir ayar kaydı

```ts
let currentRevision = 4;

const updateSettings = gate.action({
  name: "guild.settings.update",

  parse(value) {
    const input = value as {
      guildId: string;
      expectedRevision: number;
      prefix: string;
    };

    if (!input.guildId || !Number.isInteger(input.expectedRevision)) {
      throw new Error("Ayar girdisi geçersiz");
    }

    return input;
  },

  resource: (input) => ({ type: "guild", id: input.guildId }),
  rateLimit: { limit: 20, windowMs: 60_000 },
  idempotency: { ttlMs: 10 * 60_000 },

  optimistic: {
    expected: (input) => input.expectedRevision,
    current: async () => currentRevision,
    resource: (input) => `guild:${input.guildId}`,
  },

  concurrency: {
    key: (_context, input) => `settings:${input.guildId}`,
    ttlMs: 8_000,
    renewEveryMs: 2_000,
    waitMs: 250,
  },

  retry: {
    attempts: 3,
    baseDelayMs: 50,
    maximumDelayMs: 500,
  },

  circuitBreaker: {
    failureThreshold: 5,
    resetAfterMs: 30_000,
  },

  transaction: {
    isolation: "serializable",
  },

  timeoutMs: 5_000,

  async execute(context, input) {
    context.signal.throwIfAborted();
    context.transaction;
    context.fencingToken;

    currentRevision += 1;

    return {
      guildId: input.guildId,
      prefix: input.prefix,
      revision: currentRevision,
    };
  },

  cache: {
    invalidateTags: (result) => [`guild:${result.guildId}`],
  },

  realtime: {
    delivery: "outbox",
    events: (result) => [{
      event: "guild.settings.updated",
      channel: `guild:${result.guildId}`,
      data: result,
    }],
  },

  audit: {
    changes: (result) => result,
  },
});
```

Güvensiz HTTP metotları, action açıkça kapatmadığı sürece izinli origin ve oturuma bağlı CSRF token ister.

## HTTP adapter'ları

```ts
import { fastifyActionHandler } from "@kavtuai/guildgate/fastify";

app.patch(
  "/api/guilds/:guildId/settings",
  fastifyActionHandler(gate, updateSettings, {
    input: (request) => ({
      ...(request.body as object),
      guildId: (request.params as { guildId: string }).guildId,
    }),
  }),
);
```

Diğer girişler:

```ts
import { expressActionHandler } from "@kavtuai/guildgate/express";
import { honoActionHandler } from "@kavtuai/guildgate/hono";
```

## PostgreSQL

```ts
import { Pool } from "pg";
import { createPostgresAdapter } from "@kavtuai/guildgate/postgres";

const postgres = createPostgresAdapter({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
});

await postgres.migrate();

const gate = createGuildGate({
  // app ve security ayarları
  stores: postgres.stores,
  transactions: postgres.transactions,
});
```

PostgreSQL paketi oturum, OAuth state, credential, rate limit, cache, idempotency, lease, audit, policy, outbox, realtime sequence ve analitik kayıtlarını kapsar.

Migration SQL'ini bağlantı açmadan görüntülemek için:

```bash
npx guildgate-migration --prefix guildgate
```

Başka veri tabanları `GuildGateStores` sözleşmesini uygulayabilir. Davranışı `runStoreContract()` ile kontrol edebilirsiniz.

## Realtime

```ts
import {
  attachWebSocket,
  createRealtimeHub,
  MemoryRealtimeEventLog,
} from "@kavtuai/guildgate/realtime";

const eventLog = new MemoryRealtimeEventLog();

const hub = createRealtimeHub({
  sessions: gate.sessions,
  rateLimits: gate.config.stores.rateLimits,
  allowedOrigins: gate.config.security.allowedOrigins,
});

await attachWebSocket({
  socket,
  hub,
  origin: request.headers.origin,
  sessionToken,
  eventLog,
  authorize: async ({ userId, channel }) => {
    return canUserOpenChannel(userId, channel);
  },
});
```

Aynı modülde `attachSocketIo()`, `createServerSentEventStream()`, `MemorySessionRevocationBus`, `createSequencedPublisher()` ve `createOutboxWorker()` bulunur.

## Bot ve sunucu izleme

```ts
import {
  MemoryAnalyticsStore,
  StatusMonitor,
  createDiscordJsBotCollector,
} from "@kavtuai/guildgate/analytics";

const analytics = new MemoryAnalyticsStore();

const monitor = new StatusMonitor({
  store: analytics,
  intervalMs: 30_000,
  bot: createDiscordJsBotCollector(discordClient),
  probes: [
    {
      id: "database",
      label: "PostgreSQL",
      timeoutMs: 2_000,
      async check(signal) {
        await pingDatabase(signal);
        return { status: "operational" };
      },
    },
  ],
});

monitor.start();
```

Ölçümler process belleği, CPU süresi, event-loop gecikmesi, uptime, bot hazır olma durumu, gateway gecikmesi, sunucu sayısı, tahmini kullanıcı erişimi, shard ve komut sayısını içerir. Uygulama kendi `MetricPoint` kayıtlarını da ekleyebilir.

## Grafik ve tablo üretimi

```ts
import {
  bucketMetrics,
  renderLineChartSvg,
} from "@kavtuai/guildgate/analytics";

const points = await analytics.query({
  names: ["bot.websocket.ping_ms"],
  from: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
});

const buckets = bucketMetrics(points, 5 * 60_000);

const svg = renderLineChartSvg({
  title: "Gateway gecikmesi",
  labels: buckets.map((bucket) => bucket.start),
  series: [{
    name: "p95",
    values: buckets.map((bucket) => bucket.p95),
  }],
});
```

`renderBarChartSvg()` ve `renderDonutChartSvg()` bağımsız SVG metni döndürür. `buildAnalyticsTable()` React, Vue, Svelte, düz HTML veya JSON API içinde gösterilebilecek tablo modeli üretir.

## Oturum ve bot sahibi API'leri

```ts
import { createOperatorActions } from "@kavtuai/guildgate/operator";

const operator = createOperatorActions({
  kernel: gate,
  analytics,
});
```

Hazır action'lar oturum listeleme, oturum iptali, audit sorgusu, policy inceleme, metrik sorgusu, bakım modu ve subject block işlemlerini kapsar. Bot sahibi yetkisi `createGuildGate()` içindeki `owners` listesinden gelir.

## OpenTelemetry

```ts
import * as otel from "@opentelemetry/api";
import { createOpenTelemetryHooks } from "@kavtuai/guildgate/telemetry";

const telemetry = createOpenTelemetryHooks(otel, {
  name: "panelim",
  version: "2.4.0",
});
```

Bu değeri `createGuildGate()` yapılandırmasına verin. Adapter action span, sayaç ve süre histogramı üretir; SDK veya exporter seçimini uygulamaya bırakır.

## Kontrol komutları

```bash
npm run typecheck
npm test
npm run test:coverage
npm run test:services
npm run pack:check
npm run test:load
npx guildgate-doctor --help
npx guildgate-writing-check --help
npx guildgate-migration --help
```

## Sürüm durumu

`1.1.0`, güçlendirilmiş kararlı sürümdür. Son yerel release kontrolünde 76 deterministik unit ve adapter regresyon testi sıfır hatayla tamamlandı; PostgreSQL ve Redis için hazırlanan iki canlı servis testi yerelde atlandı ve CI içinde geçici servislerle çalışacak şekilde etkin bırakıldı. Yerleşik Node.js coverage sonucu satırlarda %82,25, branch’lerde %73,57 ve fonksiyonlarda %73,30 olarak ölçüldü; üç değer de zorunlu eşiklerin üzerindedir. Coverage sırasında test dosyaları tek tek çalıştırılarak ölçüm yükünün deadline ve lease yenileme zamanlamasını bozması engellenir. Sürüm ayrıca CodeQL, paket kimliği ve credential-pattern taraması, 5.000 işlemlik yük testi, kaynak manifesti doğrulaması ve temiz npm tüketici kurulumu içerir. Uygulamaya özel Discord yetkileri, reverse proxy politikası ve domain authorization testleri tüketici uygulamanın test paketinde kalır.

Diğer belgeler:

- [ROADMAP.md](ROADMAP.md)
- [MIGRATION.md](MIGRATION.md)
- [OPERATING_LIMITS.md](OPERATING_LIMITS.md)
- [SECURITY.md](SECURITY.md)
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- [EXTERNAL_REVIEW_GUIDE.md](EXTERNAL_REVIEW_GUIDE.md)
- [docs/tr/tehdit-modeli.md](docs/tr/tehdit-modeli.md)
- [docs/contracts/stable-adapters.md](docs/contracts/stable-adapters.md)
- [docs/tr/yapilandirma.md](docs/tr/yapilandirma.md)
- [docs/tr/analitik.md](docs/tr/analitik.md)

## Lisans

MIT
