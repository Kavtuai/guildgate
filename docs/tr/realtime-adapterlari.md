# Realtime adapter'ları

Realtime hub oturum, origin, kanal yetkisi, mesaj sınırı, abonelik sınırı ve iptal denetimini yapar. Transport adapter'ı seçilen ağ kütüphanesine bağlanır.

## WebSocket

`attachWebSocket()` ping/pong destekleyen socket'lerde heartbeat uygular. Abonelik mesajı kanal ve isteğe bağlı resume sequence taşır. Her kanal için uygulamanın yetki callback'i çağrılır.

## Socket.IO

`attachSocketIo()` handshake içindeki oturum ve origin değerlerini kullanabilir. Abonelik, abonelikten çıkma, replay ve kapanış olaylarını belirli GuildGate event adlarıyla taşır.

## SSE

`createServerSentEventStream()` SSE frame'leri üretir. Kuyruk sınırı aşılırsa stream kapanır. HTTP isteği stream açılmadan önce doğrulanmalıdır.

## Sequence ve tekrar bağlanma

Kanal sequence değeri o kanal içindeki sıralamayı gösterir. İstemci son değeri saklar ve tekrar bağlanırken gönderir. Sunucu belirlenen limite kadar sonraki olayları oynatır.

## Çoklu instance iptali

Session revocation bus sözleşmesi iptal edilen session hash'ini diğer instance'lara iletir. Her instance kendi açık bağlantılarını kapatır.
