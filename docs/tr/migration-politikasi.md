# Migration politikası

GuildGate, `1.0.0` sürümünden başlayarak Semantic Versioning uygular. Patch sürümü davranış hatasını düzeltir, minor sürümü geriye uyumlu özellik ekler, major sürümü ise belgelenmiş geçiş adımlarıyla public sözleşmeyi değiştirebilir.

Güncelleme sırası:

1. Changelog ve `MIGRATION.md` dosyasını okuyun.
2. Hedef sürümü ayrı bir dalda kurun.
3. TypeScript ve uygulama testlerini çalıştırın.
4. Her özel store için contract testini çalıştırın.
5. PostgreSQL SQL çıktısını uygulamadan önce inceleyin.
6. OAuth, yazma, session iptali, yetki kaybı ve realtime reconnect senaryolarını production dışında test edin.
7. Kalıcı adapter değişiminde önce tek instance dağıtın.
8. Audit, outbox, rate ve hata metriklerini izleyin.

`0.1.1` sürümünden `1.0.0` sürümüne geçerken hidden error ayrıntılarının artık dönmediğini, generic `TypeError` hatalarının varsayılan olarak retry edilmediğini ve operator session metadata alanının açık bir mapper verilmedikçe gizlendiğini dikkate alın.

Kod rollback işlemi şema rollback işlemi değildir. Yedek alın, eski kodun yeni şemayı okuyabildiğini doğrulayın ve yıkıcı değişiklikleri uyumluluk süresinden sonra yapın.
