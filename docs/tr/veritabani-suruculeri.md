# Özel veritabanı sürücüleri

GuildGate bir veritabanı seçmez. `GuildGateStores` içindeki arayüzleri uygulayıp `createGuildGate()` fonksiyonuna verin.

## Kayıtların yerleştirilmesi

- Oturum, OAuth state, rate limit, cache, idempotency ve kısa süreli kilitler Redis benzeri atomik bir serviste tutulabilir.
- Şifreli OAuth kimlik bilgileri, denetim, outbox ve politikalar kalıcı veritabanında tutulmalıdır.
- Outbox’ın domain kaydıyla aynı veritabanında olması commit ile olay teslimi arasındaki boşluğu azaltır.

## Zorunlu davranışlar

- `OAuthStateStore.consume()` okuma ve silmeyi tek atomik işlemde yapmalıdır.
- `RateLimitStore.hit()` eşzamanlı isteklerde limiti aşan maliyeti kabul etmemelidir.
- `IdempotencyStore.begin()` aynı anahtar için tek ilk yazara izin vermelidir.
- `LockStore.release()` kilidi silmeden önce tokenı karşılaştırmalıdır. Uzun işlemler optional lease yenilemesini uygulamalı ve stale owner riskinde fencing tokenı kalıcı yazmada karşılaştırmalıdır.
- `AuditStore` için mümkünse sadece ekleme yetkisi olan ayrı veritabanı rolü kullanılmalıdır.
- Birden fazla outbox worker varsa kayıt sahipliği veya `skip locked` benzeri bir yöntem kullanılmalıdır.
- `PolicyStore.bumpPolicyVersion()` atomik olmalıdır.

Ham oturum tokenı veri sürücüsüne verilmez. Çekirdek yalnızca `idHash` kaydeder. OAuth tokenları da `TokenCipher` çıktısı olarak saklanır.

Her sürücü; eşzamanlı state tüketimi, idempotency yarışı, limit yarışı, yanlış tokenla kilit bırakma, cache etiketi temizleme ve iki worker’ın aynı outbox kaydını alma senaryolarıyla test edilmelidir.
