#!/bin/bash
# HTTPS-сертификат Let's Encrypt для 2gis.press. Запускать, когда A-записи домена уже указывают на этот сервер.
exec >>/var/log/2pshy-ssl.log 2>&1
echo "=== $(date -Is)"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 2gis.press -d www.2gis.press --non-interactive --agree-tos --register-unsafely-without-email --redirect && rm -f /etc/cron.d/pshyssl
