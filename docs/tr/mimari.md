# Mimari

GuildGate politika, taşıyıcı, Discord erişimi ve veri saklamayı birbirinden ayırır. Çekirdek paket Fastify, Express, Redis, PostgreSQL, MongoDB veya WebSocket sunucusu import etmez.

## Bileşenler

1. **Çekirdek**, oturum, origin, CSRF, engel, bakım, limit, yetki, idempotency, kilit, zaman aşımı, denetim, cache ve gerçek zamanlı teslim kontrollerini yürütür.
2. **Oturum yöneticisi**, ham token yerine SHA-256 hash kaydeder. Süre, boşta kalma, yenileme, oturum sayısı ve iptal kurallarını uygular.
3. **Discord OAuth istemcisi**, tek kullanımlık state üretir, state’i tarayıcı nonce değeriyle eşler, code değişimini yapar, şifreli kimlik bilgilerini yeniler ve iptal eder.
4. **Discord yetkilendiricisi**, kullanıcının OAuth sunucu izinlerini botun güncel rol ve izinleriyle ayrı ayrı kontrol eder.
5. **Veri arayüzleri**, her uygulamanın kendi veritabanını seçmesini sağlar.
6. **Framework bağlayıcıları**, framework tiplerini çekirdeğe taşımadan istek ve cevap nesnelerini çevirir.
7. **Gerçek zamanlı merkez**, bağlantıyı doğrular, her aboneliği yetkilendirir, mesajları sınırlar ve oturum iptalinde socket’i kapatır.
8. **Outbox dağıtıcısı**, kalıcı outbox sürücüsündeki commit edilmiş olayları yayımlar.

Bileşen şeması: [`../uml/components.mmd`](../uml/components.mmd).

## İşlem sırası

Kimlik doğrulamalı bir yazma isteğinde varsayılan sıra:

1. Oturumu çöz ve zamanı geldiyse kimliği yenile.
2. İstek origin değerini tam eşleşmeyle kontrol et.
3. CSRF tokenını oturum hash’iyle doğrula.
4. Girdiyi doğrula.
5. Korunan kaynağı belirle.
6. Bakım ve engel politikalarını uygula.
7. İşlem limitini uygula.
8. Uygulama veya Discord yetkilendirmesini çalıştır.
9. Idempotency anahtarını ayır.
10. Kaynak kilidini al.
11. İşlemi tek zaman sınırı altında çalıştır.
12. Transaction dışındaki takip işlerinden önce idempotency kaydını tamamla.
13. Cache etiketlerini temizle.
14. Olayları outbox’a yaz veya doğrudan yayımla.
15. Denetim olayını yaz.
16. Kilidi bırak.

Sıra şeması: [`../uml/action-sequence.mmd`](../uml/action-sequence.mmd).

## Transaction sınırı

GuildGate, tanımadığı bir veritabanı sürücüsü için transaction oluşturamaz. Transaction, action içindeki `execute()` fonksiyonuna aittir.

Zorunlu denetim kaydı ayar değişikliğiyle aynı transaction içinde olmalıysa uygulama bu kaydı `execute()` içinde yazmalıdır. Çekirdeğin genel denetim kaydı işlem sonucundan sonra yazılır ve commit edilmiş bir transaction’ı geri alamaz.

## Tutarlılık seçimi

- Oturum ve OAuth state kayıtları tek kullanımlı ve fail-closed olmalıdır.
- Birden fazla instance için idempotency ve kilit işlemleri atomik olmalıdır.
- Görüntüleme verileri kısa süre cache’lenebilir.
- İzin gerektiren yazma işlemleri canlı Discord kontrolü veya olaylarla temizlenen bot cache’i kullanmalıdır.
- Denetim ve outbox için kalıcı veri saklama önerilir.
- Yeniden başlatma sonrasında olay teslimi gerekiyorsa outbox kullanılmalıdır.


## Commit sonrası sorunlar

`execute()` döndüğünde uygulama kaydı commit etmiş olabilir. Bu nedenle cache, realtime veya genel denetim hatası domain işlemini yeniden çalıştırmaz. Sonuç başarılı döner ve sorunlar `meta.postCommitIssues` içinde bildirilir. Audit için fail-closed kullanılan işlemlerde idempotency zorunludur. Zorunlu ve atomik domain denetimi yine `execute()` içindeki veritabanı transaction’ına yazılmalıdır.
