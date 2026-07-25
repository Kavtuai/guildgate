# Tehdit modeli

## Korunan veriler

Discord bot tokenı, OAuth sırrı, OAuth tokenları, oturumlar, sunucu ayarları, moderasyon işlemleri, denetim geçmişi, sahip politikaları ve gerçek zamanlı sunucu olayları korunur.

## Dikkate alınan saldırılar

- Kimlik doğrulamamış internet isteği.
- Hedef sunucuda yetkisi olmayan oturum sahibi.
- Rolü kaldırılmış ancak paneli açık kalan eski yönetici.
- CSRF veya siteler arası WebSocket bağlantısı kuran başka site.
- OAuth callback, istek veya idempotency tekrar saldırısı.
- Çok sayıda istek, büyük socket mesajı veya yavaş istemci.
- Gizli değerleri loglayan uygulama hatası.
- Düşük yetkili veritabanı hesabının ele geçirilmesi.
- Paket yayın zincirine müdahale.

## Başlıca kontroller

- HttpOnly oturum çerezi ve sunucuda yalnızca token hash’i.
- Girişte ve belirli aralıklarla yeni oturum kimliği.
- Yazma isteklerinde tam origin ve oturuma bağlı CSRF kontrolü.
- OAuth state için tek kullanımlık kayıt ve tarayıcı nonce eşlemesi.
- Harici adrese yönlendirmeyi reddeden yerel dönüş path’i.
- Kullanıcı ve bot Discord izinlerinin ayrı kontrolü.
- İzin gerektiren yazmalarda canlı kontrol seçeneği.
- Idempotency kaydı, kaynak kilidi ve uygulama revision kontrolü.
- İşlem bazlı rate limit ve zaman aşımı.
- Kanal başına WebSocket abonelik yetkisi.
- Mesaj boyutu, abonelik, boşta kalma, ömür ve buffer sınırı.
- Gizli alanları maskeleyen denetim kaydı.
- Commit sonrasında teslim için outbox.

## Kapsam dışı

GuildGate ele geçirilmiş sunucuyu, çalınmış deployment sırrını, TLS ve firewall kurulumunu, veritabanı rollerini, yedeklemeyi, uygulamaya özel şema doğrulamasını veya yanlış yazılmış bot politikasını kendiliğinden düzeltemez.

0.1.0 sürümünde Redis kilit yenileme yardımcısı yoktur. Genel denetim kaydı action sonucundan sonra yazılır. Discord REST yardımcısı süreç genelinde route bucket yöneticisi değildir. Bu sınırlar üretim tasarımında hesaba katılmalıdır.
