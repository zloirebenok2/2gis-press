#!/bin/bash
# Разовая установка 2пшы на сервер Ubuntu: nginx, Node.js, сайт, расписание сбора новостей.
# Запускается задачей /etc/cron.d/pshysetup и удаляет её по окончании. Лог: /var/log/2pshy-setup.log
exec >>/var/log/2pshy-setup.log 2>&1
echo "=== setup start $(date -Is)"
set -x
export DEBIAN_FRONTEND=noninteractive
APP=/var/www/pshy
apt-get update -y
apt-get install -y nginx nodejs ca-certificates
node -v
mkdir -p /var/www
python3 -m zipfile -e /root/2pshy-deploy.zip /var/www/ || exit 1
chmod +x $APP/deploy/*.sh
cp $APP/deploy/nginx-2gis.press.conf /etc/nginx/sites-available/2gis.press
ln -sf /etc/nginx/sites-available/2gis.press /etc/nginx/sites-enabled/2gis.press
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp; ufw allow 443/tcp; fi
cp $APP/deploy/cron-2pshy /etc/cron.d/pshyupdate && chmod 644 /etc/cron.d/pshyupdate
$APP/deploy/update.sh
touch $APP/.setup-done
rm -f /etc/cron.d/pshysetup
set +x
echo "=== setup done $(date -Is)"
