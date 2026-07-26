# Yönetim API'si

`createOperatorActions()` korumalı action'lar üretir; route kaydını uygulama yapar.

Kullanıcı kendi session kayıtlarını listeleyebilir, tek session'ı veya diğer session'larını iptal edebilir. Owner; audit sayfaları, maintenance, block, rate policy, metrik ve circuit durumunu inceleyebilir.

Audit pagination opak cursor ve kararlı `(createdAt, id)` sırası kullanır. Varsayılan sayfa boyutu 50, üst sınır 200'dür. Özel audit store cursor'ı veri tabanı sorgusunda uygulamalıdır.

Session metadata varsayılan olarak gizlidir. Uygulama yalnızca güvenli alanları döndüren açık mapper sağlarsa API cevabına eklenir. Ham session tokenı hiçbir zaman dönmez.

Owner yazma action'ları normal session, origin, CSRF, rate, policy ve audit kontrollerinden geçer.
