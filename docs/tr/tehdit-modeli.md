# Tehdit modeli

## Korunan varlıklar

Discord bot tokenı, OAuth sırrı ve tokenları, session kayıtları, sunucu ayarları, audit geçmişi, owner politikaları, realtime olayları, analitik operasyon verileri ve panel erişilebilirliği korunur.

## Dikkate alınan saldırılar

Yetkisiz internet isteği, yanlış sunucuya işlem, eski yönetici session'ı, CSRF, siteler arası socket, OAuth veya yazma tekrar saldırısı, eş zamanlı yazar, süresi geçmiş lock sahibi, yavaş realtime istemcisi, gizli değer logu, düşük yetkili veri tabanı hesabı ve paket yayın zinciri saldırısı dikkate alınır.

## Kontroller

- HttpOnly session çerezi ve sunucuda token hash'i
- login ve süreye bağlı session yenileme
- unsafe metotlarda exact-origin ve session'a bağlı CSRF
- tek kullanımlık, tarayıcı nonce değerine bağlı OAuth state
- sunucu taraflı kaynak ve Discord yetki kontrolü
- idempotency replay ve optimistic revision
- yenilenen lease ve fencing token
- timeout, retry ve circuit breaker
- kanal başına subscription yetkisi
- realtime buffer ve kuyruk sınırı
- transaction ile outbox kaydı
- çoklu worker claim lease'i
- owner action yetkisi, rate ve audit
- CI ve OIDC trusted publishing

## Kalan riskler

Özel store atomik kuralları bozabilir. Fencing token kullanmayan veri tabanı eski yazarı kabul edebilir. Yanlış retry politikası dış serviste işlemi tekrarlayabilir. Outbox teslimi worker çökmesinde tekrar edebilir. Realtime sequence kanallar arasında global sıra vermez. Yüksek cardinality metrik maliyet yaratabilir. Paket içindeki inceleme bakımcı tarafından yapılmıştır; bağımsız üçüncü taraf denetimi iddiası taşımaz. Ayrı güvence gereken dağıtımlar `EXTERNAL_REVIEW_GUIDE.md` kapsamını kullanmalıdır.

GuildGate ele geçirilmiş hostu, TLS/firewall kurulumunu, veri tabanı rolünü, secret manager'ı, yedeklemeyi ve uygulamaya özel bot politikasını yönetmez.
