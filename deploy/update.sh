#!/bin/bash
# Сбор новостей и пересборка сайта без простоя: собираем в public.next, затем меняем местами.
cd /var/www/pshy || exit 1
exec >>/var/log/2pshy-update.log 2>&1
echo "=== $(date -Is)"
rm -rf public.next
if OUT_DIR=public.next node scripts/build.mjs && OUT_DIR=public.next node scripts/single.mjs; then
  rm -rf public.prev
  [ -d public ] && mv public public.prev
  mv public.next public
  echo "ok"
else
  echo "FAIL: сайт не обновлён, работает прежняя версия"
fi
