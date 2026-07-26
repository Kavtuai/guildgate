# Yönetim API'si

`createOperatorActions()` hazır action'lar üretir; route kaydını uygulama yapar.

Kullanıcı kendi session kayıtlarını listeleyebilir, bir session'ı veya diğer session'ları iptal edebilir. Bot sahibi audit, maintenance, block, rate policy ve analitik kayıtlarını inceleyebilir.

Owner listesi `createGuildGate()` yapılandırmasından gelir. Yazma action'ları normal session, origin, CSRF, rate ve audit kontrollerinden geçer.

Liste action'larında varsayılan sayfa boyutu 50, üst sınır 200'dür. Ham session tokenı API cevabına konmaz.
