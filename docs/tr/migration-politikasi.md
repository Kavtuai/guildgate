# Migration politikası

GuildGate `1.0.0` sürümünden itibaren Semantic Versioning uygular.

- Patch sürümü, public sözleşmeyi bilerek değiştirmeden davranış hatasını düzeltir.
- Minor sürümü, geriye uyumlu alan ve adapter yeteneği ekleyebilir.
- Major sürümü, public sözleşme değişikliğini belgelenmiş geçiş adımlarıyla yapar.

## Kararlı sözleşmeler

- adapter sözleşmesi: `1.1`
- action sözleşmesi: `1.0`
- realtime sözleşmesi: `1.0`

Özel store paketleri sözleşme sürümünü kaydetmeli ve CI içinde `runStoreContract()` çalıştırmalıdır.

## 1.0.0 sürümünden 1.1.0 sürümüne geçiş

### Idempotency reservation sahipliği

`IdempotencyRecord` artık `reservationId` taşır. `complete()` ve `fail()` anahtarın yanında bu kimliği ve `inflight` durumunu atomik biçimde karşılaştırır. Eski bir worker yeni reservation kaydını güncelleyemez veya silemez. Özel Redis sürücüsünde Lua CAS, PostgreSQL sürücüsünde koşullu `UPDATE/DELETE` kullanın.

### Atomik session sınırı

`SessionStore.create(record, maximumSessionsPerUser)` uyumluluk için optional, paylaşımlı store için güçlü biçimde önerilir. Insert ve fazla session temizliği tek seri store işlemi içinde yapılmalıdır.

### Audit cursor

`AuditStore.listPage()` opak cursor alır ve `{ items, nextCursor }` döndürür. Sıra `createdAt DESC, id DESC` şeklindedir. Cursor'ı küçük bir bellek listesinin üstünde değil, doğrudan veri tabanı sorgusunda uygulayın.

### Transaction kesinliği

Başarılı `COMMIT` sonrasında rollback callback'i çalıştırılmaz. `afterCommit` hatası domain işlemini tekrar çalıştırmaz. `onPostCommitError` ile raporlanır. İç içe PostgreSQL transaction'ları savepoint kullanır; isolation ve read-only modu dış transaction'dan farklı olamaz.

### Timeout ve geç sonuç

Action timeout'u ayarlanan sınırda yanıt döndürür. Fiziksel promise daha sonra tamamlanabilir. `DeadlineExceededError.settlement` bu sonucu izler. GuildGate idempotent bir işlemde reservation ve lease'i sonuç alınana kadar tutar; geç commit sonucunu replay için kaydeder.

Erken fiziksel iptal gereken kod, verilen `AbortSignal` değerini veri tabanı ve HTTP istemcisine iletmelidir. Idempotency TTL değeri action timeout'undan uzun olmalıdır.

### Redis cache tag'leri

Entry ve tag membership değişimi atomik yapılmalıdır. Retag sırasında eski üyelik kaldırılmalı, yeni üyelik eklenmeli ve tag index TTL değeri entry TTL değerinden kısa olmamalıdır.

### Realtime

Socket.IO subscribe, unsubscribe ve heartbeat mesajları `hub.acceptMessage()` üzerinden geçer. Böylece WebSocket ile aynı payload, rate, activity ve backpressure kontrollerini kullanır.

## Geçiş sırası

1. Changelog ve bu belgeyi okuyun.
2. Yeni sürümü ayrı dalda kurun.
3. TypeScript, uygulama testleri ve coverage testini çalıştırın.
4. Her özel store için `runStoreContract()` çalıştırın.
5. PostgreSQL SQL çıktısını uygulamadan önce inceleyin.
6. Login, yazma, timeout, session iptali ve reconnect testlerini çalıştırın.
7. Kalıcı adapter değişiminde önce tek instance deploy edin.
8. Audit, outbox, post-commit, reservation-loss, rate ve error metriklerini izleyin.

## Ek 1.1.0 migration notları

`renew()`, `complete()` ve `fail()` yalnızca mevcut `reservationId` sahibini atomik olarak değiştirmelidir. `reliability.maximumLateSettlementMs`, timeout sonrasında reservation ile lease'in ne kadar süre tutulacağını sınırlar; kalıcı yazım fencing token doğrulamalıdır.

`audit.failClosedActions` içindeki action audit, idempotency ve required transaction kullanmalıdır. Audit store domain yazımıyla aynı transaction'a katılmalıdır. PostgreSQL rate-limit store'u bucket key üzerinden transaction advisory lock ile seri karar verir. Discord OAuth refresh, dağıtık lock store üzerinden single-flight çalışır ve lock alındıktan sonra credential kaydı yeniden okunur.
