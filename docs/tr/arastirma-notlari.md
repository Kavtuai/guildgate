# Araştırma notları

İnceleme tarihi: 26 Temmuz 2026.

## Yazım kontrolü

Wikipedia “Signs of AI writing” sayfası kesin yazar tespiti sunmaz. İçerik, kelime ve dilbilgisi, biçim, kullanıcıya konuşan hazır metin, işaretleme kalıntıları, kaynak hataları, edit özeti ve eski model davranışları altında olası işaretleri toplar.

GuildGate bu başlıkları `docs/tr/yazim-kilavuzu.md` dosyasında proje kurallarına çevirdi. `guildgate-writing-check` komutu da hazır asistan cümlelerini, model içi kaynak kalıntılarını, takip parametrelerini, boş şablonları ve belirsiz tanıtım kelimelerini sürüm kontrolünde arar.

Kaynak: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

## Discord OAuth ve sunucu yetkisi

Discord authorization-code girişinde `state` kullanımı istek bütünlüğü için önerilir. GuildGate state kaydını hash’ler, ayrı tarayıcı nonce çereziyle eşler ve callback sırasında tek kez tüketir.

Varsayılan scope değerleri `identify` ve `guilds` olarak belirlenmiştir. Discord izin değeri güvenli JavaScript sayı sınırını aşabildiği için string olarak gelir; GuildGate bunu `BigInt` ile işler. Kullanıcı izni ve bot izni ayrı kontrol edilir.

Kaynaklar:

- https://docs.discord.com/developers/topics/oauth2
- https://docs.discord.com/developers/resources/user#get-current-user-guilds
- https://docs.discord.com/developers/topics/permissions

## Oturum, CSRF ve WebSocket

OWASP oturum kimliğinin anlamsız olmasını ve asıl verinin sunucuda tutulmasını önerir. GuildGate ham oturum tokenını yalnızca istemciye verir ve sürücüye SHA-256 hash yazar.

Çerezle kimlik doğrulanan yazma isteklerinde tam origin ve oturuma bağlı CSRF tokenı gerekir. WebSocket bağlantısında origin ve oturum ilk bağlantıda doğrulanır; oturum belirli aralıklarla yeniden kontrol edilir ve her kanal aboneliği ayrıca yetkilendirilir.

Kaynaklar:

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html

## npm yayını

npm trusted publishing, desteklenen CI sağlayıcısından OIDC kullanır ve uzun süreli yayın tokenı ihtiyacını kaldırır. Paketteki GitHub release workflow’u testlerden sonra `id-token: write` izniyle npm yayını yapacak şekilde hazırlanmıştır. npm tarafında depo ve workflow güven ilişkisi önceden tanımlanmalıdır.

Kaynak: https://docs.npmjs.com/trusted-publishers

## Adapter ve teslim kaynakları

Hono adapteri, çalışma zamanında Hono import etmek yerine Hono handler modeline uygun web-standardı `Response` döndürür.

PostgreSQL outbox claim işlemleri transaction ve `FOR UPDATE SKIP LOCKED` kullanır. PostgreSQL belgeleri `SKIP LOCKED` seçeneğini, worker'ların başka transaction tarafından alınmış satırları beklemediği kuyruk benzeri tüketim için açıklar.

Genel WebSocket adapterinde ağ bağlantısının sahibi uygulamadır. `ws` bağlantısı transport canlılığı için ping/pong kullanabilir; GuildGate session geçerliliğini ve kanal yetkisini ayrıca kontrol eder.

OpenTelemetry desteği çalışma zamanı bağımlılığı değil, köprü sözleşmesidir. API nesneleri veya özel telemetry hook uygulama tarafından verilir; exporter ve SDK yaşam döngüsü ana uygulamada kalır.

Kaynaklar:

- https://hono.dev/docs/api/hono
- https://www.postgresql.org/docs/current/sql-select.html
- https://github.com/websockets/ws
- https://opentelemetry.io/docs/languages/js/instrumentation/
