# GuildGate

[English documentation](./README.md)

GuildGate, Discord bot panellerinin sunucu tarafı için hazırlanmış bir TypeScript kütüphanesidir. Oturum kayıtlarını, Discord OAuth state doğrulamasını, CSRF ve origin kontrollerini, sunucu izinlerini, istek sınırlarını, idempotency kayıtlarını, kaynak kilitlerini, zaman aşımını, cache temizliğini, denetim kayıtlarını, outbox olaylarını ve yetkili gerçek zamanlı abonelikleri yönetir.

Arayüz üretmez ve veritabanınızı seçmez. Her depolama bölümü bir TypeScript arayüzüdür. PostgreSQL, MySQL, MongoDB, SQLite, Redis, mevcut ORM yapınız veya özel bir veri servisi kullanılabilir.

Paket: `@kavtuai/guildgate`  
Sürüm: `0.1.0`  
Çalışma ortamı: Node.js 22 veya üzeri

## Durum

Bu depo ilk açık kaynak sürüm adayıdır. TypeScript derlemesi ve paketteki testler geçmektedir. Discord OAuth, üretim Redis sunucusu ve üçüncü taraf veritabanı sürücüleri, yayına alınacak uygulamada ayrıca entegrasyon testinden geçirilmelidir.

Hiçbir kütüphane, uygulamanın güvenlik hatası içermediğini garanti edemez. GuildGate tekrar edilen güvenlik işlerini azaltır, üretimde tehlikeli ayarları reddeder ve politika yönetimini uygulama sahibine bırakır. Üretim ortamında kod incelemesi, bağımlılık kontrolü, izleme, yedekleme ve risk seviyesine göre dış güvenlik incelemesi yine gereklidir.

## Kurulum

Paket npm üzerinde yayımlandıktan sonra:

```bash
npm install @kavtuai/guildgate
```

Bu kaynak paketini yayımlamadan önce denemek için:

```bash
npm install
npm test
```

## Pakette bulunanlar

- Sunucu tarafında tutulan, içeriği anlamsız oturum kimlikleri.
- Oturum süresi, boşta kalma süresi, kimlik yenileme, kullanıcı başına oturum sınırı ve iptal.
- Tek kullanımlık `state` kaydı ve tarayıcı nonce çerezi kullanan Discord authorization-code girişi.
- Uygulamanın verdiği anahtar takımıyla şifrelenen OAuth access ve refresh token kayıtları.
- Yazma isteklerinde tam origin kontrolü ve oturuma bağlı CSRF tokenı.
- Discord izinleri için `BigInt` işlemleri.
- Kullanıcı ve botun sunucu izinlerini ayrı ayrı kontrol etme.
- Panel okuma ve yazma işlemleri için denetimli `action()` API’si.
- İşlem bazlı limit, idempotency, kaynak kilidi, zaman aşımı, denetim kaydı, cache etiketi ve gerçek zamanlı olay desteği.
- Test ve yerel geliştirme için bellek sürücüleri.
- Kısa ömürlü ve dağıtık veriler için Redis sürücüleri.
- Runtime bağımlılığı eklemeyen Fastify ve Express bağlayıcıları.
- WebSocket bağlayıcıları için oturum kontrollü gerçek zamanlı merkez.
- Birbirine karışmayan, uygulama tarafından değiştirilebilen Türkçe ve İngilizce hata metinleri.
- Mermaid UML dosyaları, tehdit modeli, veri sürücüsü sözleşmeleri ve yayın iş akışları.

## Beş dakikalık yerel örnek

Bellek sürücüsü test ve tek süreçli yerel geliştirme içindir. Üretim veritabanı değildir.

```ts
import {
  createGuildGate,
  createMemoryStoreBundle,
} from "@kavtuai/guildgate";

const stores = createMemoryStoreBundle();

const gate = createGuildGate({
  app: {
    name: "Discord Bot Panelim",
    environment: "development",
    baseUrl: "http://localhost:3000",
  },
  owners: [process.env.BOT_OWNER_ID!],
  locale: {
    default: "tr",
    messages: {
      tr: { MAINTENANCE_MODE: "Bakım sırasında ayar değiştirilemez." },
    },
  },
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: {
      ttlMs: 12 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  },
  stores,
});
```

Gizli değerleri kaynak koduna yazmayın. Rastgele değer üretmek için:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Denetimli panel işlemi

İşlemi koruyan kurallar aynı tanımda yer alır.

```ts
const ayarlariGuncelle = gate.action({
  name: "guild.settings.update",

  parse(value) {
    const body = value as Record<string, unknown>;
    if (typeof body.guildId !== "string") throw new Error("guildId gerekli");
    if (typeof body.revision !== "number") throw new Error("revision gerekli");
    return {
      guildId: body.guildId,
      revision: body.revision,
      settings: body.settings,
    };
  },

  resource: (input) => ({ type: "guild", id: input.guildId }),

  rateLimit: {
    limit: 20,
    windowMs: 60_000,
    key: (context, input) => `${context.userId}:${input.guildId}`,
  },

  idempotency: {
    ttlMs: 10 * 60_000,
    scope: (context, input) => `${context.userId}:${input.guildId}`,
  },

  concurrency: {
    key: (_context, input) => `guild-settings:${input.guildId}`,
    ttlMs: 8_000,
    waitMs: 500,
  },

  timeoutMs: 5_000,

  authorize: async (context) => {
    return context.userId
      ? { allowed: true }
      : { allowed: false, code: "AUTHENTICATION_REQUIRED" };
  },

  async execute(context, input) {
    // Transaction ve revision kontrolü uygulamanın veritabanı katmanındadır.
    return database.transaction(async (tx) => {
      return tx.guildSettings.updateWithRevision({
        guildId: input.guildId,
        expectedRevision: input.revision,
        settings: input.settings,
        actorId: context.userId!,
      });
    });
  },

  audit: {
    changes: (result) => ({ revision: result.revision }),
  },

  cache: {
    invalidateTags: (result) => [`guild:${result.guildId}`],
  },

  realtime: {
    delivery: "outbox",
    events: (result) => [{
      event: "guild.settings.updated",
      channel: `guild:${result.guildId}`,
      data: { revision: result.revision },
    }],
  },
});
```

Tarayıcıdan gelen yazma isteğinde oturum çerezi, CSRF tokenı ve idempotency anahtarı bulunmalıdır:

```http
PATCH /api/guilds/123/settings
Origin: https://panel.example.com
X-CSRF-Token: <oturuma-bagli-token>
Idempotency-Key: <rastgele-istek-kimligi>
```

## Discord girişi

```ts
import { createTokenCipher } from "@kavtuai/guildgate";
import { createDiscordOAuth } from "@kavtuai/guildgate/discord";

const cipher = createTokenCipher({
  activeKeyId: "2026-01",
  keys: {
    "2026-01": process.env.GUILDGATE_TOKEN_KEY_BASE64!,
  },
});

const discord = createDiscordOAuth({
  kernel: gate,
  cipher,
  config: {
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    redirectUri: "https://panel.example.com/auth/discord/callback",
    scopes: ["identify", "guilds"],
  },
});
```

Girişi başlatma:

```ts
const login = await discord.beginLogin({ returnTo: "/dashboard", locale: "tr" });
response.header("set-cookie", login.stateCookie);
response.redirect(login.authorizationUrl);
```

Callback:

```ts
const result = await discord.completeLogin({
  code: request.query.code,
  state: request.query.state,
  stateCookie: request.cookies["__Host-guildgate.oauth"],
});

response.header("set-cookie", [result.setCookie, result.clearStateCookie]);
response.redirect(result.returnTo);
```

Callback yalnızca site içindeki bir path’e yönlendirir. İstekten gelen harici alan adına yönlendirme yapmaz.

## Sunucu izinleri

```ts
import { createDiscordGuildAuthorizer } from "@kavtuai/guildgate/discord";

const guildAccess = createDiscordGuildAuthorizer({
  oauth: discord,
  botToken: process.env.DISCORD_BOT_TOKEN!,
  botUserId: process.env.DISCORD_BOT_USER_ID!,
  cache: gate.cache,
});

const kaydet = gate.action({
  name: "guild.settings.save",
  parse: ayarlariDogrula,
  resource: (input) => ({ type: "guild", id: input.guildId }),
  authorize: guildAccess.require({
    guildId: (input) => input.guildId,
    userPermissions: ["MANAGE_GUILD"],
    botPermissions: ["VIEW_CHANNEL", "MANAGE_ROLES"],
    consistency: "live",
  }),
  execute: ayarlariKaydet,
});
```

Discord’a veya güvenlik ayarlarına yazan işlemlerde canlı kontrol kullanın. Düşük riskli görüntüleme verilerinde kısa süreli cache kullanılabilir. Üye rolleri, sunucu rolleri veya bot üyeliği değiştiğinde izin cache’i temizlenmelidir.

## Veritabanı seçimi

Tam sözleşme `GuildGateStores` arayüzüdür:

```ts
interface GuildGateStores {
  sessions: SessionStore;
  oauthStates: OAuthStateStore;
  credentials: OAuthCredentialStore;
  rateLimits: RateLimitStore;
  cache: CacheStore;
  idempotency: IdempotencyStore;
  locks: LockStore;
  audit: AuditStore;
  outbox: OutboxStore;
  policies: PolicyStore;
}
```

Kalıcı kayıtlar ana veritabanında, kısa ömürlü kayıtlar Redis’te tutulabilir:

```ts
import { composeStores, createMemoryStoreBundle } from "@kavtuai/guildgate";
import {
  createRedisEphemeralStores,
  fromNodeRedis,
} from "@kavtuai/guildgate/redis";

const temporary = createRedisEphemeralStores(fromNodeRedis(redis), {
  prefix: "mybot:guildgate",
});

const stores = composeStores(createMemoryStoreBundle(), {
  ...temporary,
  credentials: postgresCredentialStore,
  audit: postgresAuditStore,
  outbox: postgresOutboxStore,
  policies: postgresPolicyStore,
});
```

Bu örnekteki bellek tabanı yalnızca birleştirme mantığını göstermek içindir. Üretim uygulaması, yeniden başlatma sonrasında korunması gereken her kayıt için kalıcı bir sürücü vermelidir.

Ayrıntılar: [Özel veri sürücüleri](./docs/tr/veritabani-suruculeri.md).

## Fastify ve Express

Bağlayıcılar framework tiplerini yapısal olarak kullanır. GuildGate, Fastify veya Express’i bağımlılık olarak kurmaz.

```ts
import { fastifyActionHandler } from "@kavtuai/guildgate/fastify";

fastify.patch(
  "/api/guilds/:guildId/settings",
  fastifyActionHandler(gate, ayarlariGuncelle),
);
```

```ts
import { expressActionHandler } from "@kavtuai/guildgate/express";

app.patch(
  "/api/guilds/:guildId/settings",
  expressActionHandler(gate, ayarlariGuncelle),
);
```

## Gerçek zamanlı bağlantılar

`createRealtimeHub()` kendi başına socket sunucusu açmaz. `RealtimeConnection` arayüzü üzerinden `ws`, uWebSockets.js, Socket.IO, Bun veya başka bir taşıyıcıya bağlanır.

Bağlantı tam origin kontrolünden ve oturum doğrulamasından geçer. Her kanal aboneliği ayrı bir yetkilendirme fonksiyonuna sahiptir. Mesaj boyutu, mesaj sayısı, boşta kalma süresi, toplam bağlantı ömrü, abonelik sayısı ve yavaş istemci sınırları da uygulanır.

Ayrıntılar: [Mimari](./docs/tr/mimari.md) ve [gerçek zamanlı UML sırası](./docs/uml/realtime-sequence.mmd).

## Sahip yönetimi

Yapılandırılan sahip kimlikleriyle korunmuş yönetim endpoint’leri hazırlanabilir. Çekirdekte şu işlemler bulunur:

```ts
await gate.owner.setMaintenance({ enabled: true, reason: "veritabanı bakımı" });
await gate.owner.block({ subjectType: "user", subjectId: "123", reason: "kötüye kullanım" });
await gate.owner.unblock("user", "123");
await gate.revokeUserSessions("123");
```

Sahip endpoint’leri de oturum, CSRF, origin, rate limit ve denetim kontrollerinden geçmelidir. Bu metotları sahip yetkisi kontrol edilmemiş açık endpoint’lerden çağırmayın.

## Üretim kuralları

GuildGate üretimde şu ayarları kabul etmez:

- HTTPS kullanmayan uygulama adresi.
- Boş origin izin listesi.
- HTTP veya localhost origin değeri.
- `Secure` özelliği kapalı oturum çerezi.
- HTTPS kullanmayan Discord callback adresi.
- Kısa CSRF ve IP hashleme sırları.

Uygulamanın sorumlulukları:

- Reverse proxy güven ayarını doğru kurmak ve gerçek istemci IP’sini güvenli biçimde almak.
- Bot tokenını, OAuth sırlarını, şifreleme anahtarlarını ve veritabanı bilgilerini kaynak koddan uzak tutmak.
- Sürücü destekliyorsa veritabanı değişikliklerini transaction içinde yapmak.
- Aynı kaydı birden fazla yönetici düzenleyebiliyorsa revision kontrolü kullanmak.
- Denetim ve outbox kayıtları için saklama süresi belirlemek.
- Kalıcı verileri yedeklemek ve geri yükleme işlemini test etmek.
- Destekleyen HTTP ve veritabanı istemcilerine iptal sinyali geçirmek.
- Büyük sürümlerden önce Discord izinlerini ve API değişikliklerini kontrol etmek.

## Depo kontrolleri

```bash
npm run typecheck
npm test
npm run pack:check
node ./bin/guildgate-doctor.mjs
```

Doctor komutu ortam değişkenlerini yerelde kontrol eder. Gizli değerleri başka bir servise göndermez.

## Belgeler

- [Kurulum ve ilk yayın](./docs/tr/kurulum.md)
- [Mimari](./docs/tr/mimari.md)
- [Özel veri sürücüleri](./docs/tr/veritabani-suruculeri.md)
- [Sahip yönetimi](./docs/tr/sahip-yonetimi.md)
- [Tehdit modeli](./docs/tr/tehdit-modeli.md)
- [Yazım kuralları](./docs/tr/yazim-kilavuzu.md)
- [Araştırma notları](./docs/tr/arastirma-notlari.md)
- [Yerel test raporu](./TEST_REPORT.md)
- [Sürüm planı](./ROADMAP.md)
- [Güvenlik bildirimi](./SECURITY.md)
- [UML dosyaları](./docs/uml)

## Lisans

MIT. Bkz. [LICENSE](./LICENSE).
