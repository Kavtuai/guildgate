# Realtime adapter'ları

Realtime hub session doğrulama, exact-origin, kanal yetkisi, mesaj boyutu, istemci rate limiti, idle activity, subscription sınırı ve yavaş istemci kontrolünü yürütür. Transport seçilen ağ kütüphanesine bağlanır.

## WebSocket

`attachWebSocket()` ping/pong heartbeat, yetkili subscribe/unsubscribe ve sequence replay desteği verir. Geçersiz JSON, büyük mesaj, rate aşımı ve backpressure uygun close koduyla bağlantıyı kapatır.

## Socket.IO

`attachSocketIo()` session ve origin değerini handshake veya açık input üzerinden alır. Subscribe, unsubscribe ve heartbeat event'leri serialize edilip `hub.acceptMessage()` üzerinden geçirilir; WebSocket ile aynı payload, rate ve activity kuralları uygulanır.

Acknowledgement cevabı `{ ok, channel }` veya sabit hata kodu döndürür. Replay `guildgate:replay` event'iyle iletilir. Transport writable değilse hub istemciyi yavaş kabul edip bağlantıyı kapatır.

## SSE

`createServerSentEventStream()` bounded kuyrukla SSE frame üretir. Kuyruk sınırı aşılırsa stream kapanır. HTTP isteğini stream açılmadan önce authenticate ve authorize edin.

## Teslimat ve iptal

Sequence yalnızca kanal içinde sıralama verir. Reconnect yapan istemci son sequence değerini gönderir. Outbox teslimatı at-least-once'tur; worker ve istemci consumer event ID üzerinden deduplication yapmalıdır.

Çoklu instance sisteminde revocation bus, iptal edilen session hash'ini bütün instance'lara taşır. Periyodik session revalidation ikinci güvenlik katmanıdır.

## Hata ve yarış durumu yönetimi

Asenkron authorization tamamlandıktan sonra subscription kapasitesi yeniden kontrol edilir. Send hatası veren bağlantı kapatılıp hub kaydından çıkarılır. Session revocation listener'ları birbirinden izole edilir; bir listener hatası diğerlerinin mesajı işlemesini engellemez. Outbox dispatch batch, claim lease ve concurrency sınırlarını uygular; kaydedilen hata metnini temizleyip kısaltır.
