# Özel veritabanı sürücüleri

GuildGate veritabanı seçmez. `GuildGateStores` arayüzlerini uygulayıp `createGuildGate()` fonksiyonuna verin.

## Zorunlu davranışlar

- `SessionStore.create()` insert ve kullanıcı session sınırını tek seri store işleminde uygulamalıdır.
- `OAuthStateStore.consume()` okuma ve silmeyi atomik yapmalıdır.
- `RateLimitStore.hit()` eşzamanlı isteklerde limiti aşmamalıdır.
- `CacheStore.set()` entry ile tag üyeliklerini atomik güncellemeli, eski üyelikleri temizlemeli ve tag index TTL uygulamalıdır.
- `IdempotencyStore.begin()` tek ilk reservation sahibini seçmelidir. `complete()` ve `fail()` reservation kimliğini atomik karşılaştırmalıdır.
- `LockStore.release()` tokenı karşılaştırmalıdır. Uzun işlem lease renewal ve fencing token kullanmalıdır.
- `AuditStore.listPage()` cursor'ı `createdAt DESC, id DESC` sorgusunda uygulamalıdır.
- Çoklu outbox worker kayıt claim etmeli; consumer event ID ile deduplication yapmalıdır.
- `PolicyStore.bumpPolicyVersion()` atomik olmalıdır.

Ham session tokenı store'a verilmez; yalnızca `idHash` tutulur. OAuth tokenları `TokenCipher` çıktısı olarak saklanır.

Her sürücü `runStoreContract()` çalıştırmalı; eşzamanlı state consume, reservation sahipliği, session cap, rate yarışı, yanlış tokenla lock release, cache retag, audit paging ve outbox claim senaryolarını kendi gerçek servisiyle test etmelidir.
